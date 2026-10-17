import * as THREE from 'three';

// The Nationals track: a closed loop through the map, sampled every metre. Everything that needs
// to know "where on the track is this?" (terrain carving, race progress, AI, respawns) asks here.

/** Control points (x, z), driven in this order. The start line is the first point. */
const CONTROL: [number, number][] = [
  [0, 40], [0, -60], [0, -180], [-15, -235], [-60, -258], [-115, -245], [-145, -200],
  [-150, -140], [-120, -95], [-150, -45], [-135, 10], [-120, 60], [-90, 105], [-45, 125], [-8, 100],
];

export const TRACK_HALF_WIDTH = 7;

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
  readonly samples: TrackSample[];
  readonly length: number;
  private grid = new Map<string, number[]>();
  private static CELL = 20;

  constructor() {
    const curve = new THREE.CatmullRomCurve3(
      CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
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
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -14; k <= 14; k++) sum += raw[(i + k + n) % n];
      this.samples[i].curvature = sum / 29;
    }
    this.samples.forEach((s, i) => {
      const key = this.key(s.x, s.z);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key)!.push(i);
    });
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
