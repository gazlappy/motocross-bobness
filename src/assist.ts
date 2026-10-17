import * as THREE from 'three';
import type { Bike } from './bike.ts';
import type { Controls } from './input.ts';
import { landingLean } from './ai.ts';

// Easy controls: the rider shifts their own weight, so you only steer, gas and brake. In the air they
// line the bike up for the landing; pulling away they keep the front wheel down. Leaning by hand (or
// holding a stunt button) always overrides it.

export function easyAssist(bike: Bike, c: Controls) {
  if (c.leanByHand || c.stunt) return;
  if (!bike.grounded) {
    c.leanForward = landingLean(bike);
    return;
  }
  // Weight forward when a launch lifts the front. Only then: off a jump face it would nose-dive the
  // landing, and the bike already corners and brakes well with the rider centred.
  const launching = bike.speed < 9 && c.throttle > 0.5;
  c.leanForward = launching ? THREE.MathUtils.clamp(bike.wheelieAngle * 3, 0, 1) : 0;
}
