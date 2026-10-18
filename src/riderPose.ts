import * as THREE from 'three';
import type { Bike } from './bike.ts';
import { RIDER_POINTS } from './rider.ts';
import { type StuntState, TAUNT_HAND } from './stunts.ts';

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

/** Body measurements (metres) the pose is built with; a rider model supplies its own. */
export interface RiderProportions {
  thigh: number;
  shin: number;
  upperArm: number;
  foreArm: number;
  halfHips: number;
  halfShoulders: number;
  /** Hip centre to shoulder centre. */
  torso: number;
  /** Shoulder centre to the head joint. */
  neck: number;
}

/** Where the rider holds and stands on the bike, in bike space. */
export interface BikeMounts {
  gripL: THREE.Vector3;
  gripR: THREE.Vector3;
  pegL: THREE.Vector3;
  pegR: THREE.Vector3;
}

/** Grips and pegs of the placeholder box bike; grips swing with steering. */
export function placeholderMounts(steer: number, out: BikeMounts) {
  out.gripL.set(-0.36, 0.84, -0.48 + steer * 0.3);
  out.gripR.set(0.36, 0.84, -0.48 - steer * 0.3);
  out.pegL.set(-0.2, 0.2, 0);
  out.pegR.set(0.2, 0.2, 0);
  return out;
}

export function createMounts(): BikeMounts {
  return { gripL: new THREE.Vector3(), gripR: new THREE.Vector3(), pegL: new THREE.Vector3(), pegR: new THREE.Vector3() };
}

/** Proportions of the placeholder box rider. */
export const DEFAULT_PROPORTIONS: RiderProportions = {
  thigh: 0.46, shin: 0.46, upperArm: 0.32, foreArm: 0.32,
  halfHips: 0.11, halfShoulders: 0.19, torso: 0.55, neck: 0.2,
};
/** Ankle joint relative to the footpeg, bike space. */
const ANKLE_ABOVE_PEG = new THREE.Vector3(0, 0.13, 0.04);
/** Hip-to-ankle distance as a fraction of leg length: lower is a deeper crouch. */
const STANCE = 0.84;
const MAX_CROUCH = 0.12; // m
const KNEE_HINT_L = new THREE.Vector3(-0.3, 0, -1);
const KNEE_HINT_R = new THREE.Vector3(0.3, 0, -1);
const ELBOW_HINT_L = new THREE.Vector3(-1, 0.2, 0.4);
const ELBOW_HINT_R = new THREE.Vector3(1, 0.2, 0.4);

const _rPos = new THREE.Vector3();
const _rRot = new THREE.Quaternion();
const _bPos = new THREE.Vector3();
const _bRot = new THREE.Quaternion();
const _ab = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _head = new THREE.Vector3();

function clampReach(from: THREE.Vector3, to: THREE.Vector3, reach: number) {
  const d = from.distanceTo(to);
  if (d > reach) to.sub(from).multiplyScalar(reach / d).add(from);
}
const _side = new THREE.Vector3();
const _mounts = createMounts();
const _hintL = new THREE.Vector3();
const _hintR = new THREE.Vector3();
const _hipC = new THREE.Vector3();
const _shC = new THREE.Vector3();
const _across = new THREE.Vector3();
const _spine = new THREE.Vector3();

/** Blend the bike-space riding pose towards a stunt's pose, keeping the rider's proportions. */
function applyStunt(pose: RiderPose, body: RiderProportions, { def, weight: w }: StuntState) {
  if (!def) return;
  _across.subVectors(pose.hipR, pose.hipL).normalize();
  _hipC.addVectors(pose.hipL, pose.hipR).multiplyScalar(0.5).lerp(def.hip, w);
  _shC.addVectors(pose.shoulderL, pose.shoulderR).multiplyScalar(0.5).lerp(def.shoulder, w);
  _spine.subVectors(_shC, _hipC).normalize();
  _shC.copy(_hipC).addScaledVector(_spine, body.torso);
  pose.hipL.copy(_hipC).addScaledVector(_across, -body.halfHips);
  pose.hipR.copy(_hipC).addScaledVector(_across, body.halfHips);
  pose.shoulderL.copy(_shC).addScaledVector(_across, -body.halfShoulders);
  pose.shoulderR.copy(_shC).addScaledVector(_across, body.halfShoulders);
  pose.head.copy(_shC).addScaledVector(_spine, body.neck);
  pose.footL.lerp(def.footL, w);
  pose.footR.lerp(def.footR, w);
  if (def.handL) pose.handL.lerp(def.handL, w);
  if (def.handR) pose.handR.lerp(def.handR, w);
}

