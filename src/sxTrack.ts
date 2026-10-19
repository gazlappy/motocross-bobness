import { type Jump, Track, type TrackDef } from './track.ts';

// Supercross tracks made of pieces on a grid, like the original's track editor: a start tile and
// heading, then a chain of pieces (straights carrying the features, and 90-degree turns), each on the
// next tile along. A track is closed when the chain comes back into its start tile, heading the same way.

/** The stadium floor: 14 x 7 tiles of 10 m. */
export const SX_COLS = 14;
export const SX_ROWS = 7;
export const SX_TILE = 10;

export type SxPiece = 'finish' | 'straight' | 'jump' | 'smallJump' | 'mound' | 'smallMound' | 'table' | 'whoops' | 'left' | 'right';

/** Headings: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x). */
export type SxDir = 0 | 1 | 2 | 3;

export interface SxTrack {
  name: string;
  start: { col: number; row: number; dir: SxDir };
  /** The first piece is the start/finish line. */
  pieces: SxPiece[];
}

export const SX_PIECES: { id: SxPiece; name: string; turn?: 1 | -1 }[] = [
  { id: 'straight', name: 'Straight' },
  { id: 'jump', name: 'Big jump' },
  { id: 'smallJump', name: 'Small jump' },
  { id: 'mound', name: 'Big mound' },
  { id: 'smallMound', name: 'Small mound' },
  { id: 'table', name: 'Tabletop' },
  { id: 'whoops', name: 'Whoops' },
  { id: 'left', name: 'Turn left', turn: -1 },
  { id: 'right', name: 'Turn right', turn: 1 },
];

const STEP: Record<SxDir, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

export const isTurn = (p: SxPiece) => p === 'left' || p === 'right';

/** Each feature's shape within its tile (heights from the original's pieces, in metres) and the AI's take-off speed. */
const FEATURES: Partial<Record<SxPiece, (Omit<Jump, 'at'> & { offset: number })[]>> = {
  // Each fits its own tile and is safe to land on flat ground or on the next feature: random tracks
  // and the editor put them in any order.
  jump: [{ offset: 0.5, up: 4.5, rise: 1.1, top: 0.4, down: 4.5, speed: 8 }],
  smallJump: [{ offset: 1, up: 4, rise: 0.8, top: 0.3, down: 4, speed: 8 }],
  mound: [{ offset: 0.5, up: 4.5, rise: 0.9, top: 0, down: 4.5, speed: 8 }],
  smallMound: [{ offset: 1, up: 4, rise: 0.55, top: 0, down: 4, speed: 8 }],
  table: [{ offset: 0.5, up: 3, rise: 1.0, top: 3, down: 3, speed: 8 }],
  whoops: [0.3, 3.6, 6.9].map((offset) => ({ offset, up: 1.4, rise: 0.25, top: 0, down: 1.4, speed: 7 })),
};

export interface SxCell {
  col: number;
  row: number;
  /** Heading entering this tile, and leaving it. */
  dirIn: SxDir;
  dirOut: SxDir;
  piece: SxPiece;
}

/** Walk the chain: the tile each piece sits on, and where the chain ends up. */
export function walk(t: SxTrack) {
  const cells: SxCell[] = [];
  let { col, row, dir } = t.start;
  for (const piece of t.pieces) {
    const out = (piece === 'left' ? (dir + 3) % 4 : piece === 'right' ? (dir + 1) % 4 : dir) as SxDir;
    cells.push({ col, row, dirIn: dir, dirOut: out, piece });
    dir = out;
    col += STEP[dir][0];
    row += STEP[dir][1];
  }
  return { cells, next: { col, row, dir } };
}

/** What's wrong with a track (empty when it's ready to ride). */
export function problems(t: SxTrack) {
  const { cells, next } = walk(t);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= SX_COLS || c.row >= SX_ROWS) {
      out.push('runs off the floor');
      break;
    }
    const k = `${c.col},${c.row}`;
    if (seen.has(k)) {
      out.push('crosses itself');
      break;
    }
    seen.add(k);
  }
  if (t.pieces[0] !== 'finish') out.push('must start at the start/finish line');
  const closed = next.col === t.start.col && next.row === t.start.row && next.dir === t.start.dir;
  if (!closed) out.push('isn\'t a closed loop yet');
  if (t.pieces.length < 8) out.push('is too short');
  return out;
}

/** Centre of a tile, in world metres (the floor is centred on the origin). */
export function tileCentre(col: number, row: number): [number, number] {
  return [(col - SX_COLS / 2 + 0.5) * SX_TILE, (row - SX_ROWS / 2 + 0.5) * SX_TILE];
}

