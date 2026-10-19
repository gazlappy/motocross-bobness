import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BikeView } from '../bike.ts';
import type { BikeSpec } from '../bikes.ts';
import type { Player } from '../player.ts';
import { GROUP_BIKE, GROUP_RAGDOLL, groups } from '../rider.ts';
import { POSE_JOINTS, type RiderPose, createPose } from '../riderPose.ts';

// A rider simulated on someone else's machine. Their snapshots arrive ~20 times a second; we draw
// them a fixed delay behind, interpolating between the two snapshots either side of that moment so
// they move smoothly whatever the network does. A kinematic body follows along so you can bump them.

/** Snapshot layout: time, bike pose, velocity, controls, wheels, crashed, stunt score, rider pose. */
const T = 0, P = 1, Q = 4, V = 8, STEER = 11, RPM = 12, THROTTLE = 13, WHEELS = 14, CRASHED = 18, SCORE = 19, JOINTS = 20;
const HEAD_ROT = JOINTS + POSE_JOINTS.length * 3;
export const SNAPSHOT_LENGTH = HEAD_ROT + 4;

/** How far behind the newest snapshot to draw, seconds: enough to ride out jitter. */
const DELAY = 0.11;
const MAX_EXTRAPOLATE = 0.25;
/** Snapshots arriving later than this after the newest are assumed to come from a restart. */
const STALE = 2;

