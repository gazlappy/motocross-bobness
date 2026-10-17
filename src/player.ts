import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Bike } from './bike.ts';
import type { Controls } from './input.ts';
import { type Heightmap, sampleHeight } from './heightmap.ts';
import { Ragdoll } from './ragdoll.ts';
import { createPose, ridingPose } from './riderPose.ts';

// The player's bike and rider, including wipeouts: on a crash the rider becomes a ragdoll, the bike
// tumbles on its own, and once everything has settled the player is put back where they crashed.

const RAGDOLL_BIKE_CONTACT_DELAY = 0.5; // s before the thrown rider can hit the bike
const MIN_CRASH_TIME = 1.5;
const MAX_CRASH_TIME = 6;
const SETTLED_SPEED = 0.7;
const SETTLED_FOR = 0.6;

export class Player {
  readonly bike: Bike;
  ragdoll: Ragdoll | null = null;
  readonly pose = createPose();
  onCrash?: (cause: string) => void;
  onRespawn?: () => void;
  /** Ragdoll or bike slamming into something, 0..1. */
  onImpact?: (strength: number) => void;

  private world: RAPIER.World;
  private hm: Heightmap;
  private spawn: THREE.Vector3;
  private events = new RAPIER.EventQueue(true);
  private crashTime = 0;
  private settledTime = 0;
  private crashPos = new THREE.Vector3();
  private crashYaw = 0;
  private lastImpact = 0;
  private clock = 0;

  constructor(world: RAPIER.World, hm: Heightmap, spawn: THREE.Vector3, yaw = 0) {
    this.world = world;
    this.hm = hm;
    this.spawn = spawn.clone();
    this.bike = new Bike(world, spawn, yaw);
  }

  get crashed() {
    return this.ragdoll !== null;
  }

  /** What the camera should look at: the rider while they tumble, otherwise the bike. */
  get focus() {
    return this.ragdoll?.centre ?? null;
  }

  physicsStep(c: Controls, dt: number) {
    this.clock += dt;
    this.bike.step(c, dt);
    this.world.step(this.events);
    this.handleEvents();
    if (this.bike.crashCause && !this.crashed) this.startCrash(this.bike.crashCause);
  }

  private handleEvents() {
    const bike = this.bike;
    const riderHandles = bike.rider.colliders.map((c) => c.handle);
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started || this.crashed) return;
      if (riderHandles.includes(h1) || riderHandles.includes(h2)) bike.crash('hit the dirt');
      else if (h1 === bike.frame.handle || h2 === bike.frame.handle) {
        const r = bike.body.rotation();
        const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
        if (upY < 0.3) bike.crash('landed on its back');
      }
    });
    this.events.drainContactForceEvents((e) => {
      if (!this.ragdoll || this.clock - this.lastImpact < 0.08) return;
      if (!this.ragdoll.ownsCollider(e.collider1()) && !this.ragdoll.ownsCollider(e.collider2())) return;
      this.lastImpact = this.clock;
      this.onImpact?.(Math.min(1, e.totalForceMagnitude() / 8000));
    });
  }

  private startCrash(cause: string) {
    const bike = this.bike;
    ridingPose(bike, this.pose);

    // The ragdoll leaves with the rider body's momentum, spin included.
    const r = bike.rider.body;
    const lv = r.linvel(), av = r.angvel(), com = r.worldCom();
    const v = new THREE.Vector3(lv.x, lv.y, lv.z);
    const w = new THREE.Vector3(av.x, av.y, av.z);
    const c = new THREE.Vector3(com.x, com.y, com.z);
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

  /** Per rendered frame: crash timing, respawn, and the rider pose to draw. */
  update(dt: number) {
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
    }
    return this.ragdoll ? this.ragdoll.readPose(this.pose) : ridingPose(this.bike, this.pose);
  }

  /** Back on the bike where the crash happened, pointing the way they were going. */
  respawn() {
    this.ragdoll?.destroy();
    this.ragdoll = null;
    this.placeBike(this.crashPos, this.crashYaw);
    this.onRespawn?.();
  }

  /** The R key: pick the bike up where it is (or skip the rest of a crash). */
  reset(toSpawn = false) {
    if (this.crashed) return this.respawn();
    const t = this.bike.body.translation();
    this.placeBike(toSpawn ? this.spawn : new THREE.Vector3(t.x, t.y, t.z), toSpawn ? 0 : this.bike.yaw);
  }

  private placeBike(at: THREE.Vector3, yaw: number) {
    const p = at.clone();
    p.y = sampleHeight(this.hm, p.x, p.z) + 1.0;
    this.bike.reset(p, yaw);
  }
}
