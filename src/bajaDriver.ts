import * as THREE from 'three';
import type { Controls } from './input.ts';
import type { Player } from './player.ts';
import type { Racer } from './competition.ts';
import type { BajaRace } from './bajaRace.ts';
import { type Heightmap, sampleHeight } from './heightmap.ts';
import { type Driver, airControls } from './ai.ts';

// A Baja AI rider: heads straight for its next waypoint, reading the ground ahead and easing off
// for steep climbs, drops and rough going.

const TOP_SPEED = 26; // m/s
const STUCK_TIME = 3.5;

const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();

export class BajaDriver implements Driver {
  readonly player: Player;
  private race: BajaRace;
  private racer: Racer;
  private hm: Heightmap;
  private skill: number;
  private stuck = 0;
  /** A fixed sideways offset so the field doesn't all take exactly the same line. */
  private offset: number;

  constructor(player: Player, race: BajaRace, racer: Racer, hm: Heightmap, skill: number, offset: number) {
    this.player = player;
    // Braking on the edge of grip, never locking up and sliding.
    player.bike.canLockRear = false;
    this.race = race;
    this.racer = racer;
    this.hm = hm;
    this.skill = skill;
    this.offset = offset;
  }

  /** Steepest change in height per metre along a line from (x, z). */
  private worstGrade(x: number, z: number, hx: number, hz: number, length: number) {
    let worst = 0;
    let prev = sampleHeight(this.hm, x, z);
    for (let d = 5; d <= length; d += 5) {
      const h = sampleHeight(this.hm, x + hx * d, z + hz * d);
      worst = Math.max(worst, Math.abs(h - prev) / 5);
      prev = h;
    }
    return worst;
  }

  controls(dt: number, _others: Player[], go: boolean): Controls {
    const c: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
    const p = this.player, bike = p.bike;
    if (!go) {
      c.brake = 1;
      return c;
    }
    if (p.crashed || this.racer.finished) return c;
    if (!bike.grounded) {
      airControls(bike, c);
      return c;
    }

    const t = bike.body.translation();
    const w = this.race.target(this.racer);
    const dx = w.x - t.x, dz = w.z - t.z;
    const dist = Math.hypot(dx, dz);
    // Aim a little to one side until close, so riders spread out over the desert.
    const side = dist > 60 ? this.offset : 0;
    const ax = w.x + (-dz / dist) * side, az = w.z + (dx / dist) * side;

    // Feel for the easiest way towards the waypoint: try headings either side of it and take the
    // one with the gentlest ground ahead, preferring the direct line.
    const direct = Math.atan2(ax - t.x, az - t.z);
    let bestHeading = direct, bestCost = Infinity, bestGrade = 0;
    for (const off of [0, -0.35, 0.35, -0.7, 0.7, -1.05, 1.05]) {
      const heading = direct + off;
      const grade = this.worstGrade(t.x, t.z, Math.sin(heading), Math.cos(heading), 35);
      const cost = Math.max(0, grade - 0.25) * 4 + Math.abs(off) * 0.4;
      if (cost < bestCost) { bestCost = cost; bestHeading = heading; bestGrade = grade; }
    }
    const hx = Math.sin(bestHeading), hz = Math.cos(bestHeading);

    const r = bike.body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    const local = _f.set(hx, 0, hz).applyQuaternion(_q);
    const angle = Math.atan2(local.x, -local.z);
    c.steer = THREE.MathUtils.clamp(angle * 1.4, -1, 1);

    // Steep slopes, sudden drops and bumps on the chosen line all mean slower.
    let target = TOP_SPEED * this.skill;
    if (bestGrade > 0.35) target = Math.min(target, 9);
    else if (bestGrade > 0.2) target = Math.min(target, 15);
    // Turn first, then go: sharp heading changes need slowing down.
    if (Math.abs(angle) > 0.5) target = Math.min(target, 10);
    if (dist < 40) target = Math.min(target, 12 + dist * 0.3);

    const v = bike.speed;
    c.throttle = v < target ? THREE.MathUtils.clamp((target - v) * 0.5 + 0.35, 0, 1) : 0;
    c.brake = v > target + 1.5 ? THREE.MathUtils.clamp((v - target) * 0.4, 0, 1) : 0;

    this.stuck = Math.abs(v) < 1.2 ? this.stuck + dt : 0;
    if (this.stuck > STUCK_TIME) {
      this.stuck = 0;
      p.reset();
    }
    return c;
  }
}
