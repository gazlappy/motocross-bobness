import * as THREE from 'three';

// A race track: a closed loop sampled every metre, with its jumps. Everything that needs to know
// "where on the track is this?" (terrain carving, race progress, AI, respawns) asks here.

export interface Jump {
  at: number; // distance along the track where the take-off ramp starts
  up: number; // ramp length
  rise: number;
  top: number; // flat top length (0 = kicker)
  down: number; // landing length
  /** Take-off speed (m/s) the AI aims for: the middle of the clean range from scripts/jump-speeds.ts. */
  speed: number;
}

export interface TrackDef {
  name: string;
  /** Control points (x, z), driven in this order. The start line is the first point. */
  control: [number, number][];
  halfWidth: number;
  jumps: Jump[];
  /** Height of the track's own level along the lap (before jumps and berms). */
  elevation?: (s: number, length: number) => number;
  /** Berm height per unit curvature, and its cap (m). */
  bermScale: number;
  bermMax: number;
  /** Metres either side over which curvature is averaged (wider = berms build more gradually). */
  curvatureWindow: number;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const nationalsJumps: Jump[] = [
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
  // Whoops: a run of small, tight bumps.
  ...Array.from({ length: 7 }, (_, i) => ({ at: 638 + i * 5, up: 2.5, rise: 0.6, top: 0, down: 2.5, speed: 13 })),
];

/** The outdoor Nationals loop, ~940 m. */
export const NATIONALS: TrackDef = {
  name: 'Nationals',
  control: [
    [0, 40], [0, -60], [0, -180], [-15, -235], [-60, -258], [-115, -245], [-145, -200],
    [-150, -140], [-120, -95], [-150, -45], [-135, 10], [-120, 60], [-90, 105], [-45, 125], [-8, 100],
  ],
  halfWidth: 7,
  jumps: nationalsJumps,
  // Gentle ups and downs around the lap, so it isn't a flat oval.
  elevation: (s, length) => {
    const a = (s / length) * Math.PI * 2;
    return 3.5 * Math.sin(2 * a + 1) + 2 * Math.sin(3 * a + 2.2) + 1;
  },
  bermScale: 85,
  bermMax: 2.2,
  curvatureWindow: 14,
};

export interface TrackSample {
  x: number;
  z: number;
  /** Unit tangent (direction of travel), x/z. */
  tx: number;
  tz: number;
  /** Signed curvature (1/m): positive turns left. */
  curvature: number;
}

export interface TrackHit {
  /** Distance along the track from the start line. */
  s: number;
  /** Signed distance from the centreline: positive is to the left of the direction of travel. */
  lateral: number;
  /** Unsigned distance from the centreline. */
  distance: number;
  index: number;
}

export class Track {
  readonly def: TrackDef;
  readonly samples: TrackSample[];
  readonly length: number;
  readonly halfWidth: number;
  readonly jumps: Jump[];
  private grid = new Map<string, number[]>();
  private static CELL = 20;

  constructor(def: TrackDef = NATIONALS) {
    this.def = def;
    this.halfWidth = def.halfWidth;
    this.jumps = [...def.jumps].sort((a, b) => a.at - b.at);
    const curve = new THREE.CatmullRomCurve3(
      def.control.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    const n = Math.round(this.length);
    const pts = curve.getSpacedPoints(n).slice(0, n); // closed: last point repeats the first
    this.samples = pts.map((p, i) => {
      const next = pts[(i + 1) % n], prev = pts[(i - 1 + n) % n];
      const tx = next.x - prev.x, tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      return { x: p.x, z: p.z, tx: tx / len, tz: tz / len, curvature: 0 };
    });
    // Curvature from the change in heading per metre, smoothed so berms don't ripple.
    const step = this.length / n;
    const raw = this.samples.map((_s, i) => {
      const a = this.samples[(i - 2 + n) % n], b = this.samples[(i + 2) % n];
      const cross = a.tx * b.tz - a.tz * b.tx; // + for a right turn in x/z (z is "down" when seen from above)
      return -Math.asin(Math.max(-1, Math.min(1, cross))) / (4 * step);
    });
    // A wide window, so berms build up gradually into each turn instead of rising like a ramp.
    const w = def.curvatureWindow;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -w; k <= w; k++) sum += raw[(i + k + n) % n];
      this.samples[i].curvature = sum / (2 * w + 1);
    }
    this.samples.forEach((s, i) => {
      const key = this.key(s.x, s.z);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key)!.push(i);
    });
  }

  /** Height of jumps (above the track's own level) at a distance along the lap. */
  jumpProfile(s: number) {
    s = ((s % this.length) + this.length) % this.length;
    let h = 0;
    for (const j of this.jumps) {
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

  /** The track's own level (before jumps and berms) at a distance along the lap. */
  elevation(s: number) {
    return this.def.elevation?.(s, this.length) ?? 0;
  }

  private key(x: number, z: number) {
    return `${Math.floor(x / Track.CELL)},${Math.floor(z / Track.CELL)}`;
  }

  /** Distance along the track of sample `i`. */
  sAt(i: number) {
    return (i / this.samples.length) * this.length;
  }

  sample(s: number) {
    const n = this.samples.length;
    const i = ((Math.round((s / this.length) * n) % n) + n) % n;
    return this.samples[i];
  }

  /** Nearest point on the track, searching only near the point (null if nothing within `radius`). */
  nearest(x: number, z: number, radius = 60): TrackHit | null {
    const cells = Math.ceil(radius / Track.CELL);
    const cx = Math.floor(x / Track.CELL), cz = Math.floor(z / Track.CELL);
    let best = -1, bestD = radius * radius;
    for (let i = -cells; i <= cells; i++) {
      for (let j = -cells; j <= cells; j++) {
        for (const idx of this.grid.get(`${cx + i},${cz + j}`) ?? []) {
          const s = this.samples[idx];
          const d = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
    }
    return best < 0 ? null : this.hit(best, x, z);
  }

  /** Nearest point, searching only within `window` metres of a previous position along the track. */
  follow(x: number, z: number, nearS: number, window = 25): TrackHit {
    const n = this.samples.length;
    const centre = Math.round((nearS / this.length) * n);
    let best = centre, bestD = Infinity;
    for (let k = -window; k <= window; k++) {
      const idx = (((centre + k) % n) + n) % n;
      const s = this.samples[idx];
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) { bestD = d; best = idx; }
    }
    return this.hit(((best % n) + n) % n, x, z);
  }

  private hit(index: number, x: number, z: number): TrackHit {
    const s = this.samples[index];
    const dx = x - s.x, dz = z - s.z;
    // Left of travel: tangent rotated 90 deg anticlockwise seen from above is (tz, -tx).
    const lateral = dx * s.tz - dz * s.tx;
    return { s: this.sAt(index), lateral, distance: Math.hypot(dx, dz), index };
  }
}
