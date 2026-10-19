import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Bike } from './bike.ts';
import type { Controls } from './input.ts';
import { type Heightmap, sampleHeight } from './heightmap.ts';
import { Ragdoll } from './ragdoll.ts';
import { StuntSystem } from './stunts.ts';
import type { Track } from './track.ts';
import { type BikeMounts, DEFAULT_PROPORTIONS, type RiderProportions, createPose, ridingPose } from './riderPose.ts';
import type { BikeSpec } from './bikes.ts';

// The player's bike and rider, including wipeouts: on a crash the rider becomes a ragdoll, the bike
// tumbles on its own, and once everything has settled the player is put back where they crashed.

const RAGDOLL_BIKE_CONTACT_DELAY = 0.5; // s before the thrown rider can hit the bike
const MIN_CRASH_TIME = 1.5;
const MAX_CRASH_TIME = 6;
const SETTLED_SPEED = 0.7;
const SETTLED_FOR = 0.6;

// The original's out-of-bounds "invisible slingshot": leave the map and you're fired back across it.
const OUT_OF_BOUNDS_MARGIN = 14; // m inside the map edge: across the flats on top of the boundary cliffs
const CANNON_GRAVITY = 0.6; // floaty flight
const CANNON_APEX = 35; // m above the launch point
const CANNON_LANDING_RADIUS = 40; // m around the map centre

// Racing, as in the original: leave the track and you have this long to rejoin it where you left it
// (cutting across to another part of the track doesn't count), or you're put back at that point.
const OFF_COURSE_MARGIN = 8; // m past the track's edge (the berms are still on course)
const OFF_COURSE_LIMIT = 5; // s
const OFF_COURSE_WARN = 1.5; // s before the countdown shows
const REJOIN_WINDOW = 30; // m either side of where you left that count as rejoining

const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);

/** Collision and contact-force events from one physics step, shared by every player in the world. */
export interface PhysicsEvents {
  collisions: [number, number, boolean][];
  forces: { h1: number; h2: number; magnitude: number }[];
}

export function drainEvents(queue: RAPIER.EventQueue): PhysicsEvents {
  const events: PhysicsEvents = { collisions: [], forces: [] };
  queue.drainCollisionEvents((h1, h2, started) => events.collisions.push([h1, h2, started]));
  queue.drainContactForceEvents((e) =>
    events.forces.push({ h1: e.collider1(), h2: e.collider2(), magnitude: e.totalForceMagnitude() }),
  );
  return events;
}

/** Run-ups (m of flat track before the next jump) to look for after a crash, longest first. */
const RUN_UPS = [40, 25, 15];

/** Back up from `s` to flat track with a run-up to the next jump, so a respawn isn't a trap. */
function safeRestart(track: Track, s: number) {
  const L = track.length;
  const flat = (x: number) => track.jumpProfile((((x % L) + L) % L)) < 0.05;
  // Not in a tight turn either (supercross hairpins), where a bike put down sideways falls over.
  const straight = (x: number) => Math.abs(track.sample(x).curvature) < 0.03;
  for (const runUp of RUN_UPS) {
    let at = s - 4;
    for (let back = 0; back < 200; back++, at--) {
      let clear = straight(at);
      for (let d = -6; d <= runUp && clear; d += 2) clear = flat(at + d);
      if (clear) return at;
    }
  }
  let at = s - 4;
  // No flat stretch nearby at all: settle for being off the jumps and out of the turns.
  for (let back = 0; back < 160 && !(flat(at) && straight(at)); back++) at--;
  return at;
}

