import * as THREE from 'three';
import type { Bike } from './bike.ts';
import { RIDER_POINTS } from './rider.ts';

/**
 * The rider's skeleton as world-space joint positions plus head orientation. Riding, the pose comes
 * from the rider body + IK to the bars and pegs; crashed, it comes from the ragdoll. Any rider
 * model (the placeholder now, a rigged glTF later) just draws whatever pose it's given.
 */
export interface RiderPose {
  hipL: THREE.Vector3; hipR: THREE.Vector3;
  kneeL: THREE.Vector3; kneeR: THREE.Vector3;
  footL: THREE.Vector3; footR: THREE.Vector3;
  shoulderL: THREE.Vector3; shoulderR: THREE.Vector3;
  elbowL: THREE.Vector3; elbowR: THREE.Vector3;
  handL: THREE.Vector3; handR: THREE.Vector3;
  head: THREE.Vector3;
  headRot: THREE.Quaternion;
}

export const POSE_JOINTS = [
  'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR',
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR', 'head',
] as const;
export type PoseJoint = (typeof POSE_JOINTS)[number];

export function createPose(): RiderPose {
  const pose = { headRot: new THREE.Quaternion() } as RiderPose;
  for (const j of POSE_JOINTS) pose[j] = new THREE.Vector3();
  return pose;
}

const HALF_HIPS = 0.11;
const HALF_SHOULDERS = 0.19;
const THIGH = 0.46;
const UPPER_ARM = 0.32;
const KNEE_HINT_L = new THREE.Vector3(-0.3, 0, -1);
const KNEE_HINT_R = new THREE.Vector3(0.3, 0, -1);
const ELBOW_HINT_L = new THREE.Vector3(-1, 0.2, 0.4);
const ELBOW_HINT_R = new THREE.Vector3(1, 0.2, 0.4);

const _rPos = new THREE.Vector3();
const _rRot = new THREE.Quaternion();
const _bPos = new THREE.Vector3();
const _bRot = new THREE.Quaternion();
const _ab = new THREE.Vector3();
const _side = new THREE.Vector3();

/** Two-bone joint position: equal-length bones from `a` to `b`, bending towards `hint`. */
function bend(a: THREE.Vector3, b: THREE.Vector3, bone: number, hint: THREE.Vector3, out: THREE.Vector3) {
  _ab.subVectors(b, a);
  const half = _ab.length() / 2;
  _side.copy(hint).addScaledVector(_ab, -hint.dot(_ab) / Math.max(1e-6, _ab.lengthSq())).normalize();
  return out.addVectors(a, b).multiplyScalar(0.5).addScaledVector(_side, Math.sqrt(Math.max(0, bone * bone - half * half)));
}

/** Pose of a rider on the bike: torso from the rider body, hands on the bars, feet on the pegs. */
export function ridingPose(bike: Bike, pose: RiderPose) {
  bike.rider.localPose(bike.body, _rPos, _rRot);
  const at = (p: THREE.Vector3, x: number, out: THREE.Vector3) =>
    out.copy(p).setX(p.x + x).applyQuaternion(_rRot).add(_rPos);

  // Everything is built in bike space, then moved to world space at the end.
  at(RIDER_POINTS.hip, -HALF_HIPS, pose.hipL);
  at(RIDER_POINTS.hip, HALF_HIPS, pose.hipR);
  at(RIDER_POINTS.shoulder, -HALF_SHOULDERS, pose.shoulderL);
  at(RIDER_POINTS.shoulder, HALF_SHOULDERS, pose.shoulderR);
  at(RIDER_POINTS.head, 0, pose.head);

  const steer = bike.steerAngle;
  pose.handL.set(-0.36, 0.84, -0.48 + steer * 0.3);
  pose.handR.set(0.36, 0.84, -0.48 - steer * 0.3);
  pose.footL.set(-0.2, 0.2, 0);
  pose.footR.set(0.2, 0.2, 0);
  bend(pose.hipL, pose.footL, THIGH, KNEE_HINT_L, pose.kneeL);
  bend(pose.hipR, pose.footR, THIGH, KNEE_HINT_R, pose.kneeR);
  bend(pose.shoulderL, pose.handL, UPPER_ARM, ELBOW_HINT_L, pose.elbowL);
  bend(pose.shoulderR, pose.handR, UPPER_ARM, ELBOW_HINT_R, pose.elbowR);

  const t = bike.body.translation(), q = bike.body.rotation();
  _bPos.set(t.x, t.y, t.z);
  _bRot.set(q.x, q.y, q.z, q.w);
  for (const j of POSE_JOINTS) pose[j].applyQuaternion(_bRot).add(_bPos);
  pose.headRot.copy(_bRot).multiply(_rRot);
  return pose;
}
