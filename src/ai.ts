import * as THREE from 'three';
import type { Controls } from './input.ts';
import type { Player } from './player.ts';
import type { Track } from './track.ts';

// An AI rider: follows the track on its own lane, picks a speed it can carry through the corners it
// can see coming, keeps the bike's pitch matched to its flight in the air, and moves over to get
// past slower bikes.

const GRIP = 0.62 * 9.81; // cornering acceleration the AI trusts
const BRAKING = 5.5; // m/s^2 it plans to slow at
const TOP_SPEED = 30; // m/s
const LOOK_SPEED = 70; // m of track scanned for corners
const STUCK_TIME = 3.5;

const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** In the air: the forward/back lean that lines the bike up with its flight, to land on both wheels. */
export function landingLean(bike: Player['bike']) {
  const vel = bike.body.linvel();
  const flight = Math.atan2(vel.y, Math.hypot(vel.x, vel.z));
  const r = bike.body.rotation();
  _f.set(0, 0, -1).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
  const pitch = Math.asin(THREE.MathUtils.clamp(_f.y, -1, 1));
  // Only correct big errors; the bike already tends to follow its flight.
  const err = pitch - flight * 0.5;
  return Math.abs(err) > 0.2 ? THREE.MathUtils.clamp((err - Math.sign(err) * 0.2) * 2, -1, 1) : 0;
}

/** In the air, line the bike up with its flight so it lands on both wheels. */
export function airControls(bike: Player['bike'], c: Controls) {
  c.leanForward = landingLean(bike);
  c.steer = 0;
  c.throttle = 0.3;
}

/** Anything that can ride a bike: the AI drivers. */
export interface Driver {
  readonly player: Player;
  controls(dt: number, others: Player[], go: boolean): Controls;
}

export interface AIOptions {
  /** 0..1 fraction of the ideal corner and top speeds. */
  skill: number;
  /** Home lane: metres left of the centreline. */
  lane: number;
}

export class AIDriver implements Driver {
  readonly player: Player;
  private track: Track;
  private skill: number;
  private homeLane: number;
  private lane: number;
  private s: number;
  private stuck = 0;

  constructor(player: Player, track: Track, opts: AIOptions) {
    this.player = player;
    // Braking on the edge of grip, never locking up and sliding.
    player.bike.canLockRear = false;
    // AI bikes pass through each other (packs jostling made them judder); they still bump you.
    player.bike.riddenByAi();
    this.track = track;
    this.skill = opts.skill;
    this.homeLane = this.lane = opts.lane;
    const t = player.bike.body.translation();
    this.s = track.nearest(t.x, t.z, 100)?.s ?? 0;
    player.lane = opts.lane;
  }