export class Player {
  readonly bike: Bike;
  ragdoll: Ragdoll | null = null;
  readonly pose = createPose();
  readonly stunts = new StuntSystem();
  /** Body measurements of whichever rider model is shown. */
  proportions: RiderProportions = DEFAULT_PROPORTIONS;
  /** Grips and pegs of whichever bike model is shown (null: the placeholder's). */
  mounts: ((steer: number) => BikeMounts) | null = null;
  onCrash?: (cause: string) => void;
  onRespawn?: () => void;
  /** Ragdoll or bike slamming into something, 0..1. */
  onImpact?: (strength: number) => void;
  onCannon?: () => void;
  /** When set (racing), respawns and the cannon put you back on the track. */
  track: Track | null = null;
  /** Preferred distance left of the track centreline when put back on it. */
  lane = 0;
  /** Races: riding off the course for too long puts you back on it. */
  keepOnCourse = false;
  /** Off for venues with walls (Supercross). */
  cannonEnabled = true;
  /** Off-track events (Baja): where to back off to after a crash, and which way to face. */
  respawnGuide: { back(): THREE.Vector3; ahead(): THREE.Vector3 } | null = null;

  private world: RAPIER.World;
  private hm: Heightmap;
  private spawn: THREE.Vector3;
  private spawnYaw: number;
  private lastControls: Controls | null = null;
  private events = new RAPIER.EventQueue(true);
  private crashTime = 0;
  private settledTime = 0;
  private crashPos = new THREE.Vector3();
  private crashYaw = 0;
  private lastImpact = 0;
  private clock = 0;
  private cannonFlight = false;
  private cannonCooldown = 0;
  private cannonTime = 0;
  private offCourseTime = 0;
  /** Racing: how far round the lap you last were while on the track (null: find it afresh). */
  private courseS: number | null = null;
  /** Where you left the track. */
  private exitS = 0;

  constructor(world: RAPIER.World, hm: Heightmap, spawn: THREE.Vector3, yaw = 0, spec?: BikeSpec) {
    this.world = world;
    this.hm = hm;
    this.spawn = spawn.clone();
    this.spawnYaw = yaw;
    this.bike = new Bike(world, spawn, yaw, spec);
    this.bike.groundHeight = (x, z) => sampleHeight(hm, x, z);
  }

  get crashed() {
    return this.ragdoll !== null;
  }

  /** What the camera should look at: the rider while they tumble, otherwise the bike. */
  get focus() {
    return this.ragdoll?.centre ?? null;
  }

  /** Step a world containing only this player. With several players, use Sim instead. */
  physicsStep(c: Controls, dt: number) {
    this.beforeStep(c, dt);
    this.world.step(this.events);
    this.afterStep(dt, drainEvents(this.events));
  }

  /** Before the world steps: ride the bike. */
  beforeStep(c: Controls, dt: number) {
    this.clock += dt;
    this.lastControls = c;
    this.bike.step(c, dt);
  }

  /** After the world steps: react to what happened. */
  afterStep(dt: number, events: PhysicsEvents) {
    this.handleEvents(events);
    if (this.lastControls) this.stunts.step(this.lastControls, this.bike, dt);
    if (this.bike.crashCause && !this.crashed) this.startCrash(this.bike.crashCause);
    this.updateCannon(dt);
  }

  /** Respawn position and heading: the given spot, or the nearest bit of track while racing. */
  private placement(at: THREE.Vector3, yaw: number): [THREE.Vector3, number] {
    if (!this.track && this.respawnGuide) return this.guidedPlacement(at);
    const hit = this.track?.nearest(at.x, at.z, 400);
    if (!this.track || !hit) return [at, yaw];
    const p = this.track.sample(safeRestart(this.track, hit.s));
    const edge = Math.min(4, this.track.halfWidth * 0.5);
    const lane = THREE.MathUtils.clamp(this.lane, -edge, edge);
    return [new THREE.Vector3(p.x + p.tz * lane, at.y, p.z - p.tx * lane), Math.atan2(-p.tx, -p.tz)];
  }

