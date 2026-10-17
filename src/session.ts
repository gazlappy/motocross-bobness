import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Player } from './player.ts';
import { BikeModel } from './bikeModel.ts';
import { RiderModel } from './riderModel.ts';
import { type BikeColour, GltfBikeModel } from './gltfBikeModel.ts';
import { GltfRiderModel } from './gltfRiderModel.ts';
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

// One game: the riders, their models and the event (if any) at a venue. Built when a game starts
// and disposed when it ends, so the menu can switch games without reloading the page.

export type GameMode = 'race' | 'baja' | 'quarry' | 'freeride' | 'attract';

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
}

export interface SessionDeps {
  world: RAPIER.World;
  scene: THREE.Scene;
  bikeGltf: GLTF | null;
  riderGltf: GLTF | null;
  sound: SoundSystem;
}

export interface Entry {
  name: string;
  player: Player;
  racer: Racer | null;
  bikeModel: BikeModel | GltfBikeModel;
  riderModel: RiderModel | GltfRiderModel;
  ai: Driver | null;
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

export class Session {
  readonly config: SessionConfig;
  readonly venue: Venue;
  readonly sim: Sim;
  readonly event: Competition | null;
  readonly entries: Entry[] = [];
  readonly human: Entry | null;
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
    else this.event = null;
    // The attract mode is already under way when the menu appears.
    if (config.mode === 'attract') this.event!.clock = 0;

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

    for (const e of this.entries) {
      if (e.ai) {
        const b = e.player.bike;
        deps.sound.addEngine({ position: () => b.body.translation(), rpm: () => b.rpm, load: () => b.throttle, spec: b.spec });
      }
    }
  }

  private add(name: string, colour: BikeColour, kit: number | null, skill: number | null, slot: number, spec: BikeSpec, index = 0) {
    const { world, scene, bikeGltf, riderGltf } = this.deps;
    const venue = this.venue;
    const [pos, yaw] = venue.grid(slot);
    const player = new Player(world, venue.hm, pos, yaw, spec);
    player.track = venue.hm.track;
    player.cannonEnabled = venue.cannon;
    this.sim.players.push(player);

    let bikeModel: BikeModel | GltfBikeModel = new BikeModel();
    let riderModel: RiderModel | GltfRiderModel = new RiderModel();
    try {
      if (bikeGltf) {
        const m = new GltfBikeModel(bikeGltf, colour);
        bikeModel = m;
        player.mounts = () => m.mounts();
      }
    } catch (e) {
      console.warn('bike model unusable, using placeholder', e);
    }
    try {
      if (riderGltf) {
        // Your kit keeps the model's own red unless you've picked another bike colour.
        const tint = kit ?? (colour === 'red' ? undefined : KIT_COLOURS[colour]);
        const m = new GltfRiderModel(cloneSkinned(riderGltf.scene), tint);
        riderModel = m;
        player.proportions = m.proportions;
      }
    } catch (e) {
      console.warn('rider model unusable, using placeholder', e);
    }
    scene.add(bikeModel.root, riderModel.root);

    if (this.event) this.event.add(name, player, skill === null);
    const racer = this.event ? this.event.racers[this.event.racers.length - 1] : null;
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
    this.entries.push({ name, player, racer, bikeModel, riderModel, ai });
  }

  get started() {
    return !this.event || this.event.started;
  }

  /** One physics step. `mine` is the human's controls (ignored when nobody is riding). */
  step(mine: Controls, dt: number) {
    const go = this.started;
    const controls = this.entries.map((e) => (e.ai ? e.ai.controls(dt, this.sim.players, go) : go ? mine : HELD));
    this.sim.step(controls, dt);
    this.event?.update(dt);
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
  }

  /** Who the camera follows: you, or in attract mode whoever is leading. */
  get star(): Entry {
    if (this.human) return this.human;
    const leader = this.event?.standings()[0];
    return this.entries.find((e) => e.racer === leader) ?? this.entries[0];
  }

  dispose() {
    for (const e of this.entries) {
      e.player.dispose();
      this.deps.scene.remove(e.bikeModel.root, e.riderModel.root);
    }
    this.deps.sound.clearEngines();
  }
}

/** The six rivals who line up against you when you ride `colour`, in grid order. */
export function rivalsFor(colour: BikeColour) {
  return RIDERS.filter((r) => r.colour !== colour).slice(0, 6).map((r) => r.name);
}
