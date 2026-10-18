import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Player } from './player.ts';
import { BikeModel } from './bikeModel.ts';
import { RiderModel } from './riderModel.ts';
import { type BikeColour, GltfBikeModel } from './gltfBikeModel.ts';
import { GltfRiderModel } from './gltfRiderModel.ts';
import { HondaBikeModel } from './hondaBikeModel.ts';
import { Sim } from './sim.ts';
import { Race } from './race.ts';
import { BajaRace } from './bajaRace.ts';
import { StuntChallenge } from './stuntChallenge.ts';
import type { Competition, Racer } from './competition.ts';
import { AIDriver, type Driver } from './ai.ts';
import { BajaDriver } from './bajaDriver.ts';
import type { Controls } from './input.ts';
import type { SoundSystem } from './audio/sound.ts';
import type { Difficulty } from './settings.ts';
import type { Venue, VenueId } from './venue.ts';
import { BIKES, type BikeId, type BikeSpec } from './bikes.ts';
import { TagGame } from './tag.ts';
import { RemoteRider, snapshot } from './net/remoteRider.ts';
import type { RosterEntry } from './net/protocol.ts';

// One game: the riders, their models and the event (if any) at a venue. Built when a game starts
// and disposed when it ends, so the menu can switch games without reloading the page.

export type GameMode = 'race' | 'baja' | 'quarry' | 'freeride' | 'attract' | 'tag';

export interface SessionConfig {
  mode: GameMode;
  venue: VenueId;
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  colour: BikeColour;
  /** Stunt Quarry session length, seconds. */
  duration: number;
  /** Your bike (default the 250), and the rivals' (default the same as yours). */
  bike?: BikeId;
  rivalBike?: BikeId;
  /** Career: exactly these rivals, in grid order. */
  rivals?: string[];
  /** Multiplayer: who rides where, and which of them are simulated on this machine. */
  net?: NetGame;
}

export interface NetGame {
  /** This machine's peer id. */
  self: string;
  host: boolean;
  roster: RosterEntry[];
}

/** A rider simulated on another machine. */
export interface RemoteEntry {
  rider: RemoteRider;
  roster: RosterEntry;
  racer: Racer | null;
  bikeModel: AnyBikeModel;
  riderModel: RiderModel | GltfRiderModel;
}

export interface SessionDeps {
  world: RAPIER.World;
  scene: THREE.Scene;
  bikeGltf: GLTF | null;
  hondaGltf: GLTF | null;
  riderGltf: GLTF | null;
  sound: SoundSystem;
  /** Which bike model to draw (read when a game starts). */
  bikeStyle: () => 'crf450' | 'classic';
}

type AnyBikeModel = BikeModel | GltfBikeModel | HondaBikeModel;

export interface Entry {
  name: string;
  player: Player;
  racer: Racer | null;
  bikeModel: AnyBikeModel;
  riderModel: RiderModel | GltfRiderModel;
  ai: Driver | null;
  /** Multiplayer: this rider's roster id. */
  netId?: string;
}

/** Every rider who can line up, in the order they fill the field. */
const RIDERS: { name: string; colour: BikeColour; kit: number; skill: number }[] = [
  { name: 'Holeshot Hal', colour: 'orange', kit: 0xf07a1a, skill: 0.97 },
  { name: 'Dirt Dan', colour: 'yellow', kit: 0xf2c418, skill: 0.95 },
  { name: 'Roost Ruby', colour: 'green', kit: 0x2f9e3a, skill: 0.93 },
  { name: 'Whip Wendy', colour: 'blue', kit: 0x1f5fd1, skill: 0.92 },
  { name: 'Skid Mark', colour: 'white', kit: 0xe8e8e8, skill: 0.9 },
  { name: 'Rex Rocket', colour: 'black', kit: 0x2a2a2e, skill: 0.88 },
  { name: 'Red Rider', colour: 'red', kit: 0xd8261c, skill: 0.95 },
];

