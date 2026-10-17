import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { type Heightmap, sampleHeight } from './heightmap.ts';
import { createTerrainCollider } from './terrain.ts';
import type { DirtLook } from './particles.ts';

// A place to ride: its ground, scenery, colliders, lighting and how you start and stay in bounds.
// Each event type has one (Nationals, Supercross, Baja, Stunt Quarry); the game switches between
// them without reloading.

export type VenueId = 'nationals' | 'supercross' | 'baja' | 'quarry';

export interface Atmosphere {
  sky: number;
  fog: { color: number; near: number; far: number };
  hemi: { sky: number; ground: number; intensity: number };
  sun: { color: number; intensity: number; offset: THREE.Vector3 };
  /** Stadium crowd noise. */
  crowd: boolean;
  /** Camera far plane. */
  far: number;
}

export interface Venue {
  id: VenueId;
  name: string;
  hm: Heightmap;
  /** Everything visible: terrain, scenery, markers. */
  root: THREE.Group;
  colliders: RAPIER.Collider[];
  atmosphere: Atmosphere;
  /** Outdoors, riding off the map fires the cannon; stadium walls keep you in instead. */
  cannon: boolean;
  /** Start position `i` (on the ground) and heading. */
  grid(i: number): [THREE.Vector3, number];
  /** Baja: the waypoints in order (the last is the finish). */
  waypoints?: THREE.Vector3[];
  /** Baja: waypoint markers, coloured by the HUD to show which is next. */
  markers?: THREE.Object3D[];
  /** What the bikes throw up: dust and clod colours. */
  dirt?: DirtLook;
}

/** The physical side of a venue (no scenery), so it can also be built for headless tests. */
export interface Ground {
  hm: Heightmap;
  grid(i: number): [THREE.Vector3, number];
  waypoints?: THREE.Vector3[];
  /** Colliders besides the terrain (stadium walls). */
  extra?: RAPIER.ColliderDesc[];
}

export const SUNNY: Atmosphere = {
  sky: 0x9cc4e4,
  fog: { color: 0xc9d6dc, near: 120, far: 520 },
  hemi: { sky: 0xcfe4ff, ground: 0x8a6a48, intensity: 1.1 },
  sun: { color: 0xfff1d6, intensity: 2.2, offset: new THREE.Vector3(-60, 90, 40) },
  crowd: false,
  far: 1200,
};

/** Terrain collider plus any extras, all switched off while another venue is in use. */
export function venueColliders(world: RAPIER.World, hm: Heightmap, extra: RAPIER.ColliderDesc[] = []) {
  const ground = createTerrainCollider(world, hm);
  return [ground, ...extra.map((d) => world.createCollider(d))];
}

/** Position on the ground at (x, z), lifted to a spawn height. */
export function onGround(hm: Heightmap, x: number, z: number, lift = 1) {
  return new THREE.Vector3(x, sampleHeight(hm, x, z) + lift, z);
}

/** Scatter rocks over the ground, keeping clear of the track and of the given spots. */
export function scatterRocks(hm: Heightmap, count: number, colour = 0x8b6248, keepClear: { x: number; z: number; r: number }[] = [], seed = 12345) {
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: colour, flatShading: true });
  const rocks = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const n = hm.cells + 1;
  let placed = 0;
  for (let i = 0; placed < count && i < count * 6; i++) {
    const x = (rand() - 0.5) * hm.size * 0.9;
    const z = (rand() - 0.5) * hm.size * 0.9;
    const ix = Math.round((x + hm.size / 2) / hm.cellSize), iz = Math.round((z + hm.size / 2) / hm.cellSize);
    if (hm.trackDistance[iz * n + ix] < 20) continue;
    if (keepClear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
    const s = 0.4 + rand() * rand() * 2.6;
    q.setFromEuler(new THREE.Euler(i, i * 1.7, i * 0.3));
    m.compose(new THREE.Vector3(x, sampleHeight(hm, x, z) + s * 0.3, z), q, new THREE.Vector3(s, s * 0.7, s));
    rocks.setMatrixAt(placed++, m);
  }
  rocks.count = placed;
  rocks.castShadow = rocks.receiveShadow = true;
  return rocks;
}
