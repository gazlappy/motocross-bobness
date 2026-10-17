import * as THREE from 'three';
import { BIKES, type BikeSpec } from './bikes.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Controls } from './input.ts';
import { GROUP_BIKE, GROUP_PROBE, GROUP_RAGDOLL, GROUP_WORLD, Rider, groups } from './rider.ts';

// Bike-local axes: forward = -Z, right = +X, up = +Y.

const BIKE_MASS = 105;
const BIKE_COM = { x: 0, y: -0.12, z: 0 };
const BIKE_INERTIA = { x: 20, y: 16, z: 8 };
/** Bike + rider inertia, used to scale the balance and air-control torques. */
const INERTIA = new THREE.Vector3(45, 35, 28); // pitch (X), yaw (Y), roll (Z)
const GRAVITY = 9.81;

const WHEEL_RADIUS = 0.34;
const SUSP_TRAVEL = 0.42;
const SUSP_K = 6200;
const SUSP_BUMP_START = 0.36;
const SUSP_BUMP_K = 90000;
const SUSP_DAMP_COMP = 900;
const SUSP_DAMP_REBOUND = 1800;
const TYRE_MU = 1.15;
const PROBE_RADIUS = 0.06;
const WHEELBASE = 1.48;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const PROBE_GROUPS = groups(GROUP_PROBE, GROUP_WORLD);
// Wheels probe straight down: probing along the bike's own axis would lose the ground as soon
// as the bike leans hard into a turn.
const DOWN = { x: 0, y: -1, z: 0 };
const TYRE_CROWN = 0.07; // m, radius of the tyre's cross-section
const _side = new THREE.Vector3();

const GEARS = [2.9, 2.1, 1.62, 1.3, 1.08];

const FRONT_BRAKE = 1700;
const REAR_BRAKE = 850;
const DRAG_CDA = 0.55;
const LEAN_KP = 140;
const LEAN_KD = 35;
const LEAN_RATE = 2.5; // rad/s

// Crash thresholds.
const CRASH_IMPACT = 16; // m/s into the ground: a flat landing from ~13 m (the original was forgiving)
const CRASH_NOSE_DOWN = 0.8; // rad, front wheel landing that steep goes over the bars
const CRASH_LOOPED = 1.15; // rad, landing on the rear wheel that far past vertical-ish
const CRASH_LANDING_ROLL = 1.05; // rad, landing leaned over this far
const CRASH_STRETCH = 0.42; // m, rider ripped off the pegs
const LANDING_MIN_AIR = 0.3; // s: shorter hops over bumps aren't judged as landings
const MAX_LEAN = Math.atan(0.95 * TYRE_MU); // steepest lean the tyres can hold

function torqueAt(spec: BikeSpec, rpm: number) {
  const curve = spec.torqueCurve;
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return spec.peakTorque * THREE.MathUtils.lerp(t0, t1, (rpm - r0) / (r1 - r0));
    }
  }
  return 0;
}

export interface WheelState {
  attach: THREE.Vector3; // local
  steered: boolean;
  grounded: boolean;
  compression: number;
  rayLength: number; // current distance from attach point to wheel bottom
  spin: number; // visual rotation angle
  surfaceNormal: THREE.Vector3;
  slip: number; // 0..1, how close the tyre is to its grip limit
}

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _wf = new THREE.Vector3();
const _com = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _linv = new THREE.Vector3();
const _angv = new THREE.Vector3();
const _imp = new THREE.Vector3();

const _rn = new THREE.Vector3();
const _qInv = new THREE.Quaternion();

const toR = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
const IDLE_CONTROLS: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };

/**
 * Mass the bike body presents to an impulse along `dir` at `point`, counting the rotation it
 * causes. Impulses sized from this can't overshoot, however small the bike's inertia is.
 */
function effectiveMass(point: THREE.Vector3, dir: THREE.Vector3) {
  _rn.subVectors(point, _com).cross(dir).applyQuaternion(_qInv);
  const invI = (_rn.x * _rn.x) / BIKE_INERTIA.x + (_rn.y * _rn.y) / BIKE_INERTIA.y + (_rn.z * _rn.z) / BIKE_INERTIA.z;
  return 1 / (1 / BIKE_MASS + invI);
}

