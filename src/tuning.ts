import type { BikeSpec } from './bikes.ts';

// The garage, as in the original: pick one of three engine power curves, set the front and rear
// springs and damping from soft to stiff, and the tyres' traction. Applies to whichever bike you ride.

export type EngineChoice = 'stock' | 'A' | 'B' | 'C';

export interface Tuning {
  engine: EngineChoice;
  /** Each -2 (soft / less) .. +2 (stiff / more), 0 = factory. */
  frontSpring: number;
  frontDamping: number;
  rearSpring: number;
  rearDamping: number;
  traction: number;
}

export const DEFAULT_TUNING: Tuning = {
  engine: 'stock', frontSpring: 0, frontDamping: 0, rearSpring: 0, rearDamping: 0, traction: 0,
};

/** How much one slider step changes a spring, a damper or the tyres' grip. */
const SPRING_STEP = 0.12;
const DAMPING_STEP = 0.12;
const GRIP_STEP = 0.05;
/** Grippier, softer tyres roll a little heavier. */
const ROLLING_STEP = 0.25;

export const ENGINES: { id: EngineChoice; name: string; blurb: string }[] = [
  { id: 'stock', name: 'Stock', blurb: 'The bike as it left the factory.' },
  { id: 'A', name: 'A', blurb: 'Strong low end, peaks late and pulls over a wide spread of revs, fading gently past the top. Steady power for the quarry and tag.' },
  { id: 'B', name: 'B', blurb: 'Hits hard in the midrange and revs out fast, then tails off. Solid, usable power for supercross and Baja.' },
  { id: 'C', name: 'C', blurb: 'Soft at the bottom, then rushes to full power and holds it right through the top end. Bursts of speed for the quarry and tag.' },
];

/**
 * The original's three 250 power curves: horsepower at rpm, for a 10,000 rpm redline. Only their
 * shape is used: each bike keeps its own peak torque and rev range.
 */
const ORIGINAL_HP: Record<Exclude<EngineChoice, 'stock'>, [number, number][]> = {
  A: [[3000, 10], [3250, 11.5], [3750, 15], [4750, 20.5], [5250, 24], [5750, 26], [6750, 39], [7250, 43], [8250, 40.5], [8750, 37], [9250, 28.5], [10250, 25]],
  B: [[3000, 11], [4000, 16], [4500, 18], [4750, 19.5], [5500, 27], [5750, 29], [6250, 32], [6750, 33], [7000, 41], [7500, 43.5], [8250, 41.5], [8750, 42.5], [10250, 24]],
  C: [[3000, 10], [4000, 16.5], [4500, 18], [5000, 22], [5500, 25.5], [6000, 31.5], [6500, 37], [7000, 43], [7500, 46], [8000, 42.5], [8500, 38.5], [10250, 23]],
};
const ORIGINAL_REDLINE = 10000;

/** A bike's torque curve ([rpm, fraction of peak]) with the chosen engine. */
export function torqueCurve(spec: BikeSpec, engine: EngineChoice): [number, number][] {
  if (engine === 'stock') return spec.torqueCurve;
  const scale = spec.redline / ORIGINAL_REDLINE;
  const torque = ORIGINAL_HP[engine].map(([rpm, hp]) => [rpm * scale, hp / rpm] as [number, number]);
  const peak = Math.max(...torque.map(([, t]) => t));
  const curve = torque.map(([rpm, t]) => [rpm, t / peak] as [number, number]);
  const last = curve[curve.length - 1];
  // Below the first point the original holds torque flat; past the last it cuts out.
  return [[0, curve[0][1]], ...curve, [last[0] + 1000 * scale, 0]];
}

/** What the sliders do to the bike's physics, as multipliers. */
export function tuningFactors(t: Tuning) {
  return {
    frontSpring: 1 + SPRING_STEP * t.frontSpring,
    rearSpring: 1 + SPRING_STEP * t.rearSpring,
    frontDamping: 1 + DAMPING_STEP * t.frontDamping,
    rearDamping: 1 + DAMPING_STEP * t.rearDamping,
    grip: 1 + GRIP_STEP * t.traction,
    rolling: 1 + ROLLING_STEP * t.traction,
  };
}