/** Two-bone joint position: bones of length `l1` (from `a`) and `l2` (to `b`), bending towards `hint`. */
function bend(a: THREE.Vector3, b: THREE.Vector3, l1: number, l2: number, hint: THREE.Vector3, out: THREE.Vector3) {
  _ab.subVectors(b, a);
  const d = Math.min(_ab.length(), l1 + l2 - 1e-4);
  const along = (d * d + l1 * l1 - l2 * l2) / (2 * d); // law of cosines: distance from a along a->b
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _ab.normalize();
  _side.copy(hint).addScaledVector(_ab, -hint.dot(_ab)).normalize();
  return out.copy(a).addScaledVector(_ab, along).addScaledVector(_side, h);
}

/** Pose of a rider on the bike: torso from the rider body, hands on the bars, feet on the pegs. */
export function ridingPose(
  bike: Bike,
  pose: RiderPose,
  body: RiderProportions = DEFAULT_PROPORTIONS,
  mounts: BikeMounts = placeholderMounts(bike.steerAngle, _mounts),
  stunt: StuntState | null = null,
) {
  bike.rider.localPose(bike.body, _rPos, _rRot);
  const at = (p: THREE.Vector3, x: number, out: THREE.Vector3) =>
    out.copy(p).setX(p.x + x).applyQuaternion(_rRot).add(_rPos);

  // Torso points follow the rider body's lean, spaced by this rider's own measurements.
  _shoulder.subVectors(RIDER_POINTS.shoulder, RIDER_POINTS.hip).setLength(body.torso).add(RIDER_POINTS.hip);
  _head.subVectors(RIDER_POINTS.head, RIDER_POINTS.shoulder).setLength(body.neck).add(_shoulder);

  // Everything is built in bike space, then moved to world space at the end.
  at(RIDER_POINTS.hip, -body.halfHips, pose.hipL);
  at(RIDER_POINTS.hip, body.halfHips, pose.hipR);
  at(_shoulder, -body.halfShoulders, pose.shoulderL);
  at(_shoulder, body.halfShoulders, pose.shoulderR);
  at(_head, 0, pose.head);

  pose.handL.copy(mounts.gripL);
  pose.handR.copy(mounts.gripR);
  // The foot joint is the ankle: it sits above the peg, with the boot sole on it.
  pose.footL.copy(mounts.pegL).add(ANKLE_ABOVE_PEG);
  pose.footR.copy(mounts.pegR).add(ANKLE_ABOVE_PEG);

  // Attack stance: sink the upper body until the knees bend, whatever this rider's leg length.
  const hipToPeg = (pose.hipL.distanceTo(pose.footL) + pose.hipR.distanceTo(pose.footR)) / 2;
  // Capped, so leaning back straightens the legs instead of sinking the hips into the seat.
  const drop = Math.min(MAX_CROUCH, hipToPeg - STANCE * (body.thigh + body.shin));
  if (drop > 0) {
    for (const j of ['hipL', 'hipR', 'shoulderL', 'shoulderR', 'head'] as const) pose[j].y -= drop;
  }
  let kneeHintL = KNEE_HINT_L, kneeHintR = KNEE_HINT_R;
  if (stunt?.def && stunt.weight > 0) {
    applyStunt(pose, body, stunt);
    if (stunt.def.kneeHint) {
      kneeHintL = _hintL.copy(KNEE_HINT_L).lerp(stunt.def.kneeHint, stunt.weight);
      kneeHintR = _hintR.copy(KNEE_HINT_R).lerp(stunt.def.kneeHint, stunt.weight);
    }
  }
  // Taunt: point as you pass, with the right hand off the bar.
  if (stunt && stunt.taunt > 0) pose.handR.lerp(TAUNT_HAND, stunt.taunt);
  bend(pose.hipL, pose.footL, body.thigh, body.shin, kneeHintL, pose.kneeL);
  bend(pose.hipR, pose.footR, body.thigh, body.shin, kneeHintR, pose.kneeR);
  bend(pose.shoulderL, pose.handL, body.upperArm, body.foreArm, ELBOW_HINT_L, pose.elbowL);
  bend(pose.shoulderR, pose.handR, body.upperArm, body.foreArm, ELBOW_HINT_R, pose.elbowR);
  // Out of reach, the hand/foot stops at the end of the straightened limb.
  clampReach(pose.shoulderL, pose.handL, body.upperArm + body.foreArm);
  clampReach(pose.shoulderR, pose.handR, body.upperArm + body.foreArm);
  clampReach(pose.hipL, pose.footL, body.thigh + body.shin);
  clampReach(pose.hipR, pose.footR, body.thigh + body.shin);

  const t = bike.body.translation(), q = bike.body.rotation();
  _bPos.set(t.x, t.y, t.z);
  _bRot.set(q.x, q.y, q.z, q.w);
  for (const j of POSE_JOINTS) pose[j].applyQuaternion(_bRot).add(_bPos);
  pose.headRot.copy(_bRot).multiply(_rRot);
  return pose;
}