  private updateCannon(dt: number) {
    const bike = this.bike;
    this.cannonTime += dt;
    // The wheels can still be touching for a moment after launch; that isn't the landing.
    if (this.cannonFlight && !this.crashed && bike.grounded && this.cannonTime > 0.5) {
      this.cannonFlight = false;
      bike.cannonLanding = false;
      bike.body.setGravityScale(1, true);
      bike.rider.body.setGravityScale(1, true);
    }
    this.cannonCooldown = Math.max(0, this.cannonCooldown - dt);
    if (this.cannonCooldown > 0 || !this.cannonEnabled) return;
    const at = this.ragdoll ? this.ragdoll.centre : vec(bike.body.translation());
    const limit = this.hm.size / 2 - OUT_OF_BOUNDS_MARGIN;
    if (Math.abs(at.x) > limit || Math.abs(at.z) > limit) this.fireCannon(at);
  }

  /** Launch whatever is out of bounds on a ballistic arc to a spot near the middle of the map. */
  private fireCannon(from: THREE.Vector3) {
    let target: THREE.Vector3;
    if (this.track) {
      // Racing: drop back onto the track just ahead of where you left it.
      const hit = this.track.nearest(from.x, from.z, 400);
      const p = this.track.sample(hit ? hit.s + 15 : Math.random() * this.track.length);
      target = new THREE.Vector3(p.x, 0, p.z);
    } else {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * CANNON_LANDING_RADIUS;
      target = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    }
    target.y = sampleHeight(this.hm, target.x, target.z) + 1;

    const g = 9.81 * CANNON_GRAVITY;
    const apex = Math.max(from.y, target.y) + CANNON_APEX;
    const up = Math.sqrt(2 * g * (apex - from.y));
    const flight = up / g + Math.sqrt((2 * (apex - target.y)) / g);
    const v = new THREE.Vector3((target.x - from.x) / flight, up, (target.z - from.z) / flight);

    const bike = this.bike;
    const bodies = this.ragdoll ? [...this.ragdoll.parts.values()].map((p) => p.body) : [bike.body, bike.rider.body];
    if (this.ragdoll) bodies.push(bike.body);
    for (const b of bodies) {
      b.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      b.setGravityScale(CANNON_GRAVITY, true);
    }
    if (!this.ragdoll) {
      // Point the bike along its flight so the rider has a chance at the landing.
      const yaw = Math.atan2(-v.x, -v.z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      bike.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      bike.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      bike.rider.snapTo(bike.body);
      bike.cannonLanding = true;
      this.cannonFlight = true;
    }
    this.crashPos.copy(target);
    this.cannonCooldown = 2;
    this.cannonTime = 0;
    this.onCannon?.();
  }

  private handleEvents(events: PhysicsEvents) {
    const bike = this.bike;
    const riderHandles = bike.rider.colliders.map((c) => c.handle);
    for (const [h1, h2, started] of events.collisions) {
      if (!started || this.crashed) continue;
      if (riderHandles.includes(h1) || riderHandles.includes(h2)) {
        // Easy: a boot or knee brushing the ground isn't a crash until the bike is really going over.
        const r = bike.body.rotation();
        const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
        if (!bike.assist || upY < 0.55) bike.crash('hit the dirt');
      }
      else if (h1 === bike.frame.handle || h2 === bike.frame.handle) {
        const r = bike.body.rotation();
        const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
        if (upY < 0.3) bike.crash('landed on its back');
      }
    }
    for (const f of events.forces) {
      if (!this.ragdoll || this.clock - this.lastImpact < 0.08) break;
      if (!this.ragdoll.ownsCollider(f.h1) && !this.ragdoll.ownsCollider(f.h2)) continue;
      this.lastImpact = this.clock;
      this.onImpact?.(Math.min(1, f.magnitude / 8000));
    }
  }

  private startCrash(cause: string) {
    const bike = this.bike;
    this.ridingPose();

    // The ragdoll leaves with the rider body's momentum, spin included.
    const r = bike.rider.body;
    const lv = r.linvel(), av = r.angvel(), com = r.worldCom();
    const v = new THREE.Vector3(lv.x, lv.y, lv.z);
    const w = new THREE.Vector3(av.x, av.y, av.z);
    const c = new THREE.Vector3(com.x, com.y, com.z);
    // Thrown clear, as in the original: up and on in the direction of travel, tumbling head over heels,
    // harder the faster you were going and hardest over the bars.
    const bv0 = bike.body.linvel();
    const travel = new THREE.Vector3(bv0.x, 0, bv0.z);
    const speed = travel.length();
    if (speed > 1) travel.divideScalar(speed);
    else travel.set(-Math.sin(bike.yaw), 0, -Math.cos(bike.yaw));
    const overBars = cause === 'over the bars' ? 1.6 : 1;
    v.addScaledVector(travel, Math.min(6, 0.12 * speed) * overBars);
    v.y += Math.min(7, 2.2 + 0.12 * speed) * (overBars > 1 ? 1.2 : 1);
    const flipAxis = new THREE.Vector3(-travel.z, 0, travel.x); // to the right of travel: forward roll
    w.addScaledVector(flipAxis, -Math.min(7, 1.5 + 0.2 * speed) * overBars);
    this.ragdoll = new Ragdoll(this.world, this.pose, (p) => w.clone().cross(p.clone().sub(c)).add(v));

    bike.rider.setActive(false);
    bike.crashed = true;
    bike.crashCause = null;

    const t = bike.body.translation();
    this.crashPos.set(t.x, t.y, t.z);
    const bv = bike.body.linvel();
    this.crashYaw = Math.hypot(bv.x, bv.z) > 2 ? Math.atan2(-bv.x, -bv.z) : bike.yaw;
    this.crashTime = 0;
    this.settledTime = 0;
    this.onCrash?.(cause);
  }

  /** Per rendered frame: crash timing and respawn, then the rider pose to draw. */
  update(dt: number) {
    this.tick(dt);
    return this.readPose();
  }

  /** Per rendered frame: crash timing and respawn. */
  tick(dt: number) {
    const t = this.bike.body.translation();
    if (this.ragdoll) {
      const prev = this.crashTime;
      this.crashTime += dt;
      if (prev < RAGDOLL_BIKE_CONTACT_DELAY && this.crashTime >= RAGDOLL_BIKE_CONTACT_DELAY) {
        this.ragdoll.enableBikeCollisions();
      }
      this.settledTime = this.ragdoll.speed < SETTLED_SPEED ? this.settledTime + dt : 0;
      const settled = this.crashTime > MIN_CRASH_TIME && this.settledTime > SETTLED_FOR;
      if (settled || this.crashTime > MAX_CRASH_TIME || this.ragdoll.centre.y < -50) this.respawn();
    } else if (t.y < -50) {
      this.reset(true);
    } else if (this.keepOnCourse && this.track && !this.cannonFlight) {
      const track = this.track;
      const hit = this.courseS === null ? track.nearest(t.x, t.z, 80) : track.follow(t.x, t.z, this.courseS, REJOIN_WINDOW);
      if (hit && hit.distance <= track.halfWidth + OFF_COURSE_MARGIN) {
        this.courseS = hit.s;
        this.offCourseTime = 0;
      } else {
        if (this.offCourseTime === 0) this.exitS = this.courseS ?? hit?.s ?? 0;
        this.offCourseTime += dt;
        if (this.offCourseTime > OFF_COURSE_LIMIT) this.returnToCourse();
      }
    }
    if (this.ragdoll || this.cannonFlight) this.offCourseTime = 0;
  }

  /** Back on the track where you left it (short of any jump there), facing down the track. */
  private returnToCourse() {
    const track = this.track!;
    let s = this.exitS;
    for (let k = 0; k < 80 && track.jumpProfile(s) > 0.05; k++) s -= 1;
    const p = track.sample(s);
    const lane = THREE.MathUtils.clamp(this.lane, -3, 3);
    this.placeBike(new THREE.Vector3(p.x + p.tz * lane, 0, p.z - p.tx * lane), Math.atan2(-p.tx, -p.tz), false);
    this.courseS = s;
    this.onRespawn?.();
  }

  /** Racing, off the track: where to rejoin it (null while on it). */
  get offCourseTarget() {
    if (this.offCourseTime === 0 || !this.track) return null;
    const p = this.track.sample(this.exitS);
    return new THREE.Vector3(p.x, 0, p.z);
  }

  /** Racing, riding off the course: seconds until you're put back on it (null while on course). */
  get offCourseCountdown() {
    return this.offCourseTime > OFF_COURSE_WARN ? OFF_COURSE_LIMIT - this.offCourseTime : null;
  }

  /** The rider pose to draw, from wherever the bodies are now. */
  readPose() {
    return this.ragdoll ? this.ragdoll.readPose(this.pose) : this.ridingPose();
  }

  private ridingPose() {
    const mounts = this.mounts?.(this.bike.steerAngle);
    return ridingPose(this.bike, this.pose, this.proportions, mounts, this.stunts.state);
  }

  /** Off-track: step back towards the guide's point until the ground is flat enough to ride away. */
  private guidedPlacement(at: THREE.Vector3): [THREE.Vector3, number] {
    const back = this.respawnGuide!.back();
    const dir = new THREE.Vector3(back.x - at.x, 0, back.z - at.z);
    const len = dir.length();
    dir.divideScalar(Math.max(1e-3, len));
    const p = at.clone();
    for (let d = 0; d < len; d += 8) {
      p.set(at.x + dir.x * d, 0, at.z + dir.z * d);
      if (this.flatAt(p.x, p.z)) break;
    }
    const ahead = this.respawnGuide!.ahead();
    return [p, Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z))];
  }

  private flatAt(x: number, z: number) {
    const h = (dx: number, dz: number) => sampleHeight(this.hm, x + dx, z + dz);
    const c = h(0, 0);
    return [h(4, 0), h(-4, 0), h(0, 4), h(0, -4)].every((v) => Math.abs(v - c) < 1.2);
  }

  /** Take this player's bodies out of the physics world (when a game ends). */
  dispose() {
    this.ragdoll?.destroy();
    this.ragdoll = null;
    this.world.removeRigidBody(this.bike.rider.body);
    this.world.removeRigidBody(this.bike.body);
  }

  /** Back on the bike where the crash happened, pointing the way they were going. */
  respawn() {
    this.ragdoll?.destroy();
    this.ragdoll = null;
    this.cannonFlight = false;
    this.placeBike(this.crashPos, this.crashYaw);
    this.onRespawn?.();
  }

  /** The R key: pick the bike up where it is (or skip the rest of a crash). */
  reset(toSpawn = false) {
    if (this.crashed) return this.respawn();
    const t = this.bike.body.translation();
    if (toSpawn) this.placeBike(this.spawn, this.spawnYaw, false);
    else this.placeBike(new THREE.Vector3(t.x, t.y, t.z), this.bike.yaw);
  }

  /** Put the bike back down at a spot (snapped onto the track while racing, unless `snap` is off). */
  placeBike(at: THREE.Vector3, yaw: number, snap = true) {
    if (snap) [at, yaw] = this.placement(at, yaw);
    // A reset ends the jump: whatever was mid-air doesn't score.
    this.stunts.reset();
    // Respawning out of bounds would just fire the cannon again.
    const limit = this.hm.size / 2 - OUT_OF_BOUNDS_MARGIN - 10;
    at = at.clone().clamp(new THREE.Vector3(-limit, -Infinity, -limit), new THREE.Vector3(limit, Infinity, limit));
    const p = at.clone();
    p.y = sampleHeight(this.hm, p.x, p.z) + 1.0;
    this.bike.reset(p, yaw);
    this.courseS = null;
    this.offCourseTime = 0;
  }
}