export const KIT_COLOURS: Record<BikeColour, number> = Object.fromEntries(RIDERS.map((r) => [r.colour, r.kit])) as Record<
  BikeColour,
  number
>;

const DIFFICULTY_SKILL: Record<Difficulty, number> = { easy: 0.86, medium: 0.95, hard: 1.03 };
const PLAYER_GRID_SLOT = 4;

/** Held on the line until GO. */
const HELD: Controls = { throttle: 0, brake: 1, steer: 0, leanForward: 0, leanSide: 0 };
/** Attract mode: how long a new leader must lead before the camera switches to them. */
const STAR_SWITCH_MS = 2000;

export class Session {
  private followed: Entry | null = null;
  private challengerSince = 0;
  readonly config: SessionConfig;
  readonly venue: Venue;
  readonly sim: Sim;
  readonly event: Competition | null;
  readonly entries: Entry[] = [];
  readonly remotes: RemoteEntry[] = [];
  readonly human: Entry | null;
  /** Multiplayer: hold on the line until the host says everyone's loaded. */
  waiting: boolean;
  private deps: SessionDeps;

  constructor(deps: SessionDeps, venue: Venue, config: SessionConfig) {
    this.deps = deps;
    this.venue = venue;
    this.config = config;
    this.sim = new Sim(deps.world);
    const track = venue.hm.track;

    if (config.mode === 'race' || config.mode === 'attract') this.event = new Race(track!, config.mode === 'attract' ? 999 : config.laps);
    else if (config.mode === 'baja') this.event = new BajaRace(venue.waypoints!);
    else if (config.mode === 'quarry') this.event = new StuntChallenge(config.duration);
    else if (config.mode === 'tag') this.event = new TagGame(config.duration, config.net?.host ?? true);
    else this.event = null;
    this.waiting = !!config.net && this.event !== null;
    // The attract mode is already under way when the menu appears.
    if (config.mode === 'attract') this.event!.clock = 0;

    if (config.net) {
      this.human = this.buildNet(config.net);
      return;
    }

    const human = config.mode !== 'attract';
    const rivals = config.rivals
      ? config.rivals.map((name) => RIDERS.find((r) => r.name === name)!).filter(Boolean)
      : RIDERS.filter((r) => !human || r.colour !== config.colour);
    const mine = BIKES[config.bike ?? '250'];
    const theirs = BIKES[config.rivalBike ?? config.bike ?? '250'];
    const racing = config.mode === 'race' || config.mode === 'baja';
    const aiCount = config.mode === 'attract' ? 7 : racing ? Math.min(config.opponents, rivals.length) : 0;
    const skillScale = DIFFICULTY_SKILL[config.difficulty];

    // Grid slots: you start mid-pack (front row middle in a small field), rivals fill the rest.
    const mySlot = aiCount >= PLAYER_GRID_SLOT ? PLAYER_GRID_SLOT : 1;
    const rest = Array.from({ length: 8 }, (_, i) => i).filter((i) => !human || i !== mySlot);
    const slots = human ? [mySlot, ...rest.slice(0, aiCount)] : rest.slice(0, aiCount);

    let slot = 0;
    if (human) this.add('You', config.colour, null, null, slots[slot++], mine);
    rivals.slice(0, aiCount).forEach((r, i) => {
      this.add(r.name, r.colour, r.kit, Math.min(1, r.skill * skillScale), slots[slot++], theirs, i);
    });
    this.human = human ? this.entries[0] : null;

    this.addAiEngines();
  }

  private addAiEngines() {
    for (const e of this.entries) {
      if (e.ai) {
        const b = e.player.bike;
        this.deps.sound.addEngine({ position: () => b.body.translation(), rpm: () => b.rpm, load: () => b.throttle, spec: b.spec });
      }
    }
  }

