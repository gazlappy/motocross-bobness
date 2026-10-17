import { Noise2D } from './noise.ts';
import { TRACK_HALF_WIDTH, Track } from './track.ts';

export interface Heightmap {
  /** Cells per side; there are (cells + 1)^2 height samples. */
  cells: number;
  /** World size of one side in metres. The map is centred on the origin. */
  size: number;
  cellSize: number;
  /** Row-major: heights[iz * (cells + 1) + ix]. */
  heights: Float32Array;
  /** Distance from each height sample to the track centreline, same layout as `heights`. */
  trackDistance: Float32Array;
  track: Track;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface Jump {
  at: number; // distance along the track where the take-off ramp starts
  up: number; // ramp length
  rise: number;
  top: number; // flat top length (0 = kicker)
  down: number; // landing length
  /** Take-off speed (m/s) the AI aims for: the middle of the clean range from scripts/jump-speeds.ts. */
  speed: number;
}

// Track features by distance along the lap (see Track for the layout, ~940 m).
const JUMPS: Jump[] = [
  // Start straight: rollers, a tabletop, then a step-up double.
  { at: 40, up: 9, rise: 1.1, top: 0, down: 7, speed: 19 },
  { at: 55, up: 9, rise: 1.1, top: 0, down: 7, speed: 19 },
  { at: 70, up: 9, rise: 1.1, top: 0, down: 7, speed: 19 },
  { at: 100, up: 9, rise: 3, top: 14, down: 12, speed: 16 },
  { at: 155, up: 10, rise: 4, top: 0, down: 3, speed: 19 },
  { at: 177, up: 4, rise: 4, top: 4, down: 14, speed: 19 },
  // Back straight: the big tabletop.
  { at: 425, up: 12, rise: 4.5, top: 18, down: 14, speed: 19 },
  // Out of the whoops: a long tabletop (forgiving if you come up short), then another before the hairpin.
  { at: 690, up: 10, rise: 3.5, top: 14, down: 12, speed: 17 },
  { at: 760, up: 8, rise: 2.5, top: 10, down: 10, speed: 15 },
];
// Whoops: a run of small, tight bumps.
for (let i = 0; i < 7; i++) JUMPS.push({ at: 638 + i * 5, up: 2.5, rise: 0.6, top: 0, down: 2.5, speed: 13 });

/** Each jump's take-off point and comfortable approach speed. */
export function jumpApproaches() {
  return JUMPS.map((j) => ({ s: j.at, speed: j.speed }));
}

/** Height of jumps (above the track's own level) at a distance along the lap. */
export function jumpProfile(s: number) {
  let h = 0;
  for (const j of JUMPS) {
    const t = s - j.at;
    if (t < 0 || t > j.up + j.top + j.down) continue;
    let v: number;
    if (t < j.up) v = j.rise * smoothstep(0, j.up, t);
    else if (t < j.up + j.top) v = j.rise;
    else v = j.rise * (1 - smoothstep(j.up + j.top, j.up + j.top + j.down, t));
    h = Math.max(h, v);
  }
  return h;
}

/** Gentle ups and downs around the lap, so it isn't a flat oval. */
function trackElevation(s: number, length: number) {
  const a = (s / length) * Math.PI * 2;
  return 3.5 * Math.sin(2 * a + 1) + 2 * Math.sin(3 * a + 2.2) + 1;
}

export function generateHeightmap(track = new Track(), seed = 7, cells = 512, size = 640): Heightmap {
  const noise = new Noise2D(seed);
  const n = cells + 1;
  const half = size / 2;
  const cellSize = size / cells;
  const heights = new Float32Array(n * n);
  const trackDistance = new Float32Array(n * n);
  const samples = track.samples;
  const W = TRACK_HALF_WIDTH;

  const levels = samples.map((_, i) => trackElevation(track.sAt(i), track.length));

  // For each 16 m block of the map, the track samples that could be nearest to a point in it
  // (anything further than REACH away is treated as "far from the track").
  const BLOCK = 16, REACH = 100;
  const blocks = Math.ceil(size / BLOCK);
  const candidates: number[][] = [];
  for (let bz = 0; bz < blocks; bz++) {
    for (let bx = 0; bx < blocks; bx++) {
      const cx = -half + (bx + 0.5) * BLOCK, cz = -half + (bz + 0.5) * BLOCK;
      const r = REACH + BLOCK;
      const list: number[] = [];
      samples.forEach((smp, i) => {
        if ((smp.x - cx) ** 2 + (smp.z - cz) ** 2 < r * r) list.push(i);
      });
      candidates.push(list);
    }
  }

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -half + ix * cellSize;
      const z = -half + iz * cellSize;

      let natural = noise.fbm(x / 230, z / 230, 5) * 34;
      natural += Math.max(0, noise.fbm(x / 95 + 13.1, z / 95 - 4.2, 4)) * 18;
      natural += noise.fbm(x / 18, z / 18, 2) * 0.5;

      const block = candidates[
        Math.min(blocks - 1, Math.floor((z + half) / BLOCK)) * blocks + Math.min(blocks - 1, Math.floor((x + half) / BLOCK))
      ];
      // Nearest sample, plus a distance-weighted track level: taking the level from the nearest
      // sample alone leaves a crease in the infield where "nearest" flips between two straights.
      let best = -1, bestD = Infinity, wSum = 0, levelSum = 0;
      for (const i of block) {
        const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
        const w = 1 / (d * d + 1);
        wSum += w;
        levelSum += w * levels[i];
      }
      if (best < 0) {
        // Well away from the track: just the hills and the map edge.
        const edge = half - Math.max(Math.abs(x), Math.abs(z));
        heights[iz * n + ix] = natural + smoothstep(60, 0, edge) * 55;
        trackDistance[iz * n + ix] = REACH;
        continue;
      }
      const dist = Math.sqrt(bestD);
      const smp = samples[best];
      const s = track.sAt(best);
      const lateral = (x - smp.x) * smp.tz - (z - smp.z) * smp.tx;
      const base = levelSum / wSum;

      // Hills fade into the track's own level over the infield and shoulders.
      let h = base + (natural - base) * smoothstep(W + 2, 90, dist);

      // Jumps span the track and taper off at its edges.
      h += jumpProfile(s) * (1 - smoothstep(W - 1, W + 4, dist));

      // Berms: the outside of every turn banks up, more for tighter turns.
      const k = smp.curvature;
      if (Math.abs(k) > 0.005) {
        const outside = -Math.sign(k) * lateral;
        const berm = Math.min(2.2, Math.abs(k) * 85);
        h += berm * smoothstep(0.15 * W, W + 1.5, outside) * (1 - smoothstep(W + 2, W + 9, outside));
      }

      // Cliff walls at the map edge, like the original's bowl-shaped arenas.
      const edge = half - Math.max(Math.abs(x), Math.abs(z));
      h += smoothstep(60, 0, edge) * 55;

      heights[iz * n + ix] = h;
      trackDistance[iz * n + ix] = dist;
    }
  }
  return { cells, size, cellSize, heights, trackDistance, track };
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