/** The track as the game's TrackDef: centreline through the tiles, and the features as jumps. */
export function toTrackDef(t: SxTrack): TrackDef {
  const { cells } = walk(t);
  const control: [number, number][] = [];
  const entries: [number, number][] = [];
  for (const c of cells) {
    const [cx, cz] = tileCentre(c.col, c.row);
    const [ix, iz] = STEP[c.dirIn];
    const entry: [number, number] = [cx - (ix * SX_TILE) / 2, cz - (iz * SX_TILE) / 2];
    entries.push(entry);
    control.push(entry);
    if (isTurn(c.piece)) {
      // The arc's midpoint: from the tile's inside corner, half a tile out along the diagonal.
      const [ox, oz] = STEP[c.dirOut];
      const corner: [number, number] = [cx + (ox * SX_TILE) / 2 - (ix * SX_TILE) / 2, cz + (oz * SX_TILE) / 2 - (iz * SX_TILE) / 2];
      const r = SX_TILE / 2, k = Math.SQRT1_2;
      const dx = (cx - corner[0]) / (SX_TILE / 2), dz = (cz - corner[1]) / (SX_TILE / 2);
      control.push([corner[0] + dx * r * k, corner[1] + dz * r * k]);
    } else {
      control.push([cx, cz]);
    }
  }
  const base: TrackDef = {
    name: t.name, control, halfWidth: 3.8, jumps: [], bermScale: 22, bermMax: 1.2, curvatureWindow: 3,
  };
  // Where each tile starts along the lap, from a first build without the jumps.
  const plain = new Track(base);
  const jumps: Jump[] = [];
  cells.forEach((c, i) => {
    for (const f of FEATURES[c.piece] ?? []) {
      const [x, z] = entries[i];
      const s = plain.nearest(x, z, 20)?.s ?? 0;
      const { offset, ...jump } = f;
      jumps.push({ ...jump, at: s + offset });
    }
  });
  return { ...base, jumps };
}

/**
 * Tile edges where two lanes run side by side without being next to each other on the lap: these get
 * barriers so nobody hops across. Each edge is the tile and the side it's on.
 */
export function barrierEdges(t: SxTrack) {
  const { cells } = walk(t);
  const index = new Map(cells.map((c, i) => [`${c.col},${c.row}`, i]));
  const n = cells.length;
  const edges: { col: number; row: number; side: SxDir }[] = [];
  cells.forEach((c, i) => {
    for (const side of [1, 2] as SxDir[]) {
      const [dx, dz] = STEP[side];
      const j = index.get(`${c.col + dx},${c.row + dz}`);
      if (j === undefined) continue;
      const apart = Math.min((j - i + n) % n, (i - j + n) % n);
      if (apart > 1) edges.push({ col: c.col, row: c.row, side });
    }
  });
  return edges;
}

/** A seeded random number generator. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * A random track: four lanes across the floor joined by hairpins (each a turn, a straight and a
 * turn), with the hairpins at varied columns so no two tracks are the same shape, and a return lane up
 * the west side into a 40 m start straight. Features go onto the straights with a flat tile after
 * each, none on the start straight or right before or after a turn.
 */
export function randomTrack(seed: number, name = 'Random'): SxTrack {
  const rand = rng(seed * 7919 + 13);
  const pick = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const lanes = [0, 2, 4, 6];
  // Hairpin columns: east ends of lanes 0-1 and 2-3, west end of lanes 1-2.
  const eastA = pick(9, SX_COLS - 1), eastB = pick(9, SX_COLS - 1), west = pick(2, 4);
  const startCol = 5;
  const pieces: SxPiece[] = ['finish'];
  const run = (n: number) => { for (let k = 0; k < n; k++) pieces.push('straight'); };
  // Lane 0 east from the start to its hairpin.
  run(eastA - startCol - 1);
  pieces.push('right', 'straight', 'right'); // down to lane 1, heading west
  run(eastA - west - 1); // lane 1 west to its hairpin
  pieces.push('left', 'straight', 'left'); // down to lane 2, heading east
  run(eastB - west - 1);
  pieces.push('right', 'straight', 'right'); // down to lane 3, heading west
  run(eastB - 1); // lane 3 west to column 1
  pieces.push('right'); // column 0: up the return lane
  run(lanes[3] - 1);
  pieces.push('right'); // row 0: east into the start straight
  run(startCol - 1);
  const track: SxTrack = { name, start: { col: startCol, row: lanes[0], dir: 1 }, pieces };

  const { cells } = walk(track);
  const n = cells.length;
  const kinds: SxPiece[] = ['jump', 'smallJump', 'mound', 'smallMound', 'table', 'whoops'];
  for (let i = 2; i < n - startCol; i++) {
    if (cells[i].piece !== 'straight') continue;
    const prev = track.pieces[i - 1], next = cells[(i + 1) % n].piece;
    if (isTurn(prev) || isTurn(next) || prev !== 'straight') continue;
    if (rand() < 0.75) track.pieces[i] = kinds[Math.floor(rand() * kinds.length)];
  }
  return track;
}