  /** Multiplayer: our riders (you, and the host's AI) are simulated here; everyone else is a proxy. */
  private buildNet(net: NetGame): Entry | null {
    const skillScale = DIFFICULTY_SKILL[this.config.difficulty];
    let aiIndex = 0;
    for (const r of net.roster) {
      if (r.owner !== net.self) {
        this.addRemote(r);
        continue;
      }
      const rival = RIDERS.find((x) => x.name === r.name);
      if (r.ai) {
        const skill = Math.min(1, (rival?.skill ?? 0.92) * skillScale);
        this.add(r.name, r.colour, rival?.kit ?? KIT_COLOURS[r.colour], skill, r.slot, BIKES[r.bike], aiIndex++, r.id);
      } else {
        this.add(r.name, r.colour, null, null, r.slot, BIKES[r.bike], 0, r.id);
      }
    }
    this.addAiEngines();
    return this.entries.find((e) => !e.ai) ?? null;
  }

  private addRemote(r: RosterEntry) {
    const [pos, yaw] = this.venue.grid(r.slot);
    const rider = new RemoteRider(this.deps.world, r.id, BIKES[r.bike], pos, yaw);
    const kit = r.ai ? RIDERS.find((x) => x.name === r.name)?.kit ?? null : null;
    const { bikeModel, riderModel } = this.models(r.colour, kit);
    let racer: Racer | null = null;
    if (this.event) {
      this.event.add(r.name, rider, false);
      racer = this.event.racers[this.event.racers.length - 1];
      racer.remote = true;
      if (this.event instanceof TagGame) this.event.identify(racer, r.id);
    }
    this.deps.sound.addEngine({ position: () => rider.bike.body.translation(), rpm: () => rider.rpm, load: () => rider.throttle, spec: rider.spec });
    this.remotes.push({ rider, roster: r, racer, bikeModel, riderModel });
  }

  /** The bike and rider models for a colour (falling back to the placeholders). */
  private models(colour: BikeColour, kit: number | null) {
    let bikeModel: AnyBikeModel = new BikeModel();
    let riderModel: RiderModel | GltfRiderModel = new RiderModel();
    const { bikeGltf, hondaGltf, riderGltf } = this.deps;
    try {
      if (hondaGltf && this.deps.bikeStyle() === 'crf450') bikeModel = new HondaBikeModel(hondaGltf, colour);
      else if (bikeGltf) bikeModel = new GltfBikeModel(bikeGltf, colour);
    } catch (e) {
      console.warn('bike model unusable, using placeholder', e);
    }
    try {
      // Your kit keeps the model's own red unless you've picked another bike colour.
      const tint = kit ?? (colour === 'red' ? undefined : KIT_COLOURS[colour]);
      if (riderGltf) riderModel = new GltfRiderModel(cloneSkinned(riderGltf.scene), tint);
    } catch (e) {
      console.warn('rider model unusable, using placeholder', e);
    }
    this.deps.scene.add(bikeModel.root, riderModel.root);
    return { bikeModel, riderModel };
  }

  private add(
    name: string, colour: BikeColour, kit: number | null, skill: number | null, slot: number, spec: BikeSpec, index = 0, netId?: string,
  ) {
    const { world } = this.deps;
    const venue = this.venue;
    const [pos, yaw] = venue.grid(slot);
    const player = new Player(world, venue.hm, pos, yaw, spec);
    player.track = venue.hm.track;
    player.cannonEnabled = venue.cannon;
    this.sim.players.push(player);

    const { bikeModel, riderModel } = this.models(colour, kit);
    if (!(bikeModel instanceof BikeModel)) player.mounts = () => bikeModel.mounts();
    if (riderModel instanceof GltfRiderModel) player.proportions = riderModel.proportions;

    if (this.event) this.event.add(name, player, skill === null);
    const racer = this.event ? this.event.racers[this.event.racers.length - 1] : null;
    if (racer && netId && this.event instanceof TagGame) this.event.identify(racer, netId);
    if (this.event instanceof BajaRace && racer) {
      // After a crash in the desert: back towards the last waypoint, facing the next.
      const baja = this.event;
      player.respawnGuide = {
        back: () => (racer.nextCheckpoint > 0 ? baja.waypoints[racer.nextCheckpoint - 1] : pos),
        ahead: () => baja.target(racer),
      };
    }
    let ai: Driver | null = null;
    if (skill !== null) {
      if (this.event instanceof BajaRace) {
        ai = new BajaDriver(player, this.event, racer!, venue.hm, skill, (index % 2 ? 1 : -1) * (10 + index * 6));
      } else if (venue.hm.track) {
        ai = new AIDriver(player, venue.hm.track, { skill, lane: ((slot % 3) - 1) * Math.min(3.5, venue.hm.track.halfWidth * 0.6) });
      }
    }
    this.entries.push({ name, player, racer, bikeModel, riderModel, ai, netId });
  }

