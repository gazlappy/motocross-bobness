import { Noise2D } from './noise.ts';

export interface Heightmap {
  /** Cells per side; there are (cells + 1)^2 height samples. */
  cells: number;
  /** World size of one side in metres. The map is centred on the origin. */
  size: number;
  cellSize: number;
  /** Row-major: heights[iz * (cells + 1) + ix]. */
  heights: Float32Array;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Practice straight runs along -Z from the spawn point.
const STRAIGHT_START = 30;
const STRAIGHT_END = -260;

interface Jump {
  at: number; // distance down the straight where the take-off ramp starts
  up: number; // ramp length
  rise: number;
  top: number; // flat top length (0 = kicker)
  down: number; // landing length
}

const JUMPS: Jump[] = [
  { at: 35, up: 9, rise: 1.1, top: 0, down: 7 },
  { at: 50, up: 9, rise: 1.1, top: 0, down: 7 },
  { at: 65, up: 9, rise: 1.1, top: 0, down: 7 },
  { at: 95, up: 9, rise: 3, top: 14, down: 12 },
  { at: 150, up: 10, rise: 4, top: 0, down: 3 },
  { at: 172, up: 4, rise: 4, top: 4, down: 14 },
  { at: 215, up: 14, rise: 6.5, top: 0, down: 5 },
];

function jumpProfile(d: number) {
  let h = 0;
  for (const j of JUMPS) {
    const t = d - j.at;
    if (t < 0 || t > j.up + j.top + j.down) continue;
    let v: number;
    if (t < j.up) v = j.rise * smoothstep(0, j.up, t);
    else if (t < j.up + j.top) v = j.rise;
    else v = j.rise * (1 - smoothstep(j.up + j.top, j.up + j.top + j.down, t));
    h = Math.max(h, v);
  }
  return h;
}

export function generateHeightmap(seed = 7, cells = 256, size = 640): Heightmap {
  const noise = new Noise2D(seed);
  const n = cells + 1;
  const half = size / 2;
  const cellSize = size / cells;
  const heights = new Float32Array(n * n);

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -half + ix * cellSize;
      const z = -half + iz * cellSize;

      let h = noise.fbm(x / 230, z / 230, 5) * 34;
      h += Math.max(0, noise.fbm(x / 95 + 13.1, z / 95 - 4.2, 4)) * 18;
      h += noise.fbm(x / 18, z / 18, 2) * 0.5;

      const cz = Math.min(STRAIGHT_START, Math.max(STRAIGHT_END, z));
      const distToStraight = Math.hypot(x, z - cz);
      h *= smoothstep(14, 110, distToStraight);

      if (z < STRAIGHT_START && z > STRAIGHT_END) {
        h += jumpProfile(-z) * (1 - smoothstep(6, 11, Math.abs(x)));
      }

      // Cliff walls at the map edge, like the original's bowl-shaped arenas.
      const edge = half - Math.max(Math.abs(x), Math.abs(z));
      h += smoothstep(60, 0, edge) * 55;

      heights[iz * n + ix] = h;
    }
  }
  return { cells, size, cellSize, heights };
}

/** Bilinear height lookup in world coordinates. */
export function sampleHeight(hm: Heightmap, x: number, z: number) {
  const n = hm.cells + 1;
  const fx = Math.min(hm.cells - 1e-4, Math.max(0, (x + hm.size / 2) / hm.cellSize));
  const fz = Math.min(hm.cells - 1e-4, Math.max(0, (z + hm.size / 2) / hm.cellSize));
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const h = hm.heights;
  const a = h[iz * n + ix], b = h[iz * n + ix + 1];
  const c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Heights reordered for Rapier's heightfield collider (column-major, rows along Z). */
export function rapierHeights(hm: Heightmap) {
  const n = hm.cells + 1;
  const out = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      out[ix * n + iz] = hm.heights[iz * n + ix];
    }
  }
  return out;
}
