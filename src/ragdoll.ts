import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP_BIKE, GROUP_RAGDOLL, GROUP_WORLD, groups } from './rider.ts';
import { POSE_JOINTS, type PoseJoint, type RiderPose } from './riderPose.ts';

// The crashed rider: one capsule per body segment, built from the rider's pose at the moment of the
// crash and joined at hips, knees, shoulders, elbows and neck. It reads back out as a RiderPose, so
// whichever rider model is in use animates from it.

interface SegmentDef {
  name: string;
  from: (p: RiderPose) => THREE.Vector3;
  to: (p: RiderPose) => THREE.Vector3;
  radius: number;
  mass: number;
}

const mid = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(b).multiplyScalar(0.5);
const hipC = (p: RiderPose) => mid(p.hipL, p.hipR);
const shoulderC = (p: RiderPose) => mid(p.shoulderL, p.shoulderR);

const SEGMENTS: SegmentDef[] = [
  { name: 'torso', from: hipC, to: shoulderC, radius: 0.15, mass: 34 },
  { name: 'head', from: (p) => p.head, to: (p) => p.head, radius: 0.14, mass: 5 },
  { name: 'thighL', from: (p) => p.hipL, to: (p) => p.kneeL, radius: 0.07, mass: 8 },
  { name: 'thighR', from: (p) => p.hipR, to: (p) => p.kneeR, radius: 0.07, mass: 8 },
  { name: 'shinL', from: (p) => p.kneeL, to: (p) => p.footL, radius: 0.055, mass: 4.5 },
  { name: 'shinR', from: (p) => p.kneeR, to: (p) => p.footR, radius: 0.055, mass: 4.5 },
  { name: 'upperArmL', from: (p) => p.shoulderL, to: (p) => p.elbowL, radius: 0.05, mass: 2.5 },
  { name: 'upperArmR', from: (p) => p.shoulderR, to: (p) => p.elbowR, radius: 0.05, mass: 2.5 },
  { name: 'foreArmL', from: (p) => p.elbowL, to: (p) => p.handL, radius: 0.045, mass: 1.8 },
  { name: 'foreArmR', from: (p) => p.elbowR, to: (p) => p.handR, radius: 0.045, mass: 1.8 },
];

/** Which segment carries each pose joint. */
const OWNER: Record<PoseJoint, string> = {
  hipL: 'torso', hipR: 'torso', shoulderL: 'torso', shoulderR: 'torso',
  kneeL: 'thighL', kneeR: 'thighR', footL: 'shinL', footR: 'shinR',
  elbowL: 'upperArmL', elbowR: 'upperArmR', handL: 'foreArmL', handR: 'foreArmR',
  head: 'head',
};

/** Joints: [segment A, segment B, world point taken from the pose]. */
const JOINTS: [string, string, (p: RiderPose) => THREE.Vector3][] = [
  ['torso', 'head', (p) => mid(shoulderC(p), p.head)],
  ['torso', 'thighL', (p) => p.hipL],
  ['torso', 'thighR', (p) => p.hipR],
  ['thighL', 'shinL', (p) => p.kneeL],
  ['thighR', 'shinR', (p) => p.kneeR],
  ['torso', 'upperArmL', (p) => p.shoulderL],
  ['torso', 'upperArmR', (p) => p.shoulderR],
  ['upperArmL', 'foreArmL', (p) => p.elbowL],
  ['upperArmR', 'foreArmR', (p) => p.elbowR],
];

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

interface Part {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export class Ragdoll {
  readonly parts = new Map<string, Part>();
  private locals = new Map<PoseJoint, THREE.Vector3>();
  private headOffset = new THREE.Quaternion();
  private world: RAPIER.World;

  /**
   * @param velocityAt world velocity of the rider at a point, so the ragdoll leaves with the rider's
   *   momentum (including spin).
   */
  constructor(world: RAPIER.World, pose: RiderPose, velocityAt: (p: THREE.Vector3) => THREE.Vector3) {
    this.world = world;
    for (const s of SEGMENTS) {
      const a = s.from(pose), b = s.to(pose);
      const len = a.distanceTo(b);
      const centre = mid(a, b);
      const rot = new THREE.Quaternion();
      if (len > 1e-3) rot.setFromUnitVectors(Y_AXIS, b.clone().sub(a).divideScalar(len));
      const v = velocityAt(centre);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(centre.x, centre.y, centre.z)
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
          .setLinvel(v.x, v.y, v.z)
          .setLinearDamping(0.05)
          .setAngularDamping(1.2)
          .setCcdEnabled(s.name === 'torso' || s.name === 'head'),
      );
      const shape = len > 1e-3
        ? RAPIER.ColliderDesc.capsule(Math.max(0.02, len / 2 - s.radius), s.radius)
        : RAPIER.ColliderDesc.ball(s.radius);
      const collider = world.createCollider(
        shape
          .setMass(s.mass)
          .setFriction(0.8)
          .setRestitution(0.1)
          // Bike collisions are switched on a moment later, once the rider is clear of the bike.
          .setCollisionGroups(groups(GROUP_RAGDOLL, GROUP_WORLD))
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(s.mass * 60),
        body,
      );
      this.parts.set(s.name, { body, collider });
    }

    for (const j of POSE_JOINTS) this.locals.set(j, this.toLocal(OWNER[j], pose[j]));
    const head = this.parts.get('head')!.body.rotation();
    this.headOffset.set(head.x, head.y, head.z, head.w).invert().multiply(pose.headRot);

    for (const [a, b, at] of JOINTS) {
      const p = at(pose);
      const joint = world.createImpulseJoint(
        RAPIER.JointData.spherical(this.toLocal(a, p), this.toLocal(b, p)),
        this.parts.get(a)!.body,
        this.parts.get(b)!.body,
        true,
      );
      joint.setContactsEnabled(false);
    }
  }

  private toLocal(part: string, worldPoint: THREE.Vector3) {
    const body = this.parts.get(part)!.body;
    const t = body.translation(), r = body.rotation();
    return worldPoint.clone().sub(_p.set(t.x, t.y, t.z)).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
  }

  /** Let the ragdoll collide with the bike, once it has had time to separate from it. */
  enableBikeCollisions() {
    for (const { collider } of this.parts.values()) collider.setCollisionGroups(groups(GROUP_RAGDOLL, GROUP_WORLD | GROUP_BIKE));
  }

  ownsCollider(handle: number) {
    for (const { collider } of this.parts.values()) if (collider.handle === handle) return true;
    return false;
  }

  get centre() {
    const t = this.parts.get('torso')!.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get speed() {
    const v = this.parts.get('torso')!.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  readPose(pose: RiderPose) {
    for (const j of POSE_JOINTS) {
      const body = this.parts.get(OWNER[j])!.body;
      const t = body.translation(), r = body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      pose[j].copy(this.locals.get(j)!).applyQuaternion(_q).add(_p.set(t.x, t.y, t.z));
    }
    const h = this.parts.get('head')!.body.rotation();
    pose.headRot.set(h.x, h.y, h.z, h.w).multiply(this.headOffset);
    return pose;
  }

  destroy() {
    for (const { body } of this.parts.values()) this.world.removeRigidBody(body);
    this.parts.clear();
  }
}
