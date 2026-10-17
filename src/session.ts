import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type Heightmap, sampleHeight } from './heightmap.ts';
import { Player } from './player.ts';
import { BikeModel } from './bikeModel.ts';
import { RiderModel } from './riderModel.ts';
import { type BikeColour, GltfBikeModel } from './gltfBikeModel.ts';
import { GltfRiderModel } from './gltfRiderModel.ts';
import { Sim } from './sim.ts';
import { Race, type Racer } from './race.ts';
import { AIDriver } from './ai.ts';
import type { Controls } from './input.ts';
import type { SoundSystem } from './audio/sound.ts';
import type { Difficulty } from './settings.ts';

// One game: the riders, their models and the race (if any) on the shared world. Built when a game
// starts and disposed when it ends, so the menu can switch games without reloading the page.

export type GameMode = 'race' | 'freeride' | 'attract';

export interface SessionConfig {
  mode: GameMode;
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  colour: BikeColour;
}

export interface SessionDeps {
  world: RAPIER.World;
  hm: Heightmap;
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
  ai: AIDriver | null;
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
  readonly sim: Sim;
  readonly race: Race | null;
  readonly entries: Entry[] = [];
  readonly human: Entry | null;
  private deps: SessionDeps;

  constructor(deps: SessionDeps, config: SessionConfig) {
    this.deps = deps;
    this.config = config;
    const { world, hm } = deps;
    this.sim = new Sim(world);
    this.race = config.mode === 'freeride' ? null : new Race(hm.track, config.mode === 'attract' ? 999 : config.laps);
    // The attract mode is already under way when the menu appears.
    if (config.mode === 'attract' && this.race) this.race.clock = 0;

    const human = config.mode !== 'attract';
    const rivals = RIDERS.filter((r) => !human || r.colour !== config.colour);
    const aiCount = config.mode === 'freeride' ? 0 : config.mode === 'attract' ? 7 : Math.min(config.opponents, rivals.length);
    const skillScale = DIFFICULTY_SKILL[config.difficulty];

    // Grid slots: you start mid-pack (front row middle in a small field), rivals fill the rest.
    const mySlot = aiCount >= PLAYER_GRID_SLOT ? PLAYER_GRID_SLOT : 1;
    const rest = Array.from({ length: 8 }, (_, i) => i).filter((i) => !human || i !== mySlot);
    const slots = human ? [mySlot, ...rest.slice(0, aiCount)] : rest.slice(0, aiCount);

    let slot = 0;
    if (human) this.add('You', config.colour, null, null, slots[slot++]);
    for (const r of rivals.slice(0, aiCount)) {
      this.add(r.name, r.colour, r.kit, Math.min(1, r.skill * skillScale), slots[slot++]);
    }
    this.human = human ? this.entries[0] : null;

    for (const e of this.entries) {
      if (e.ai) {
        const b = e.player.bike;
        deps.sound.addEngine({ position: () => b.body.translation(), rpm: () => b.rpm, load: () => b.throttle });
      }
    }
  }

  private add(name: string, colour: BikeColour, kit: number | null, skill: number | null, slot: number) {
    const { world, hm, scene, bikeGltf, riderGltf } = this.deps;
    const [pos, yaw] = Race.gridSlot(hm.track, slot);
    pos.y = sampleHeight(hm, pos.x, pos.z) + 1;
    const player = new Player(world, hm, pos, yaw);
    player.track = hm.track;
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

    if (this.race) this.race.add(name, player, skill === null);
    const racer = this.race ? this.race.racers[this.race.racers.length - 1] : null;
    const ai = skill === null ? null : new AIDriver(player, hm.track, { skill, lane: ((slot % 3) - 1) * 3.5 });
    this.entries.push({ name, player, racer, bikeModel, riderModel, ai });
  }

  get started() {
    return !this.race || this.race.started;
  }

  /** One physics step. `mine` is the human's controls (ignored when nobody is riding). */
  step(mine: Controls, dt: number) {
    const go = this.started;
    const controls = this.entries.map((e) => (e.ai ? e.ai.controls(dt, this.sim.players, go) : go ? mine : HELD));
    this.sim.step(controls, dt);
    this.race?.update(dt);
  }

  /** Per rendered frame: move the models to match the physics. */
  render(dt: number) {
    for (const e of this.entries) {
      e.bikeModel.update(e.player.bike);
      e.riderModel.setPose(e.player.update(dt));
    }
  }

  /** Who the camera follows: you, or in attract mode whoever is leading. */
  get star(): Entry {
    if (this.human) return this.human;
    const leader = this.race?.standings()[0];
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