export class Bike {
  readonly body: RAPIER.RigidBody;
  readonly rider: Rider;
  readonly wheels: WheelState[];
  readonly spec: BikeSpec;
  rpm: number;
  gear = 0;
  autoShift = true;
  steerAngle = 0;
  speed = 0; // forward m/s
  grounded = false;
  airTime = 0;
  throttle = 0;
  /** Hardest wheel touchdown (m/s) since the sound system last read it. */
  landingImpact = 0;
  /** Set when the riding goes wrong; the player turns it into a wipeout. */
  crashCause: string | null = null;
  /** While crashed the rider is a ragdoll and the bike is left to tumble. */
  crashed = false;
  readonly frame: RAPIER.Collider;
  /** Set by the out-of-bounds cannon: the next landing's impact is forgiven. */
  cannonLanding = false;
  lean = new THREE.Vector2(); // rider weight shift: x = side, y = forward
  private shiftCooldown = 0;
  private leanTarget = 0;
  private requestedSteer = 0;
  private upsideDownTime = 0;
  private probe = new RAPIER.Ball(PROBE_RADIUS);
  private world: RAPIER.World;

  constructor(world: RAPIER.World, position: THREE.Vector3, yaw = 0, spec: BikeSpec = BIKES['250']) {
    this.world = world;
    this.spec = spec;
    this.rpm = spec.idle;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      .setAdditionalMassProperties(BIKE_MASS, BIKE_COM, BIKE_INERTIA, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0.02)
      .setAngularDamping(0.25)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = world.createRigidBody(desc);

    // The frame only touches the ground when something has gone wrong.
    this.frame = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.16, 0.24, 0.6)
        .setTranslation(0, 0.18, 0)
        .setDensity(0)
        .setFriction(0.6)
        .setRestitution(0.2)
        .setCollisionGroups(groups(GROUP_BIKE, GROUP_WORLD | GROUP_RAGDOLL | GROUP_BIKE))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.rider = new Rider(world, this.body);

