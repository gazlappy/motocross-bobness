import { Noise2D } from './noise.ts';
import { Track } from './track.ts';

export interface Heightmap {
  /** Cells per side; there are (cells + 1)^2 height samples. */
  cells: number;
  /** World size of one side in metres. The map is centred on the origin. */
  size: number;
  cellSize: number;
  /** Row-major: heights[iz * (cells + 1) + ix]. */
  heights: Float32Array;
  /** Distance from each height sample to the track centreline (large where there's no track). */
  trackDistance: Float32Array;
  track: Track | null;
}

/** Everything needed to build a venue's ground. */
export interface TerrainDef {
  size: number;
  cells: number;
  seed: number;
  /** Ground height before any track work. */
  natural: (noise: Noise2D, x: number, z: number) => number;
  /** Cliff wall round the map edge: its height and how far in from the edge it starts. */
  edgeWall: { height: number; width: number } | null;
  track: Track | null;
  /** Distance from the track over which the hills fade back to their natural height. */
  trackBlend: number;
  /** Spots levelled flat (start areas, Baja waypoints). */
  flats?: { x: number; z: number; r: number }[];
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const FAR = 1000;

export function buildHeightmap(def: TerrainDef): Heightmap {
  const { size, cells, track } = def;
  const noise = new Noise2D(def.seed);
  const n = cells + 1;
  const half = size / 2;
  const cellSize = size / cells;
  const heights = new Float32Array(n * n);
  const trackDistance = new Float32Array(n * n).fill(FAR);
  const flats = (def.flats ?? []).map((f) => ({ ...f, h: def.natural(noise, f.x, f.z) }));

  // For each block of the map, the track samples that could be nearest to a point in it
  // (anything further than `reach` away is treated as off the track).
  const BLOCK = 16, reach = def.trackBlend + 10;
  const blocks = Math.ceil(size / BLOCK);
  const candidates: number[][] = [];
  const samples = track?.samples ?? [];
  const levels = samples.map((_, i) => track!.elevation(track!.sAt(i)));
  if (track) {
    for (let bz = 0; bz < blocks; bz++) {
      for (let bx = 0; bx < blocks; bx++) {
        const cx = -half + (bx + 0.5) * BLOCK, cz = -half + (bz + 0.5) * BLOCK;
        const r = reach + BLOCK;
        const list: number[] = [];
        samples.forEach((smp, i) => {
          if ((smp.x - cx) ** 2 + (smp.z - cz) ** 2 < r * r) list.push(i);
        });
        candidates.push(list);
      }
    }
  }

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -half + ix * cellSize;
      const z = -half + iz * cellSize;
      let h = def.natural(noise, x, z);

      for (const f of flats) {
        const d = Math.hypot(x - f.x, z - f.z);
        if (d < f.r) h += (f.h - h) * (1 - smoothstep(f.r * 0.55, f.r, d));
      }

      if (track) {
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
        if (best >= 0) {
          const W = track.halfWidth;
          const dist = Math.sqrt(bestD);
          const smp = samples[best];
          const along = (x - smp.x) * smp.tx + (z - smp.z) * smp.tz; // exact position between samples
          const s = track.sAt(best) + along;
          const lateral = (x - smp.x) * smp.tz - (z - smp.z) * smp.tx;
          const base = levelSum / wSum;

          // Hills fade into the track's own level over the infield and shoulders.
          h = base + (h - base) * smoothstep(W + 2, def.trackBlend, dist);

          // Jumps span the track and taper off at its edges.
          h += track.jumpProfile(s) * (1 - smoothstep(W - 1, W + 4, dist));

          // Berms: the outside of every turn banks up, more for tighter turns.
          const k = smp.curvature;
          if (Math.abs(k) > 0.005) {
            const outside = -Math.sign(k) * lateral;
            const berm = Math.min(track.def.bermMax, Math.abs(k) * track.def.bermScale);
            h += berm * smoothstep(0.15 * W, W + 1.5, outside) * (1 - smoothstep(W + 2, W + 9, outside));
          }
          trackDistance[iz * n + ix] = dist;
        }
      }

      // Cliff walls at the map edge, like the original's bowl-shaped arenas.
      if (def.edgeWall) {
        const edge = half - Math.max(Math.abs(x), Math.abs(z));
        h += smoothstep(def.edgeWall.width, 0, edge) * def.edgeWall.height;
      }
      heights[iz * n + ix] = h;
    }
  }
  return { cells, size, cellSize, heights, trackDistance, track };
}

/** The Nationals venue's ground: rolling desert hills with the track carved through. */
export function nationalsTerrain(track = new Track()): TerrainDef {
  return {
    size: 640,
    cells: 512,
    seed: 7,
    natural: (noise, x, z) =>
      noise.fbm(x / 230, z / 230, 5) * 34 +
      Math.max(0, noise.fbm(x / 95 + 13.1, z / 95 - 4.2, 4)) * 18 +
      noise.fbm(x / 18, z / 18, 2) * 0.5,
    edgeWall: { height: 55, width: 60 },
    track,
    trackBlend: 90,
  };
}

/** The Nationals map (kept as the default for the test scripts). */
export function generateHeightmap(track = new Track()): Heightmap {
  return buildHeightmap(nationalsTerrain(track));
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
