import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// The rider is a separate rigid body held to the bike by springs, as in the original game.
// Weight shift moves the springs' target, so leaning really moves mass around on the bike.

export const RIDER_MASS = 75;
const RIDER_INERTIA = { x: 9, y: 4, z: 8 };

/** Neutral rider centre of mass in bike space (standing on the pegs). */
const NEUTRAL = new THREE.Vector3(0, 0.62, 0.0);
const LEAN_FORWARD = 0.3; // metres the hips travel fore/aft at full lean
const LEAN_SIDE = 0.22;
const LEAN_PITCH = 0.35; // radians the torso tips forward
const LEAN_ROLL = 0.3;
const MAX_STRETCH = 0.5;
/** Height in bike space where the rider's weight goes into the bike (the footpegs). */
const FOOT_Y = 0.25;

// The rider is held by a spring at the feet plus an angular spring for the torso, as a real rider
// stands on the pegs. Gains are in bike space; vertical is softer: the legs soaking up landings.
const LIN_K = new THREE.Vector3(60000, 25000, 60000);
const LIN_C = new THREE.Vector3(2600, 1300, 2600);
const ANG_K = 6000;
const ANG_C = 300;

export const GROUP_WORLD = 0x0001;
export const GROUP_BIKE = 0x0002;
export const GROUP_RIDER = 0x0004;
export const GROUP_PROBE = 0x0008;
export const GROUP_RAGDOLL = 0x0010;
export const groups = (membership: number, filter: number) => (membership << 16) | filter;

/** Points on the rider in rider space, used for posing the visual model. */
export const RIDER_POINTS = {
  hip: new THREE.Vector3(0, 0.1, 0.08),
  shoulder: new THREE.Vector3(0, 0.55, -0.24),
  head: new THREE.Vector3(0, 0.74, -0.28),
};

const _bq = new THREE.Quaternion();
const _bqInv = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _tq = new THREE.Quaternion();
const _bp = new THREE.Vector3();
const _bcom = new THREE.Vector3();
const _bv = new THREE.Vector3();
const _bw = new THREE.Vector3();
const _rp = new THREE.Vector3();
const _rv = new THREE.Vector3();
const _rw = new THREE.Vector3();
const _target = new THREE.Vector3();
const _targetV = new THREE.Vector3();
const _err = new THREE.Vector3();
const _errV = new THREE.Vector3();
const _f = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _pr = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vr = new THREE.Vector3();
const _tau = new THREE.Vector3();
const _euler = new THREE.Euler();

const toR = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

export class Rider {
  readonly body: RAPIER.RigidBody;
  /** Target pose in bike space, after weight shift. */
  readonly targetPos = NEUTRAL.clone();
  readonly targetRot = new THREE.Quaternion();
  /** How far the feet have been pulled off the pegs; past MAX_STRETCH the rider is thrown off. */
  stretch = 0;
  readonly colliders: RAPIER.Collider[] = [];