    const wheel = (z: number, steered: boolean): WheelState => ({
      attach: new THREE.Vector3(0, 0.12, z),
      steered,
      grounded: false,
      compression: 0,
      rayLength: SUSP_TRAVEL + WHEEL_RADIUS,
      spin: 0,
      surfaceNormal: new THREE.Vector3(0, 1, 0),
      slip: 0,
    });
    this.wheels = [wheel(-0.82, true), wheel(0.66, false)];
  }

  get gearRatio() {
    return GEARS[this.gear] * this.spec.finalDrive;
  }

  get rpmFraction() {
    return (this.rpm - this.spec.idle) / (this.spec.redline - this.spec.idle);
  }

  shift(dir: 1 | -1) {
    this.gear = THREE.MathUtils.clamp(this.gear + dir, 0, GEARS.length - 1);
    this.shiftCooldown = 0.25;
  }

  reset(position: THREE.Vector3, yaw: number) {
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setTranslation(toR(position), true);
    this.body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lean.set(0, 0);
    this.leanTarget = 0;
    this.crashed = false;
    this.crashCause = null;
    this.cannonLanding = false;
    this.body.setGravityScale(1, true);
    this.rider.body.setGravityScale(1, true);
    this.rider.setActive(true);
    this.rider.snapTo(this.body);
    for (const w of this.wheels) w.grounded = false;
    this.gear = 0;
    this.rpm = this.spec.idle;
    this.upsideDownTime = 0;
  }

  /** Heading around world Y, for cameras and resets. */
  get yaw() {
    const r = this.body.rotation();
    _fwd.set(0, 0, -1).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
    return Math.atan2(-_fwd.x, -_fwd.z);
  }

  /** Report a crash (the first cause wins until the player handles it). */
  crash(cause: string) {
    if (!this.crashed && !this.crashCause) this.crashCause = cause;
  }

  step(input: Controls, dt: number) {
    // Once crashed nobody is riding: no throttle, no balance, the bike just tumbles.
    const c = this.crashed ? IDLE_CONTROLS : input;
    const body = this.body;
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _qInv.copy(_q).invert();
    const t = body.translation();
    _origin.set(t.x, t.y, t.z);
    const cm = body.worldCom();
    _com.set(cm.x, cm.y, cm.z);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _right.set(1, 0, 0).applyQuaternion(_q);
    const lv = body.linvel(), av = body.angvel();
    _linv.set(lv.x, lv.y, lv.z);
    _angv.set(av.x, av.y, av.z);

    this.throttle = c.throttle;
    this.speed = _linv.dot(_fwd);
    const absSpeed = Math.abs(this.speed);

    // Steering lock narrows with speed so the turn never asks for more grip than the tyres have.
    const gripLimited = Math.atan((0.85 * TYRE_MU * GRAVITY * WHEELBASE) / Math.max(1, absSpeed * absSpeed));
    const maxSteer = Math.min(0.62, gripLimited);
    this.requestedSteer = c.steer * maxSteer;
    // Above walking pace a bike turns because it leans: steer the front wheel to the angle the current
    // lean can hold, and let the steering input set the lean (see applyBalance). At a crawl, steer directly.
    const curRoll = -Math.asin(THREE.MathUtils.clamp(_right.y, -1, 1));
    const leanSteer = Math.atan((GRAVITY * WHEELBASE * Math.tan(curRoll)) / Math.max(1, absSpeed * absSpeed));
    const byLean = THREE.MathUtils.smoothstep(absSpeed, 3, 8);
    this.steerAngle = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(this.requestedSteer, leanSteer * Math.sign(this.speed || 1), byLean),
      -maxSteer, maxSteer,
    );
    this.lean.x += (c.leanSide - this.lean.x) * Math.min(1, dt * 8);
    this.lean.y += (c.leanForward - this.lean.y) * Math.min(1, dt * 8);
    if (!this.crashed) {
      this.rider.couple(body, this.lean, dt);
      if (this.rider.stretch > CRASH_STRETCH) this.crash('thrown off');
    }

    this.updateEngine(c, dt);

    let groundedCount = 0;

    for (const w of this.wheels) {
      const origin = _p.copy(w.attach).applyQuaternion(_q).add(_origin);
      const maxLen = SUSP_TRAVEL + WHEEL_RADIUS;
      // A thin sphere sweep rather than a ray: rays running exactly along heightfield edges can miss.
      const hit = this.world.castShape(
        toR(origin), IDENTITY, DOWN, this.probe,
        0, maxLen + 0.3 - PROBE_RADIUS, true, undefined, PROBE_GROUPS, undefined, body,
      );

      // Round-profile tyre: leaned over, the contact patch rolls onto the tyre's side, so the wheel
      // centre sits (R - r)cos(lean) + r above the ground and the patch moves out sideways.
      let compression = -1;
      let cosLean = 1;
      if (hit) {
        w.surfaceNormal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
        const height = (hit.time_of_impact + PROBE_RADIUS) * w.surfaceNormal.y; // attach point above the ground plane
        cosLean = THREE.MathUtils.clamp(_up.dot(w.surfaceNormal), 0.25, 1);
        const centreToGround = (WHEEL_RADIUS - TYRE_CROWN) * cosLean + TYRE_CROWN;
        compression = SUSP_TRAVEL - (height - centreToGround) / cosLean;
      }

      if (!hit || compression < 0) {
        w.grounded = false;
        w.compression = 0;
        w.rayLength += (maxLen - w.rayLength) * Math.min(1, dt * 20);
        w.slip = 0;
        if (!w.steered) w.spin += ((this.rpm / this.gearRatio) * (Math.PI / 30)) * dt * c.throttle;
        continue;
      }

      groundedCount++;
      const touchdown = !w.grounded;
      w.grounded = true;
      w.rayLength = maxLen - compression; // attach point to wheel bottom, along the bike's axis
      // Compression rate: how fast the attach point closes on the ground surface. Measuring along the
      // bike's own axis instead would read forward speed as extension whenever the bike is pitched.
      _v.subVectors(origin, _com);
      _v.crossVectors(_angv, _v).add(_linv);
      const compVel = -_v.dot(w.surfaceNormal) / cosLean;
      if (touchdown) {
        this.landingImpact = Math.max(this.landingImpact, compVel);
        if (this.airTime > LANDING_MIN_AIR) this.checkLanding(w);
      }
      w.compression = compression;

      let springF = SUSP_K * compression;
      if (compression > SUSP_BUMP_START) springF += SUSP_BUMP_K * (compression - SUSP_BUMP_START);
      let damp = compVel > 0 ? SUSP_DAMP_COMP : SUSP_DAMP_REBOUND;
      // Hydraulic bottoming: soak up energy near full travel instead of springing it back.
      if (compression > SUSP_BUMP_START) damp *= 3;
      // Never damp harder than one physics step can resolve, or the damper itself oscillates.
      damp = Math.min(damp, (0.8 * effectiveMass(origin, _up)) / dt);
      const dampF = compVel * damp;
      const load = Math.max(0, springF + dampF);

      // Contact patch: down the bike's axis to the wheel centre, then to the low side of the tyre.
      _side.copy(w.surfaceNormal).negate().addScaledVector(_right, w.surfaceNormal.dot(_right)).normalize();
      const contact = origin
        .addScaledVector(_up, -(SUSP_TRAVEL - compression))
        .addScaledVector(_side, WHEEL_RADIUS - TYRE_CROWN)
        .addScaledVector(w.surfaceNormal, -TYRE_CROWN);
      // The ground pushes along its normal; pushing along the bike's tilted axis would act as thrust.
      body.applyImpulseAtPoint(toR(_imp.copy(w.surfaceNormal).multiplyScalar(load * dt)), toR(contact), true);

      // Tyre frame on the ground plane.
      const n = w.surfaceNormal;
      _wf.copy(_fwd);
      if (w.steered) _wf.applyAxisAngle(_up, -this.steerAngle);
      _wf.addScaledVector(n, -_wf.dot(n)).normalize();
      _lat.crossVectors(_wf, n).normalize();

      // Velocity of the chassis at the contact point.
      _v.subVectors(contact, _com);
      _v.crossVectors(_angv, _v).add(_linv);
      const vLong = _v.dot(_wf);
      const vLat = _v.dot(_lat);

      const mLat = effectiveMass(contact, _lat);
      const mLong = effectiveMass(contact, _wf);
      let jLat = -vLat * mLat * 0.45; // both tyres act at once, so each takes under half
      let jLong = 0;
      const stopJ = Math.abs(vLong) * mLong * 0.5; // impulse that would halve the rolling speed

      if (w.steered) {
        jLong -= Math.sign(vLong) * Math.min(stopJ, FRONT_BRAKE * c.brake * dt);
      } else {
        jLong += this.driveForce(c, vLong) * dt;
        jLong -= Math.sign(vLong) * Math.min(stopJ, REAR_BRAKE * c.brake * dt);
        // Walk the bike backwards when stopped and holding brake.
        if (c.brake > 0.5 && c.throttle === 0 && vLong < 0.5) jLong -= 450 * dt;
      }
      jLong -= Math.sign(vLong) * Math.min(stopJ, 0.02 * load * dt);

      const maxJ = TYRE_MU * load * dt;
      const mag = Math.hypot(jLong, jLat);
      w.slip = maxJ > 0 ? Math.min(1, mag / maxJ) : 1;
      if (mag > maxJ && mag > 0) {
        jLong *= maxJ / mag;
        jLat *= maxJ / mag;
      }
      _imp.copy(_wf).multiplyScalar(jLong).addScaledVector(_lat, jLat);
      body.applyImpulseAtPoint(toR(_imp), toR(contact), true);

      w.spin += (vLong / WHEEL_RADIUS) * dt;
    }

    this.grounded = groundedCount > 0;
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    // Aero drag (none in the cannon's cartoon flight, or it would fall short).
    const v2 = _linv.lengthSq();
    if (v2 > 0.01 && !this.cannonLanding) {
      const drag = 0.5 * 1.2 * DRAG_CDA * v2 * dt;
      body.applyImpulse(toR(_imp.copy(_linv).normalize().multiplyScalar(-drag)), true);
    }

    if (!this.crashed) this.applyBalance(c, dt);

    this.upsideDownTime = _up.y < 0.1 ? this.upsideDownTime + dt : 0;
    if (this.upsideDownTime > 0.6) this.crash('upside down');
  }

  /** A wheel just touched down: was that a landing a rider could ride away from? */
  private checkLanding(w: WheelState) {
    const n = w.surfaceNormal;
    const impact = -_linv.dot(n); // the bike's own speed into the ground, ignoring how it's rotating
    const pitch = Math.asin(THREE.MathUtils.clamp(_fwd.dot(n), -1, 1)); // + nose up
    const roll = Math.asin(THREE.MathUtils.clamp(_right.dot(n), -1, 1));
    if (impact > CRASH_IMPACT && !this.cannonLanding) this.crash('cased it');
    else if (w.steered && pitch < -CRASH_NOSE_DOWN) this.crash('over the bars');
    else if (!w.steered && pitch > CRASH_LOOPED) this.crash('looped out');
    else if (Math.abs(roll) > CRASH_LANDING_ROLL) this.crash('landed sideways');
  }

  /** How far the nose is lifted off the ground (radians), 0 unless the rear wheel is down. */
  get wheelieAngle() {
    const rear = this.wheels[1];
    if (!rear.grounded || this.wheels[0].grounded) return 0;
    return Math.asin(THREE.MathUtils.clamp(_fwd.dot(rear.surfaceNormal), -1, 1));
  }

  private driveForce(c: Controls, vLong: number) {
    if (this.rpm >= this.spec.redline) return 0;
    // Feathering the throttle as the nose climbs, unless the rider is leaning back for a wheelie.
    const limit = 0.18 + 0.27 * Math.max(0, -this.lean.y);
    const feather = 1 - 0.9 * THREE.MathUtils.smoothstep(this.wheelieAngle, limit, limit + 0.2);
    const f = (torqueAt(this.spec, this.rpm) * c.throttle * feather * this.gearRatio * 0.9) / WHEEL_RADIUS;
    // Ease off near zero speed so the bike creeps rather than lurches when the clutch bites.
    return vLong < -0.5 ? f * 0.3 : f;
  }

  private updateEngine(c: Controls, dt: number) {
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    const rear = this.wheels[1];
    const { idle, redline } = this.spec;
    let target: number;
    if (rear.grounded) {
      const wheelRpm = (Math.abs(this.speed) / WHEEL_RADIUS) * (30 / Math.PI);
      const locked = wheelRpm * this.gearRatio;
      // Below ~3000 rpm the clutch slips, letting the engine rev above road speed.
      const slipRpm = idle + c.throttle * 4200;
      target = Math.max(locked, Math.min(slipRpm, 3000 + locked * 0.5), idle);
      // Wheelspin lets revs climb past road speed when the rear tyre is at its limit.
      if (rear.slip > 0.98 && c.throttle > 0) target = Math.max(target, locked + 1500 * c.throttle);
      this.rpm += (target - this.rpm) * Math.min(1, dt * 18);
    } else {
      target = idle + c.throttle * (redline + 300 - idle);
      this.rpm += (target - this.rpm) * Math.min(1, dt * (c.throttle > 0 ? 6 : 3));
    }
    this.rpm = THREE.MathUtils.clamp(this.rpm, idle, redline + 200);

    if (this.autoShift && this.shiftCooldown === 0 && rear.grounded) {
      if (this.rpm > this.spec.shiftUp && this.gear < GEARS.length - 1) this.shift(1);
      else if (this.rpm < this.spec.shiftDown && this.gear > 0) this.shift(-1);
    }
  }

  /**
   * The rider's balance and air control. Weight shift itself is physical (see Rider); these torques
   * stand in for steering inputs and pushing on the bars, scaled for an arcade feel like the original.
   */
  private applyBalance(c: Controls, dt: number) {
    const body = this.body;
    const v2 = _linv.lengthSq();
    const rollRate = _angv.dot(_fwd);
    const pitchRate = _angv.dot(_right);
    const roll = -Math.asin(THREE.MathUtils.clamp(_right.y, -1, 1));
    const torque = _imp.set(0, 0, 0);

    if (this.grounded) {
      // Lean for the turn the rider is asking for (speed and steering), not the bike's actual yaw:
      // following actual yaw feeds a rear-wheel slide back into more lean.
      const turnLean = Math.atan2(this.speed * this.speed * Math.tan(this.requestedSteer), GRAVITY * WHEELBASE);
      const desired = THREE.MathUtils.clamp(turnLean + this.lean.x * 0.2, -MAX_LEAN, MAX_LEAN);
      // A rider can't throw the bike over instantly; snapping the target makes the wheels skip.
      this.leanTarget += THREE.MathUtils.clamp(desired - this.leanTarget, -LEAN_RATE * dt, LEAN_RATE * dt);
      const target = this.leanTarget;
      torque.addScaledVector(_fwd, INERTIA.z * (LEAN_KP * (target - roll) - LEAN_KD * rollRate));
      // A firm stop past the tyres' limit: the rider won't let it fold over.
      const over = Math.abs(roll) - MAX_LEAN - 0.05;
      if (over > 0) torque.addScaledVector(_fwd, -Math.sign(roll) * INERTIA.z * 400 * over);
      // Wheelie control: past a point the rider pulls the nose back down, unless leaning back for it.
      const nose = this.wheelieAngle;
      const limit = 0.12 + 0.32 * Math.max(0, -this.lean.y) - 0.06 * Math.max(0, this.lean.y);
      if (nose > limit) torque.addScaledVector(_right, -INERTIA.x * (70 * (nose - limit) + 6 * Math.max(0, pitchRate)));
    } else {
      this.leanTarget = roll;
      // Mid-air: weight shift pitches and rolls the bike; throttle/brake torque the rear wheel.
      const gyro = (c.throttle - c.brake) * 0.5;
      torque.addScaledVector(_right, INERTIA.x * (-5 * this.lean.y + gyro - 1.2 * pitchRate));
      torque.addScaledVector(_fwd, INERTIA.z * (5 * this.lean.x - 3 * roll - 2 * rollRate));
      torque.addScaledVector(_up, -INERTIA.y * 2.5 * c.steer);
      // Spinning wheels and the rider keep the bike pointing where it's going: damp yaw, and turn the
      // nose gently towards the direction of travel.
      const yawRate = _angv.dot(_up);
      torque.addScaledVector(_up, -INERTIA.y * 3 * yawRate);
      const fx = _fwd.x, fz = _fwd.z, vx = _linv.x, vz = _linv.z;
      if (vx * vx + vz * vz > 25 && fx * fx + fz * fz > 0.1) {
        const off = Math.atan2(fz * vx - fx * vz, fx * vx + fz * vz); // + = travelling to the left of the nose
        torque.addScaledVector(_up, INERTIA.y * 2.5 * off);
      }
      // A gentle pull that lines the bike up with its flight path, like a rider instinctively would.
      if (v2 > 25) {
        const align = _v.crossVectors(_fwd, _linv).divideScalar(Math.sqrt(v2)).dot(_right);
        torque.addScaledVector(_right, INERTIA.x * 2.5 * align * (1 - Math.abs(this.lean.y)));
      }
    }
    // Split between bike and rider: the rider moves the bike with their body, and pushing only on
    // the light bike makes the controller overshoot from one physics step to the next.
    torque.multiplyScalar(dt * 0.5);
    body.applyTorqueImpulse(toR(torque), true);
    this.rider.body.applyTorqueImpulse(toR(torque), true);
  }
}