  controls(dt: number, others: Player[], go: boolean): Controls {
    const c: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
    const p = this.player, bike = p.bike;
    if (!go) {
      c.brake = 1;
      return c;
    }
    if (p.crashed) return c;

    const t = bike.body.translation();
    let hit = this.track.follow(t.x, t.z, this.s, 30);
    if (hit.distance > 30) hit = this.track.nearest(t.x, t.z, 400) ?? hit;
    this.s = hit.s;
    const v = bike.speed;

    // Near a jump, commit: hold the line, keep the bike straight, don't touch the brakes.
    const L = this.track.length;
    const onJump = this.track.jumpProfile(this.s) > 0.05 || !bike.grounded ||
      this.track.jumps.some((j) => { const d = (((j.at - this.s) % L) + L) % L; return d < 18; });

    if (!onJump) this.chooseLane(dt, others);

    // Steer at a point ahead on our lane, further ahead the faster we go.
    const ahead = this.track.sample(this.s + 9 + Math.max(0, v) * 0.8);
    // Through a hairpin tighter than the lanes are wide, everyone takes the middle.
    let tightest = 0;
    for (let d = 0; d <= 12; d += 3) tightest = Math.max(tightest, Math.abs(this.track.sample(this.s + d).curvature));
    const lane = this.lane * (1 - THREE.MathUtils.smoothstep(tightest, 0.05, 0.15));
    const tx = ahead.x + ahead.tz * lane, tz = ahead.z - ahead.tx * lane;
    const r = bike.body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    const local = _f.set(tx - t.x, 0, tz - t.z).applyQuaternion(_q);
    const angle = Math.atan2(local.x, -local.z); // + = target is to the right
    // Gentle gain: steering sets the lean, which takes a moment to build, so eager steering weaves.
    c.steer = bike.grounded ? THREE.MathUtils.clamp(angle * (onJump ? 0.8 : 1.4), -1, 1) : 0;

    // Fastest speed from which every corner in view can still be made with steady braking.
    let target = TOP_SPEED * this.skill;
    for (let d = 0; d <= LOOK_SPEED; d += 3) {
      const k = Math.abs(this.track.sample(this.s + d).curvature);
      const corner = k > 1e-4 ? Math.sqrt((GRIP * this.skill) / k) : Infinity;
      // Braking downhill takes longer: gravity eats into it.
      const fall = Math.max(0, (this.track.elevation(this.s) - this.track.elevation(this.s + d)) / Math.max(d, 8));
      target = Math.min(target, Math.sqrt(corner * corner + 2 * Math.max(2, BRAKING - 9.81 * fall) * d));
    }
    // Hit each jump at the speed it's built for (overshooting a landing is as bad as casing it).
    for (const j of this.track.jumps) {
      const d = (((j.at - this.s) % L) + L) % L;
      if (d > LOOK_SPEED) continue;
      // Slow, technical sections (supercross rhythms, whoops): be at speed before committing at
      // the first jump, then let each next jump set the pace.
      const technical = j.speed < 12.5 && !this.track.jumps.some((o) => o !== j && j.at - o.at > 0 && j.at - o.at < 30);
      target = Math.min(target, Math.sqrt(j.speed * j.speed + 2 * BRAKING * Math.max(0, d - (technical ? 18 : 3))));
    }
    if (bike.grounded) {
      c.throttle = v < target ? THREE.MathUtils.clamp((target - v) * 0.5 + 0.35, 0, 1) : 0;
      // Firm but not grabbing a fistful, weight back as it bites so the bike doesn't stand on its nose.
      c.brake = v > target + 0.8 && !onJump ? THREE.MathUtils.clamp((v - target) * 0.6, 0, 0.8) : 0;
      c.leanForward = -0.8 * c.brake;
    } else {
      airControls(bike, c);
    }

    // Way off line, stopped, or upside down for a while: pick the bike up.
    const lost = hit.distance > this.track.halfWidth + 25;
    this.stuck = (Math.abs(v) < 1.2 || lost) && bike.grounded ? this.stuck + dt : 0;
    if (this.stuck > STUCK_TIME) {
      this.stuck = 0;
      p.reset();
    }
    return c;
  }

  /** Drift back to the home lane, or swing out round a slower bike just ahead. */
  private chooseLane(dt: number, others: Player[]) {
    const me = this.player.bike;
    const t = me.body.translation();
    let blocked = false;
    for (const o of others) {
      if (o === this.player) continue;
      const ot = o.bike.body.translation();
      const hit = this.track.follow(ot.x, ot.z, this.s, 20);
      const gap = hit.s - this.s;
      if (gap > 0 && gap < 12 && Math.abs(hit.lateral - this.lane) < 2.2 && Math.hypot(ot.x - t.x, ot.z - t.z) < 14) {
        blocked = true;
        // Pass on whichever side has more room.
        const side = hit.lateral > 0 ? -1 : 1;
        this.lane = THREE.MathUtils.clamp(this.lane + side * 6 * dt, -4.5, 4.5);
      }
    }
    if (!blocked) this.lane += THREE.MathUtils.clamp(this.homeLane - this.lane, -1.5 * dt, 1.5 * dt);
    this.player.lane = this.lane;
  }
}