  constructor(world: RAPIER.World, bike: RAPIER.RigidBody) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(RIDER_MASS, { x: 0, y: 0, z: 0 }, RIDER_INERTIA, { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(0.02)
        .setAngularDamping(0.5)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    // Any contact on the torso or helmet means the rider has hit the ground: a crash.
    const g = groups(GROUP_RIDER, GROUP_WORLD);
    for (const desc of [
      RAPIER.ColliderDesc.capsule(0.22, 0.17).setTranslation(0, 0.32, -0.06),
      RAPIER.ColliderDesc.ball(0.15).setTranslation(0, 0.74, -0.28),
    ]) {
      desc.setDensity(0).setCollisionGroups(g).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.colliders.push(world.createCollider(desc, this.body));
    }
    this.snapTo(bike);
  }

  /** Take the rider out of the simulation (while the ragdoll stands in) or put them back. */
  setActive(active: boolean) {
    this.body.setEnabled(active);
  }

  /** Place the rider exactly on the target pose, moving with the bike. */
  snapTo(bike: RAPIER.RigidBody) {
    this.readBike(bike);
    _target.copy(this.targetPos).applyQuaternion(_bq).add(_bp);
    _tq.copy(_bq).multiply(this.targetRot);
    this.body.setTranslation(toR(_target), true);
    this.body.setRotation({ x: _tq.x, y: _tq.y, z: _tq.z, w: _tq.w }, true);
    _targetV.subVectors(_target, _bcom).cross(_bw).negate().add(_bv);
    this.body.setLinvel(toR(_targetV), true);
    this.body.setAngvel(toR(_bw), true);
  }

  /** Apply the spring forces between rider and bike. `lean`: x = side (+right), y = forward (+fwd). */
  couple(bike: RAPIER.RigidBody, lean: THREE.Vector2, dt: number) {
    this.targetPos.set(
      NEUTRAL.x + lean.x * LEAN_SIDE,
      NEUTRAL.y - Math.abs(lean.y) * 0.06 - Math.abs(lean.x) * 0.05,
      NEUTRAL.z - lean.y * LEAN_FORWARD,
    );
    this.targetRot.setFromEuler(_euler.set(-lean.y * LEAN_PITCH, 0, -lean.x * LEAN_ROLL));

    this.readBike(bike);
    const r = this.body;
    const t = r.translation(), q = r.rotation(), v = r.linvel(), w = r.angvel();
    _rp.set(t.x, t.y, t.z);
    _rq.set(q.x, q.y, q.z, q.w);
    _rv.set(v.x, v.y, v.z);
    _rw.set(w.x, w.y, w.z);

    // Foot spring: the bike's peg point and the matching point on the rider are pulled together.
    _pb.set(this.targetPos.x, FOOT_Y, this.targetPos.z);
    _pr.set(0, FOOT_Y - this.targetPos.y, 0).applyQuaternion(_tq.copy(this.targetRot).invert());
    _pb.applyQuaternion(_bq).add(_bp);
    _pr.applyQuaternion(_rq).add(_rp);
    _vb.subVectors(_pb, _bcom);
    _vb.crossVectors(_bw, _vb).add(_bv);
    _vr.subVectors(_pr, _rp);
    _vr.crossVectors(_rw, _vr).add(_rv);
    _err.subVectors(_pb, _pr).applyQuaternion(_bqInv);
    this.stretch = _err.length();
    if (this.stretch > MAX_STRETCH) _err.setLength(MAX_STRETCH);
    _errV.subVectors(_vb, _vr).applyQuaternion(_bqInv);
    _f.set(
      LIN_K.x * _err.x + LIN_C.x * _errV.x,
      LIN_K.y * _err.y + LIN_C.y * _errV.y,
      LIN_K.z * _err.z + LIN_C.z * _errV.z,
    ).applyQuaternion(_bq).multiplyScalar(dt);
    // Same point on both bodies, so the pair adds no net spin to the bike + rider system.
    _mid.addVectors(_pb, _pr).multiplyScalar(0.5);
    r.applyImpulseAtPoint(toR(_f), toR(_mid), true);
    bike.applyImpulseAtPoint(toR(_f.negate()), toR(_mid), true);

    // Angular spring towards the target orientation.
    _tq.copy(_bq).multiply(this.targetRot).multiply(_rq.invert());
    if (_tq.w < 0) _tq.set(-_tq.x, -_tq.y, -_tq.z, -_tq.w);
    const angle = 2 * Math.acos(Math.min(1, _tq.w));
    const s = Math.sqrt(Math.max(0, 1 - _tq.w * _tq.w));
    _tau.set(0, 0, 0);
    if (s > 1e-6) _tau.set(_tq.x / s, _tq.y / s, _tq.z / s).multiplyScalar(ANG_K * angle);
    _tau.addScaledVector(_errV.subVectors(_bw, _rw), ANG_C).multiplyScalar(dt);
    r.applyTorqueImpulse(toR(_tau), true);
    bike.applyTorqueImpulse(toR(_tau.negate()), true);
  }

  /** Rider position and rotation relative to the bike body, for posing the visual model. */
  localPose(bike: RAPIER.RigidBody, outPos: THREE.Vector3, outRot: THREE.Quaternion) {
    this.readBike(bike);
    const t = this.body.translation(), q = this.body.rotation();
    outPos.set(t.x, t.y, t.z).sub(_bp).applyQuaternion(_bqInv);
    outRot.copy(_bqInv).multiply(_rq.set(q.x, q.y, q.z, q.w));
  }

  private readBike(bike: RAPIER.RigidBody) {
    const t = bike.translation(), q = bike.rotation(), c = bike.worldCom(), v = bike.linvel(), w = bike.angvel();
    _bp.set(t.x, t.y, t.z);
    _bq.set(q.x, q.y, q.z, q.w);
    _bqInv.copy(_bq).invert();
    _bcom.set(c.x, c.y, c.z);
    _bv.set(v.x, v.y, v.z);
    _bw.set(w.x, w.y, w.z);
  }
}
