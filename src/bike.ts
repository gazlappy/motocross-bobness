import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Controls } from './input.ts';

// Bike-local axes: forward = -Z, right = +X, up = +Y. Origin = centre of mass (bike + rider).

const MASS = 180;
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

const GEARS = [2.9, 2.1, 1.62, 1.3, 1.08];
const FINAL_DRIVE = 10;
const IDLE_RPM = 1600;
const REDLINE = 11500;
const SHIFT_UP_RPM = 10400;
const SHIFT_DOWN_RPM = 5200;
const PEAK_TORQUE = 44; // Nm at the crank, 250 two-stroke-ish
const TORQUE_CURVE: [number, number][] = [
  [0, 0.4], [1600, 0.45], [4000, 0.68], [7000, 0.95], [8500, 1], [10500, 0.86], [11500, 0.6], [12500, 0],
];

const FRONT_BRAKE = 1700;
const REAR_BRAKE = 850;
const DRAG_CDA = 0.55;

function torqueAt(rpm: number) {
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    const [r1, t1] = TORQUE_CURVE[i];
    if (rpm <= r1) {
      const [r0, t0] = TORQUE_CURVE[i - 1];
      return PEAK_TORQUE * THREE.MathUtils.lerp(t0, t1, (rpm - r0) / (r1 - r0));
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
const _linv = new THREE.Vector3();
const _angv = new THREE.Vector3();
const _imp = new THREE.Vector3();

const toR = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

export class Bike {
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelState[];
  rpm = IDLE_RPM;
  gear = 0;
  autoShift = true;
  steerAngle = 0;
  speed = 0; // forward m/s
  grounded = false;
  airTime = 0;
  lean = new THREE.Vector2(); // rider weight shift: x = side, y = forward
  private shiftCooldown = 0;
  private upsideDownTime = 0;
  private probe = new RAPIER.Ball(PROBE_RADIUS);
  private world: RAPIER.World;

  constructor(world: RAPIER.World, position: THREE.Vector3, yaw = 0) {
    this.world = world;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      .setAdditionalMassProperties(MASS, { x: 0, y: 0, z: 0 }, toR(INERTIA), { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0.02)
      .setAngularDamping(0.25)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = world.createRigidBody(desc);

    // Bike frame and rider's head: these only touch the ground when something has gone wrong.
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.16, 0.24, 0.6).setTranslation(0, 0.18, 0).setDensity(0).setFriction(0.6),
      this.body,
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(0.2).setTranslation(0, 1.1, -0.05).setDensity(0).setFriction(0.6),
      this.body,
    );

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
    return GEARS[this.gear] * FINAL_DRIVE;
  }

  get rpmFraction() {
    return (this.rpm - IDLE_RPM) / (REDLINE - IDLE_RPM);
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
    this.gear = 0;
    this.rpm = IDLE_RPM;
    this.upsideDownTime = 0;
  }

  /** Heading around world Y, for cameras and resets. */
  get yaw() {
    const r = this.body.rotation();
    _fwd.set(0, 0, -1).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
    return Math.atan2(-_fwd.x, -_fwd.z);
  }

  get isUpsideDownLong() {
    return this.upsideDownTime > 2.5;
  }

  step(c: Controls, dt: number) {
    const body = this.body;
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const t = body.translation();
    _com.set(t.x, t.y, t.z);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _right.set(1, 0, 0).applyQuaternion(_q);
    const lv = body.linvel(), av = body.angvel();
    _linv.set(lv.x, lv.y, lv.z);
    _angv.set(av.x, av.y, av.z);

    this.speed = _linv.dot(_fwd);
    const absSpeed = Math.abs(this.speed);

    // Steering lock narrows with speed so the turn never asks for more grip than the tyres have.
    const gripLimited = Math.atan((0.95 * TYRE_MU * GRAVITY * WHEELBASE) / Math.max(1, absSpeed * absSpeed));
    const maxSteer = Math.min(0.62, gripLimited * 1.15);
    this.steerAngle = c.steer * maxSteer;
    this.lean.x += (c.leanSide - this.lean.x) * Math.min(1, dt * 8);
    this.lean.y += (c.leanForward - this.lean.y) * Math.min(1, dt * 8);

    this.updateEngine(c, dt);

    const wheelMass = MASS * 0.5;
    let groundedCount = 0;

    for (const w of this.wheels) {
      const origin = _p.copy(w.attach).applyQuaternion(_q).add(_com);
      const maxLen = SUSP_TRAVEL + WHEEL_RADIUS;
      // A thin sphere sweep rather than a ray: rays running exactly along heightfield edges can miss.
      const hit = this.world.castShape(
        toR(origin), IDENTITY, { x: -_up.x, y: -_up.y, z: -_up.z }, this.probe,
        0, maxLen - PROBE_RADIUS, true, undefined, undefined, undefined, body,
      );

      if (!hit) {
        w.grounded = false;
        w.compression = 0;
        w.rayLength += (maxLen - w.rayLength) * Math.min(1, dt * 20);
        w.slip = 0;
        if (!w.steered) w.spin += ((this.rpm / this.gearRatio) * (Math.PI / 30)) * dt * c.throttle;
        continue;
      }

      groundedCount++;
      w.grounded = true;
      const dist = hit.time_of_impact + PROBE_RADIUS;
      w.rayLength = dist;
      w.surfaceNormal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
      const compression = maxLen - dist;
      // Compression rate from the chassis velocity at the attach point (the ground doesn't move).
      _v.subVectors(origin, _com);
      _v.crossVectors(_angv, _v).add(_linv);
      const compVel = -_v.dot(_up);
      w.compression = compression;

      let springF = SUSP_K * compression;
      if (compression > SUSP_BUMP_START) springF += SUSP_BUMP_K * (compression - SUSP_BUMP_START);
      let dampF = compVel * (compVel > 0 ? SUSP_DAMP_COMP : SUSP_DAMP_REBOUND);
      // Hydraulic bottoming: soak up energy near full travel instead of springing it back.
      if (compression > SUSP_BUMP_START) dampF *= 3;
      const load = Math.max(0, springF + dampF);

      const contact = origin.addScaledVector(_up, -dist);
      body.applyImpulseAtPoint(toR(_imp.copy(_up).multiplyScalar(load * dt)), toR(contact), true);

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

      let jLat = -vLat * wheelMass * 0.45;
      let jLong = 0;

      if (w.steered) {
        jLong -= Math.sign(vLong) * Math.min(Math.abs(vLong) * wheelMass * 0.5, FRONT_BRAKE * c.brake * dt);
      } else {
        jLong += this.driveForce(c, vLong) * dt;
        jLong -= Math.sign(vLong) * Math.min(Math.abs(vLong) * wheelMass * 0.5, REAR_BRAKE * c.brake * dt);
        // Walk the bike backwards when stopped and holding brake.
        if (c.brake > 0.5 && c.throttle === 0 && vLong < 0.5) jLong -= 450 * dt;
      }
      jLong -= Math.sign(vLong) * Math.min(Math.abs(vLong) * wheelMass * 0.5, 0.02 * load * dt);

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

    // Aero drag.
    const v2 = _linv.lengthSq();
    if (v2 > 0.01) {
      const drag = 0.5 * 1.2 * DRAG_CDA * v2 * dt;
      body.applyImpulse(toR(_imp.copy(_linv).normalize().multiplyScalar(-drag)), true);
    }

    this.applyBalance(c, dt);

    this.upsideDownTime = _up.y < 0.1 && absSpeed < 2 ? this.upsideDownTime + dt : 0;
  }

  private driveForce(c: Controls, vLong: number) {
    if (this.rpm >= REDLINE) return 0;
    const f = (torqueAt(this.rpm) * c.throttle * this.gearRatio * 0.9) / WHEEL_RADIUS;
    // Ease off near zero speed so the bike creeps rather than lurches when the clutch bites.
    return vLong < -0.5 ? f * 0.3 : f;
  }

  private updateEngine(c: Controls, dt: number) {
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    const rear = this.wheels[1];
    let target: number;
    if (rear.grounded) {
      const wheelRpm = (Math.abs(this.speed) / WHEEL_RADIUS) * (30 / Math.PI);
      const locked = wheelRpm * this.gearRatio;
      // Below ~3000 rpm the clutch slips, letting the engine rev above road speed.
      const slipRpm = IDLE_RPM + c.throttle * 4200;
      target = Math.max(locked, Math.min(slipRpm, 3000 + locked * 0.5), IDLE_RPM);
      // Wheelspin lets revs climb past road speed when the rear tyre is at its limit.
      if (rear.slip > 0.98 && c.throttle > 0) target = Math.max(target, locked + 1500 * c.throttle);
      this.rpm += (target - this.rpm) * Math.min(1, dt * 18);
    } else {
      target = IDLE_RPM + c.throttle * (REDLINE + 300 - IDLE_RPM);
      this.rpm += (target - this.rpm) * Math.min(1, dt * (c.throttle > 0 ? 6 : 3));
    }
    this.rpm = THREE.MathUtils.clamp(this.rpm, IDLE_RPM, REDLINE + 200);

    if (this.autoShift && this.shiftCooldown === 0 && rear.grounded) {
      if (this.rpm > SHIFT_UP_RPM && this.gear < GEARS.length - 1) this.shift(1);
      else if (this.rpm < SHIFT_DOWN_RPM && this.gear > 0) this.shift(-1);
    }
  }

  /**
   * Stand-in for the rider: keeps the bike leaned to match the turn, and turns weight shift into
   * pitch/roll. Step 2 replaces most of this with a separately simulated rider.
   */
  private applyBalance(c: Controls, dt: number) {
    const body = this.body;
    const v2 = _linv.lengthSq();
    const rollRate = _angv.dot(_fwd);
    const pitchRate = _angv.dot(_right);
    const roll = -Math.asin(THREE.MathUtils.clamp(_right.y, -1, 1));
    const torque = _imp.set(0, 0, 0);

    if (this.grounded) {
      const yawRate = -_angv.dot(_up);
      const turnLean = Math.atan2(this.speed * yawRate, GRAVITY);
      const target = THREE.MathUtils.clamp(turnLean + this.lean.x * 0.25, -0.95, 0.95);
      torque.addScaledVector(_fwd, INERTIA.z * (90 * (target - roll) - 15 * rollRate));
      // Weight forward/back helps hold or kill a wheelie.
      torque.addScaledVector(_right, -INERTIA.x * 5 * this.lean.y);
    } else {
      // Mid-air: weight shift pitches and rolls the bike; throttle/brake torque the rear wheel.
      const gyro = (c.throttle - c.brake) * 0.5;
      torque.addScaledVector(_right, INERTIA.x * (-7 * this.lean.y + gyro - 1.2 * pitchRate));
      torque.addScaledVector(_fwd, INERTIA.z * (5 * this.lean.x - 3 * roll - 2 * rollRate));
      torque.addScaledVector(_up, -INERTIA.y * 2.5 * c.steer);
      // A gentle pull that lines the bike up with its flight path, like a rider instinctively would.
      if (v2 > 25) {
        const align = _v.crossVectors(_fwd, _linv).divideScalar(Math.sqrt(v2)).dot(_right);
        torque.addScaledVector(_right, INERTIA.x * 2.5 * align * (1 - Math.abs(this.lean.y)));
      }
    }
    body.applyTorqueImpulse(toR(torque.multiplyScalar(dt)), true);
  }
}