/** Below this (m/s) a network rider's bike is a ghost. */
const SOLID_SPEED = 3;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Pack a local rider's state for the wire. */
export function snapshot(p: Player, pose: RiderPose, now: number): number[] {
  const b = p.bike;
  const t = b.body.translation(), q = b.body.rotation(), v = b.body.linvel();
  const [f, r] = b.wheels;
  const s = [
    Math.round(now), t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z,
    b.steerAngle, Math.round(b.rpm), b.throttle, f.rayLength, f.spin % (Math.PI * 2), r.rayLength, r.spin % (Math.PI * 2),
    p.crashed ? 1 : 0, p.stunts.total,
  ];
  for (const j of POSE_JOINTS) s.push(pose[j].x, pose[j].y, pose[j].z);
  s.push(pose.headRot.x, pose.headRot.y, pose.headRot.z, pose.headRot.w);
  return s.map(r3);
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

function lerpAngle(a: number, b: number, k: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/** A rider's state between two snapshots (network play and replays both draw from these). */
export interface SnapshotState {
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  vel: THREE.Vector3;
  wheels: { rayLength: number; spin: number }[];
  pose: RiderPose;
  steer: number;
  rpm: number;
  throttle: number;
  crashed: boolean;
  score: number;
}

/** Blend snapshots `a` and `b` (k = 0..1 between them) into `out`. */
export function readSnapshot(a: ArrayLike<number>, b: ArrayLike<number>, k: number, out: SnapshotState) {
  const lerp = (i: number) => a[i] + (b[i] - a[i]) * k;
  out.pos.set(lerp(P), lerp(P + 1), lerp(P + 2));
  _qa.set(a[Q], a[Q + 1], a[Q + 2], a[Q + 3]);
  _qb.set(b[Q], b[Q + 1], b[Q + 2], b[Q + 3]);
  out.rot.copy(_qa).slerp(_qb, k);
  out.vel.set(lerp(V), lerp(V + 1), lerp(V + 2));
  out.steer = lerp(STEER);
  out.rpm = lerp(RPM);
  out.throttle = lerp(THROTTLE);
  const [f, r] = out.wheels;
  f.rayLength = lerp(WHEELS);
  f.spin = lerpAngle(a[WHEELS + 1], b[WHEELS + 1], k);
  r.rayLength = lerp(WHEELS + 2);
  r.spin = lerpAngle(a[WHEELS + 3], b[WHEELS + 3], k);
  out.crashed = b[CRASHED] === 1;
  out.score = b[SCORE];
  POSE_JOINTS.forEach((j, n) => {
    const i = JOINTS + n * 3;
    out.pose[j].set(lerp(i), lerp(i + 1), lerp(i + 2));
  });
  _qa.set(a[HEAD_ROT], a[HEAD_ROT + 1], a[HEAD_ROT + 2], a[HEAD_ROT + 3]);
  _qb.set(b[HEAD_ROT], b[HEAD_ROT + 1], b[HEAD_ROT + 2], b[HEAD_ROT + 3]);
  out.pose.headRot.copy(_qa).slerp(_qb, k);
}

/** Pack a network rider's current (drawn) state the same way, for replays. */
export function snapshotOfRemote(r: RemoteRider, now: number): number[] {
  const b = r.bike, t = b.body.translation(), q = b.body.rotation(), v = b.body.linvel();
  const [f, w] = b.wheels;
  const s = [now, t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, b.steerAngle, r.rpm, r.throttle,
    f.rayLength, f.spin, w.rayLength, w.spin, r.crashed ? 1 : 0, r.stunts.total];
  for (const j of POSE_JOINTS) s.push(r.pose[j].x, r.pose[j].y, r.pose[j].z);
  s.push(r.pose.headRot.x, r.pose.headRot.y, r.pose.headRot.z, r.pose.headRot.w);
  return s;
}

export class RemoteRider {
  readonly id: string;
  readonly spec: BikeSpec;
  readonly pose = createPose();
  private buffer: number[][] = [];
  /** Smallest (arrival - sent) seen lately: network delay plus the clock difference. */
  private offset = Infinity;
  private offsetAge = 0;
  private world: RAPIER.World;
  private kinematic: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private pos = new THREE.Vector3();
  private rot = new THREE.Quaternion();
  private vel = new THREE.Vector3();
  private wheels = [-0.82, 0.66].map((z) => ({ attach: new THREE.Vector3(0, 0.12, z), rayLength: 0.6, spin: 0 }));
  private state: SnapshotState;
  crashed = false;
  rpm = 0;
  throttle = 0;
  /** When their last snapshot arrived (local ms); 0 until the first. */
  lastHeard = 0;

  /** Looks enough like a Player for events (position, stunt score) and models (BikeView). */
  readonly bike: BikeView & { speed: number; throttle: number; body: BikeView['body'] & { linvel(): { x: number; y: number; z: number } } };
  readonly stunts = { total: 0 };

  constructor(world: RAPIER.World, id: string, spec: BikeSpec, spawn: THREE.Vector3, yaw: number) {
    this.world = world;
    this.id = id;
    this.spec = spec;
    this.pos.copy(spawn);
    this.rot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.kinematic = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z).setRotation(this.rot),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.18, 0.4, 0.75).setTranslation(0, 0.3, 0).setFriction(0.5).setRestitution(0.2)
        .setCollisionGroups(groups(GROUP_BIKE, GROUP_BIKE | GROUP_RAGDOLL)),
      this.kinematic,
    );
    const pos = this.pos, rot = this.rot, vel = this.vel;
    this.state = { pos, rot, vel, wheels: this.wheels, pose: this.pose, steer: 0, rpm: 0, throttle: 0, crashed: false, score: 0 };
    this.bike = {
      body: { translation: () => pos, rotation: () => rot, linvel: () => vel },
      wheels: this.wheels,
      steerAngle: 0,
      speed: 0,
      throttle: 0,
    };
  }

  receive(s: number[], now: number) {
    if (s.length !== SNAPSHOT_LENGTH) return;
    const newest = this.buffer.at(-1);
    if (newest && s[T] <= newest[T]) {
      if (newest[T] - s[T] < STALE * 1000) return; // out of order: drop it
      this.buffer.length = 0; // their clock restarted (page reload)
      this.offset = Infinity;
    }
    this.buffer.push(s);
    if (this.buffer.length > 30) this.buffer.shift();
    const off = now - s[T];
    // Track the quickest delivery, letting it drift up slowly in case the clocks wander.
    this.offsetAge++;
    if (off < this.offset || this.offsetAge > 200) {
      this.offset = Math.min(off, this.offset + 5);
      this.offsetAge = 0;
    }
    this.lastHeard = now;
  }

  /** Bring the proxy up to time `now` (local ms). Called every frame and physics step. */
  update(now: number) {
    const buf = this.buffer;
    if (!buf.length) return;
    const t = now - this.offset - DELAY * 1000;
    let a = buf[0], b = buf[0], k = 0;
    if (t >= buf.at(-1)![T]) {
      a = b = buf.at(-1)!;
    } else if (t > buf[0][T]) {
      let i = buf.findIndex((s) => s[T] > t);
      a = buf[i - 1];
      b = buf[i];
      k = (t - a[T]) / Math.max(1, b[T] - a[T]);
    }
    const st = this.state;
    readSnapshot(a, b, k, st);
    // Past the newest snapshot: carry on along their velocity for a moment.
    const ahead = a === b ? Math.min(MAX_EXTRAPOLATE, (t - a[T]) / 1000) : 0;
    if (ahead > 0) {
      this.pos.addScaledVector(this.vel, ahead);
      for (const j of POSE_JOINTS) this.pose[j].addScaledVector(this.vel, ahead);
    }
    this.bike.steerAngle = st.steer;
    this.rpm = st.rpm;
    this.throttle = st.throttle;
    this.bike.throttle = st.throttle;
    this.crashed = st.crashed;
    this.stunts.total = st.score;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rot);
    this.bike.speed = this.vel.dot(fwd);

    // Only a moving bike is solid. This proxy can't be pushed, so a stopped or crashed one would be a
    // wall you get stuck on (and on their screen, your proxy would bulldoze them).
    const solid = !this.crashed && Math.abs(this.bike.speed) > SOLID_SPEED;
    if (this.collider.isEnabled() !== solid) this.collider.setEnabled(solid);
    this.kinematic.setNextKinematicTranslation(this.pos);
    this.kinematic.setNextKinematicRotation(this.rot);
  }

  dispose() {
    this.world.removeRigidBody(this.kinematic);
  }
}