  get started() {
    return !this.event || (!this.waiting && this.event.started);
  }

  /** One physics step. `mine` is the human's controls (ignored when nobody is riding). */
  step(mine: Controls, dt: number) {
    const go = this.started;
    const controls = this.entries.map((e) => (e.ai ? e.ai.controls(dt, this.sim.players, go) : go ? mine : HELD));
    const now = performance.now();
    for (const r of this.remotes) r.rider.update(now);
    this.sim.step(controls, dt);
    if (!this.waiting) this.event?.update(dt);
  }

  /** Per rendered frame, before drawing: crash timers and respawns. */
  tick(dt: number) {
    for (const e of this.entries) e.player.tick(dt);
  }

  /** Move the models to match the (interpolated) physics. */
  render() {
    for (const e of this.entries) {
      e.bikeModel.update(e.player.bike);
      e.riderModel.setPose(e.player.readPose());
    }
    const now = performance.now();
    for (const r of this.remotes) {
      r.rider.update(now);
      r.bikeModel.update(r.rider.bike);
      r.riderModel.setPose(r.rider.pose);
    }
  }

  /** Multiplayer: the state of every rider simulated here, for the wire. */
  snapshots(now: number) {
    return this.entries.filter((e) => e.netId).map((e) => ({ id: e.netId!, s: snapshot(e.player, e.player.readPose(), now) }));
  }

  receive(id: string, s: number[], now: number) {
    this.remotes.find((r) => r.rider.id === id)?.rider.receive(s, now);
  }

  /** A player left: take their riders off the track (their results stand as they were). */
  dropOwner(owner: string) {
    for (const r of this.remotes.filter((x) => x.roster.owner === owner)) {
      r.rider.dispose();
      this.deps.scene.remove(r.bikeModel.root, r.riderModel.root);
      this.remotes.splice(this.remotes.indexOf(r), 1);
    }
  }

  /**
   * Who the camera follows: you, or in attract mode whoever is leading. A new leader takes the
   * camera only after leading for a while, or two bikes side by side would flick it between them.
   */
  get star(): Entry {
    if (this.human) return this.human;
    const leader = this.event?.standings()[0];
    const now = performance.now();
    const top = this.entries.find((e) => e.racer === leader) ?? this.entries[0];
    if (!this.followed || !this.entries.includes(this.followed)) this.followed = top;
    if (top === this.followed) this.challengerSince = now;
    else if (now - this.challengerSince > STAR_SWITCH_MS) this.followed = top;
    return this.followed;
  }

  dispose() {
    for (const e of this.entries) {
      e.player.dispose();
      this.deps.scene.remove(e.bikeModel.root, e.riderModel.root);
    }
    for (const r of this.remotes) {
      r.rider.dispose();
      this.deps.scene.remove(r.bikeModel.root, r.riderModel.root);
    }
    this.deps.sound.clearEngines();
  }
}

/** The six rivals who line up against you when you ride `colour`, in grid order. */
export function rivalsFor(colour: BikeColour) {
  return RIDERS.filter((r) => r.colour !== colour).slice(0, 6).map((r) => r.name);
}

/** AI riders to fill a multiplayer grid: `n` of them, avoiding the colours players have taken. */
export function aiRidersFor(taken: BikeColour[], n: number) {
  return RIDERS.filter((r) => !taken.includes(r.colour)).slice(0, n).map((r) => ({ name: r.name, colour: r.colour }));
}
