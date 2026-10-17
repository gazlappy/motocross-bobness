import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { buildHeightmap } from '../heightmap.ts';
import { type TerrainPalette, createTerrainMesh } from '../terrain.ts';
import { QUARRY_LOOK } from '../terrainLook.ts';
import { type Atmosphere, type Ground, SUNNY, type Venue, onGround, scatterRocks, venueColliders } from '../venue.ts';

// The Stunt Quarry: "monstrous arenas of hills optimally placed for stunt jumping". Big kickers aimed
// at landing mounds, mesas, a volcano and high banks round the edge that lead to the cannon.

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface Kicker { x: number; z: number; dx: number; dz: number; length: number; rise: number; width: number }
interface Mound { x: number; z: number; r: number; height: number; sides: number }

/** A wedge ramp that curves up to its lip, then drops away steeply. */
function kickerHeight(k: Kicker, x: number, z: number) {
  const u = (x - k.x) * k.dx + (z - k.z) * k.dz; // along the ramp
  const v = (x - k.x) * -k.dz + (z - k.z) * k.dx; // across it
  if (u < 0 || u > k.length + 3) return 0;
  const across = 1 - smoothstep(k.width / 2 - 2, k.width / 2 + 3, Math.abs(v));
  const up = u <= k.length ? k.rise * Math.pow(u / k.length, 1.7) : k.rise * (1 - smoothstep(k.length, k.length + 3, u));
  return up * across;
}

/** A flat-topped mound with sloping sides (landings, mesas). */
function moundHeight(m: Mound, x: number, z: number) {
  const d = Math.hypot(x - m.x, z - m.z);
  return m.height * (1 - smoothstep(m.r, m.r + m.sides, d));
}

const KICKERS: Kicker[] = [
  // Pairs: a kicker launching onto the back of a landing mound.
  { x: -150, z: -40, dx: 1, dz: 0, length: 28, rise: 9, width: 16 },
  { x: 40, z: 150, dx: 0, dz: -1, length: 34, rise: 12, width: 18 },
  { x: 120, z: 60, dx: -0.8, dz: -0.6, length: 22, rise: 6, width: 14 },
  // Smaller hits dotted about.
  { x: -40, z: 60, dx: 0.6, dz: 0.8, length: 14, rise: 3.5, width: 10 },
  { x: 30, z: -40, dx: 0.8, dz: -0.6, length: 14, rise: 3.5, width: 10 },
  { x: -90, z: 110, dx: 0, dz: 1, length: 16, rise: 4.5, width: 12 },
];

const MOUNDS: Mound[] = [
  { x: -80, z: -40, r: 6, height: 7, sides: 28 }, // landing for the first kicker
  { x: 40, z: 70, r: 6, height: 8, sides: 32 }, // landing for the big one
  { x: 60, z: 15, r: 5, height: 4, sides: 20 },
  { x: -150, z: 140, r: 22, height: 13, sides: 28 }, // mesa
  { x: 170, z: -150, r: 18, height: 10, sides: 24 }, // mesa
];

const VOLCANO = { x: -40, z: -150, r: 60, height: 26, crater: 11 };

const STONE: TerrainPalette = {
  base: 0xb9a78e, grass: 0x8a8f5a, dirt: 0x9c8466, track: 0x9c8466, rock: 0x8f8577, grassAmount: 0.25, dirtAmount: 0.7,
};

const HAZE: Atmosphere = { ...SUNNY, sky: 0xa3c6e3, fog: { color: 0xd3d6d6, near: 160, far: 650 } };

export function quarryGround(): Ground {
  const hm = buildHeightmap({
    size: 520,
    cells: 416,
    seed: 11,
    natural: (noise, x, z) => {
      let h = noise.fbm(x / 140, z / 140, 4) * 3 + noise.fbm(x / 20, z / 20, 2) * 0.4;
      for (const k of KICKERS) h += kickerHeight(k, x, z);
      for (const m of MOUNDS) h += moundHeight(m, x, z);
      const d = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
      const cone = VOLCANO.height * Math.pow(Math.max(0, 1 - d / VOLCANO.r), 1.3);
      h += cone - 6 * (1 - smoothstep(VOLCANO.crater * 0.4, VOLCANO.crater, d));
      return h;
    },
    // High banks all round: ride up them for air, or over the top for the cannon.
    edgeWall: { height: 48, width: 85 },
    track: null,
    trackBlend: 0,
    flats: [{ x: 0, z: 0, r: 30 }],
  });

  return { hm, grid: (i) => [onGround(hm, (i % 3) * 5 - 5, Math.floor(i / 3) * 6), Math.PI / 2] };
}

export function buildQuarry(world: RAPIER.World): Venue {
  const ground = quarryGround();
  const hm = ground.hm;
  const root = new THREE.Group();
  root.add(createTerrainMesh(hm, STONE, 7, QUARRY_LOOK), scatterRocks(hm, 160, 0x7d7468, [{ x: 0, z: 0, r: 40 }], 99));
  return {
    ...ground,
    id: 'quarry',
    name: 'Stunt Quarry',
    root,
    colliders: venueColliders(world, hm),
    atmosphere: HAZE,
    cannon: true,
    dirt: { dust: 0xcabfaa, clod: 0x8a8070, dustAmount: 1.3, clodAmount: 0.7 },
  };
}
