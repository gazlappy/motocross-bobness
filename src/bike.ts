import * as THREE from 'three';
import { BIKES, type BikeSpec } from './bikes.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Controls } from './input.ts';
import { DEFAULT_TUNING, type Tuning, torqueCurve, tuningFactors } from './tuning.ts';
import { GROUP_AI_BIKE, GROUP_BIKE, GROUP_PROBE, GROUP_RAGDOLL, GROUP_WORLD, Rider, groups } from './rider.ts';

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
/** Where the progressive bump stop begins, and its rate: the same force at full travel as the old
 * hard stop (SUSP_BUMP_K over the last few centimetres), reached smoothly. */
const BUMP_ZONE_START = 0.34;
const BUMP_K2 = (SUSP_BUMP_K * (SUSP_TRAVEL - SUSP_BUMP_START)) / (SUSP_TRAVEL - BUMP_ZONE_START) ** 2;
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

// Five gears with a tall top one: the original let the bike run on past 100 mph.
const GEARS = [2.9, 2.05, 1.55, 1.18, 0.9];

// Gentler than a real bike's, towards the original's (~0.43 g): about 0.7 g with both.
const FRONT_BRAKE = 800;
const REAR_BRAKE = 420;
/** Brake input that locks the rear wheel (a keyboard's brake key is always full). */
const REAR_LOCK = 0.75;
/** A locked tyre: sliding friction along it, and the share of its sideways grip it keeps. */
const SLIDE_MU = 0.6 * TYRE_MU;
const LOCKED_GRIP = 0.4;
/** How far the back end steps out in a locked-rear slide (radians), and how firmly it's held there. */
const SLIDE_ANGLE = 0.5;
const EASY_SLIDE = 0.35;
const SLIDE_KP = 30;
const SLIDE_KD = 9;
const DRAG_CDA = 0.42;
/** Classic, as in the original: the tyres grip far harder sideways than along the wheel, the front much
 * harder than the rear (the original's front 6.0, rear 0.6), so the bike turns on its bars and the back
 * end can come round. Easy keeps the rear closer to the front. */
const FRONT_SIDE_MU = 3.2;
const REAR_SIDE_MU = 2.4;
const EASY_FRONT_SIDE_MU = 2.9;
const EASY_REAR_SIDE_MU = 2.4;
/** Classic: full lock, the original's 36 degrees times its default steering sensitivity (0.8). */
const CLASSIC_LOCK = THREE.MathUtils.degToRad(29);
/** Classic: a steady turn at full lock asks the rear for this share of its sideways grip (the rest is for drive). */
const CLASSIC_TURN_SHARE = 0.75;
/** Classic: the original sets the lean directly, steer x 0.05 x speed in ft/s (radians), at least 5 degrees. */
const CLASSIC_LEAN_PER_FTS = 0.05;
const CLASSIC_MIN_LEAN = THREE.MathUtils.degToRad(5);
/** ...but only on its wheels: pitched further than this from the ground (sine), it's left to fall. */
const CLASSIC_LEAN_MAX_PITCH = Math.sin(0.6);
/** Classic: how far the back end can step out (radians) before the rider stops it, and how firmly. */
const TAIL_FREE = 0.4;
const CLASSIC_TRACK_KP = 40;
const CLASSIC_TRACK_KD = 6;
/** Classic: extra rear grip on steep climbs (as a share of normal grip), from and to these slopes (sin). */
const CLIMB_GRIP = 0.9;
const CLIMB_GRIP_FROM = Math.sin(0.35);
const CLIMB_GRIP_FULL = Math.sin(0.85);
const LEAN_KP = 140;
const LEAN_KD = 35;
const LEAN_RATE = THREE.MathUtils.degToRad(120); // the original's roll rate

// Crash thresholds.
const CRASH_IMPACT = 16; // m/s into the ground: a flat landing from ~13 m (the original was forgiving)
const CRASH_NOSE_DOWN = 0.8; // rad, front wheel landing that steep goes over the bars
const CRASH_LOOPED = 1.15; // rad, landing on the rear wheel that far past vertical-ish
const CRASH_LANDING_ROLL = 1.05; // rad, landing leaned over this far
const CRASH_STRETCH = 0.42; // m, rider ripped off the pegs
const LANDING_MIN_AIR = 0.3; // s: shorter hops over bumps aren't judged as landings
const MAX_LEAN = THREE.MathUtils.degToRad(40); // the original's limit (the tyres could hold a little more)
/** Easy controls: how much more a landing or a jolt can take before it's a crash. */
const EASY_FORGIVENESS = 1.4;
/** Easy controls: how much harder the rider can be jolted before being thrown off. */
const EASY_GRIP = 1.8;
/** Easy controls: the deepest lean asked for, as a fraction of the tyres' limit. */
const EASY_LEAN = 0.75;

// Realistic handling (the classic, arcade-tuned model is the default).
/** Knobblies on dirt: peak grip, and what's left once a tyre has broken loose. */
const REAL_MU = 0.95;
const REAL_SLIDE_MU = 0.8;
const REAL_MAX_LEAN = Math.atan(0.95 * REAL_MU);
/** How fast the rider can lay the bike over (rad/s), slower at speed as the wheels' gyro resists. */
const REAL_LEAN_RATE = 2.1;
/** Engine braking off the throttle at full revs, newtons at the rear tyre. */
const ENGINE_BRAKE = 520;
/** How far the back end can step out before the rider runs out of countersteer (radians). */
const POWERSLIDE_MAX = 0.7;
const EASY_POWERSLIDE_MAX = 0.4;
/** Back end this far out at speed is a spin; the front sliding sideways this far, this long, is a wash-out. */
const SPIN_OUT = 1.25;
const WASH_OUT_ANGLE = 0.2;
const WASH_OUT_TIME = 0.5;

function torqueAt(spec: BikeSpec, curve: [number, number][], rpm: number) {
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
  sliding: boolean; // realistic handling: broken loose, on sliding grip until it hooks up again
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
/** What drawing a bike needs: a physics bike, or a rider seen over the network. */
export interface BikeView {
  body: { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } };
  wheels: readonly Pick<WheelState, 'attach' | 'rayLength' | 'spin'>[];
  steerAngle: number;
}

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
  private readonly bumper: RAPIER.Collider;
  /** Set by the out-of-bounds cannon: the next landing's impact is forgiven. */
  cannonLanding = false;
  /** Easy controls: the bike helps (steadier in the air, forgiving landings, traction control). */
  assist = false;
  /**
   * Realistic handling: loose dirt grip that breaks away, power slides held with countersteer, engine
   * braking, a slower lean, and air control from the throttle and rear brake rather than an autopilot.
   */
  realistic = false;
  /** Realistic: how far the back end is out (radians, + = tail out to the right) and how long the front has slid. */
  /** How far the rear tyre is sliding sideways (radians, + = back end out to the left). */
  tailOut = 0;
  private tailOutPrev = 0;
  private frontWash = 0;
  /** Garage settings: engine curve, springs, damping, traction (see tuning.ts). */
  private curve: [number, number][];
  private tune = tuningFactors(DEFAULT_TUNING);
  /** Hard braking locks the rear and slides it (the AI keeps its brakes on the edge instead). */
  canLockRear = true;
  /** The rear wheel is locked and sliding. */
  rearLocked = false;
  private slidePrev: number | null = null;
  /** Easy: where the rider puts their weight (x side, y forward), worked out each step. */
  private autoLean = new THREE.Vector2();
  brake = 0;
  /** Ground height at (x, z), for the assist to see where a jump will land. */
  groundHeight: ((x: number, z: number) => number) | null = null;
  lean = new THREE.Vector2(); // rider weight shift: x = side, y = forward
  private shiftCooldown = 0;
  private leanTarget = 0;
  private requestedSteer = 0;
  /** The steering asked for this step, as a share of the lock (classic sets the lean from it). */
  private steerShare = 0;
  private upsideDownTime = 0;
  private probe = new RAPIER.Ball(PROBE_RADIUS);
  private world: RAPIER.World;

  constructor(world: RAPIER.World, position: THREE.Vector3, yaw = 0, spec: BikeSpec = BIKES['250']) {
    this.world = world;
    this.spec = spec;
    this.curve = spec.torqueCurve;
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
        .setCollisionGroups(groups(GROUP_BIKE, GROUP_WORLD | GROUP_RAGDOLL))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    // Bike-to-bike contact goes through a rounded, slippery bumper: box corners snagging on each other
    // jolted both bikes (visible judder when riders bunch up). The frame above only meets the ground.
    this.bumper = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.42, 0.2)
        .setTranslation(0, 0.25, 0)
        .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }) // lie along the bike
        .setDensity(0)
        .setFriction(0.1)
        .setRestitution(0)
        .setCollisionGroups(groups(GROUP_BIKE, GROUP_BIKE | GROUP_AI_BIKE)),
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
      sliding: false,
    });
    this.wheels = [wheel(-0.82, true), wheel(0.66, false)];
  }

  /** Set the garage's engine, suspension and tyres. */
  setTuning(t: Tuning) {
    this.curve = torqueCurve(this.spec, t.engine);
    this.tune = tuningFactors(t);
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

  /** An AI rider's bike: bumps the player's bike but passes through other AI bikes. */
  riddenByAi() {
    this.bumper.setCollisionGroups(groups(GROUP_AI_BIKE, GROUP_BIKE));
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
    this.brake = c.brake;
    this.speed = _linv.dot(_fwd);
    const absSpeed = Math.abs(this.speed);

    // Steering lock narrows with speed so the turn never asks for more grip than the tyres have.
    const mu = (this.realistic ? REAL_MU : this.sideMu(false)) * this.tune.grip;
    const gripLimited = Math.atan(((this.realistic ? 0.85 : CLASSIC_TURN_SHARE) * mu * GRAVITY * WHEELBASE) / Math.max(1, absSpeed * absSpeed));
    const maxSteer = Math.min(this.realistic ? 0.62 : CLASSIC_LOCK, gripLimited);
    this.requestedSteer = c.steer * maxSteer;
    // Easy: straighten up on a steep climb (a jump face), as a rider would before taking off.
    if (this.assist && this.grounded) {
      const climb = Math.asin(THREE.MathUtils.clamp(_fwd.y, -1, 1));
      this.requestedSteer *= 1 - 0.85 * THREE.MathUtils.smoothstep(climb, 0.12, 0.3);
    }
    this.steerShare = maxSteer > 0 ? this.requestedSteer / maxSteer : 0;
    // Above walking pace a bike turns because it leans: steer the front wheel to the angle the current
    // lean can hold, and let the steering input set the lean (see applyBalance). At a crawl, steer directly.
    const curRoll = -Math.asin(THREE.MathUtils.clamp(_right.y, -1, 1));
    const leanSteer = Math.atan((GRAVITY * WHEELBASE * Math.tan(curRoll)) / Math.max(1, absSpeed * absSpeed));
    const byLean = this.realistic ? THREE.MathUtils.smoothstep(absSpeed, 3, 8) : 0;
    this.steerAngle = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(this.requestedSteer, leanSteer * Math.sign(this.speed || 1), byLean),
      -maxSteer, maxSteer,
    );
    // Realistic: with the back end out, the rider points the front where the bike is going (countersteer).
    if (this.realistic && this.grounded && absSpeed > 3) {
      const counter = THREE.MathUtils.smoothstep(Math.abs(this.tailOut), 0.05, 0.2) * this.tailOut * 0.9;
      this.steerAngle = THREE.MathUtils.clamp(this.steerAngle + counter, -0.62, 0.62);
    }
    // Easy: the rider's weight shift is automatic (the lean keys only pick stunts).
    const leanSide = this.assist ? this.autoLean.x : c.leanSide;
    const leanForward = this.assist ? this.autoLean.y : c.leanForward;
    if (this.assist) this.updateAutoLean(c, curRoll, absSpeed);
    this.lean.x += (leanSide - this.lean.x) * Math.min(1, dt * 8);
    this.lean.y += (leanForward - this.lean.y) * Math.min(1, dt * 8);
    if (!this.crashed) {
      this.rider.couple(body, this.lean, dt);
      if (this.rider.stretch > CRASH_STRETCH * (this.assist ? EASY_GRIP : 1)) this.crash('thrown off');
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
        // A sweep catching a triangle edge can report a near-sideways normal, and pushing along it kicks
        // the bike sideways. No rideable ground is that steep: keep the last good normal instead.
        const n = hit.normal1;
        if (n.y >= 0.5) w.surfaceNormal.set(n.x, n.y, n.z);
        else if (!w.grounded) w.surfaceNormal.set(0, 1, 0);
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
        w.sliding = false;
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

      // Progressive bump stop near the end of travel: the extra spring and the hydraulic bottoming
      // damping build in smoothly. A hard edge here jolted bikes on every roller (visible judder).
      const bump = Math.max(0, compression - BUMP_ZONE_START);
      const tune = this.tune;
      let springF = SUSP_K * (w.steered ? tune.frontSpring : tune.rearSpring) * compression + BUMP_K2 * bump * bump;
      let damp = (compVel > 0 ? SUSP_DAMP_COMP : SUSP_DAMP_REBOUND) * (w.steered ? tune.frontDamping : tune.rearDamping);
      damp *= 1 + 2 * THREE.MathUtils.smoothstep(compression, BUMP_ZONE_START, BUMP_ZONE_START + 0.05);
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
        // With the rear locked and sliding the front brake eases, so the bike slides rather than stops.
        const front = this.rearLocked ? 0.3 : 1;
        jLong -= Math.sign(vLong) * Math.min(stopJ, FRONT_BRAKE * front * c.brake * dt);
      } else {
        jLong += this.driveForce(c, vLong) * dt;
        jLong -= Math.sign(vLong) * Math.min(stopJ, REAR_BRAKE * c.brake * dt);
        // Realistic: closing the throttle, the engine holds the bike back (harder at high revs).
        if (this.realistic && c.throttle < 0.05 && c.brake < REAR_LOCK && absSpeed > 2) {
          jLong -= Math.sign(vLong) * Math.min(stopJ, ENGINE_BRAKE * Math.max(0, this.rpmFraction) * dt);
        }
        // Walk the bike backwards when stopped and holding brake.
        if (c.brake > 0.5 && c.throttle === 0 && Math.abs(this.speed) < 0.5) jLong -= 450 * dt;
      }
      jLong -= Math.sign(vLong) * Math.min(stopJ, 0.02 * this.tune.rolling * load * dt);

      // Classic: on a steep climb the rear knobblies dig in for more drive, so the bowl walls can be
      // ridden up as in the original (a real tyre would spin out on them).
      const climb = !w.steered && !this.realistic ? THREE.MathUtils.smoothstep(_fwd.y, CLIMB_GRIP_FROM, CLIMB_GRIP_FULL) : 0;
      const maxJ = TYRE_MU * this.tune.grip * (1 + CLIMB_GRIP * climb) * load * dt;
      // Rear brake hard enough to lock the wheel: it slides, dragging with sliding friction and keeping
      // only a little sideways grip, so the back end steps out of the turn (turning right, it kicks
      // out left). Grip returns as the slide gets big: a lot in Easy, a little otherwise.
      const locked = !w.steered && this.canLockRear && c.brake > REAR_LOCK && Math.abs(vLong) > 1.5;
      if (!w.steered) this.rearLocked = locked;
      if (locked) {
        // A sliding tyre drags against its whole motion, sideways included: the rear drifts out until
        // the drag's sideways share holds it on the turn, then holds that angle.
        const vSlide = Math.hypot(vLong, vLat);
        const drag = Math.min(SLIDE_MU * this.tune.grip * load * dt, vSlide * mLong * 0.5);
        jLong = (-vLong / vSlide) * drag;
        const slideLat = (-vLat / vSlide) * drag;
        // Grip comes back as the slide gets big: a lot in Easy (it catches itself), a little otherwise.
        const angle = Math.atan2(Math.abs(vLat), Math.abs(vLong));
        const extra = this.assist
          ? (1 - LOCKED_GRIP) * THREE.MathUtils.smoothstep(angle, 0.3, 0.55)
          : (0.9 - LOCKED_GRIP) * THREE.MathUtils.smoothstep(angle, 0.5, 0.85);
        const latMax = (LOCKED_GRIP + extra) * maxJ;
        jLat = Math.abs(slideLat) >= Math.abs(jLat) ? slideLat : THREE.MathUtils.clamp(jLat, -latMax, latMax);
        if (Math.abs(jLat) < Math.abs(slideLat)) jLat = slideLat;
        w.slip = 1;
      } else if (this.realistic) {
        // Loose dirt: grip holds up to its peak, then the tyre breaks loose and slides on less until
        // the rider asks for well under that again. A spinning rear gives drive first and what's left
        // of its grip sideways, so the back end steps out under power.
        const peak = REAL_MU * this.tune.grip * load * dt;
        const sliding = REAL_SLIDE_MU * this.tune.grip * load * dt;
        if (this.assist && Math.sign(jLong) !== Math.sign(vLong)) {
          // Easy: ABS (the brakes stop short of sliding); drive is left alone for power slides.
          const budget = Math.sqrt(Math.max(0, (0.92 * peak) ** 2 - jLat * jLat));
          if (Math.abs(jLong) > budget) jLong = Math.sign(jLong) * budget;
        }
        const demand = Math.hypot(jLong, jLat);
        if (!w.sliding && demand > peak) w.sliding = true;
        else if (w.sliding && demand < 0.9 * sliding) w.sliding = false;
        const cap = w.sliding ? sliding : peak;
        if (demand > cap) {
          if (!w.steered && c.throttle > 0.2 && Math.sign(jLong) === Math.sign(vLong || 1)) {
            jLong = THREE.MathUtils.clamp(jLong, -0.85 * cap, 0.85 * cap);
            const side = Math.sqrt(cap * cap - jLong * jLong);
            jLat = THREE.MathUtils.clamp(jLat, -side, side);
          } else {
            jLong *= cap / demand;
            jLat *= cap / demand;
          }
        }
        w.slip = w.sliding ? 1 : Math.min(1, demand / peak);
      } else {
        // Easy: ABS and traction control in one. Cornering grip comes first; brakes and drive only get
        // what's left of the tyre, kept just short of sliding.
        // A friction ellipse: the full along-the-wheel grip, and far more sideways.
        const side = this.rearLocked ? 1 : this.sideMu(w.steered) / TYRE_MU;
        if (this.assist) {
          const budget = Math.sqrt(Math.max(0, (0.92 * maxJ) ** 2 - (jLat / side) ** 2));
          if (Math.abs(jLong) > budget) jLong = Math.sign(jLong) * budget;
        }
        const mag = Math.hypot(jLong, jLat / side);
        w.slip = maxJ > 0 ? Math.min(1, mag / maxJ) : 1;
        if (mag > maxJ && mag > 0) {
          jLong *= maxJ / mag;
          jLat *= maxJ / mag;
        }
      }
      if (locked || (w.steered && this.rearLocked)) {
        // In a slide the drag (rear and front) goes in line with the bike's centre of mass: applied at the
        // leaned-over contact patch, it would twist the bike out of the turn. Sideways friction stays put.
        const off = _v.subVectors(contact, _com).dot(_lat);
        const inLine = _p.copy(contact).addScaledVector(_lat, -off);
        body.applyImpulseAtPoint(toR(_imp.copy(_wf).multiplyScalar(jLong)), toR(inLine), true);
        body.applyImpulseAtPoint(toR(_imp.copy(_lat).multiplyScalar(jLat)), toR(contact), true);
      } else {
        _imp.copy(_wf).multiplyScalar(jLong).addScaledVector(_lat, jLat);
        body.applyImpulseAtPoint(toR(_imp), toR(contact), true);
      }

      if (!locked) w.spin += (vLong / WHEEL_RADIUS) * dt;
      if (!w.steered) this.tailOut = Math.abs(vLong) > 1 ? Math.atan2(vLat, Math.abs(vLong)) : 0;
      const washing = w.sliding && Math.atan2(Math.abs(vLat), Math.abs(vLong)) > WASH_OUT_ANGLE;
      if (w.steered) this.frontWash = washing ? this.frontWash + dt : 0;
    }
    if (!this.wheels[1].grounded) this.tailOut = 0;
    if (this.realistic && !this.assist && !this.crashed && absSpeed > 4) {
      const roll = -Math.asin(THREE.MathUtils.clamp(_right.y, -1, 1));
      if (Math.abs(this.tailOut) > SPIN_OUT) this.crash('spun out');
      else if (this.frontWash > WASH_OUT_TIME && Math.abs(roll) > 0.3) this.crash('washed out the front');
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
    const k = this.assist ? EASY_FORGIVENESS : 1;
    if (impact > CRASH_IMPACT * k && !this.cannonLanding) this.crash('cased it');
    else if (w.steered && pitch < -CRASH_NOSE_DOWN * k) this.crash('over the bars');
    else if (!w.steered && pitch > CRASH_LOOPED * k) this.crash('looped out');
    else if (Math.abs(roll) > CRASH_LANDING_ROLL * k) this.crash('landed sideways');
  }

  /**
   * Easy: the slope (radians, + uphill along the heading) where the bike will come down, from its
   * flight path. Falls back to the flight angle if it can't see the ground.
   */
  private landingSlope() {
    const t = this.body.translation();
    const flight = Math.atan2(_linv.y, Math.hypot(_linv.x, _linv.z));
    const h = this.groundHeight;
    if (!h) return flight * 0.5;
    let x = t.x, y = t.y, z = t.z;
    for (let i = 0; i < 60; i++) {
      const dt = 0.05, ti = i * dt;
      x = t.x + _linv.x * ti;
      z = t.z + _linv.z * ti;
      y = t.y + _linv.y * ti - 0.5 * GRAVITY * ti * ti;
      if (y - 0.45 < h(x, z)) break;
    }
    const len = Math.hypot(_fwd.x, _fwd.z) || 1;
    const dx = _fwd.x / len, dz = _fwd.z / len;
    const slope = Math.atan2(h(x + dx, z + dz) - h(x - dx, z - dz), 2);
    return THREE.MathUtils.clamp(slope, -0.6, 0.5);
  }

  /**
   * Easy: a rider's instinctive weight shift. Into the turn with the bike; forward when driving hard
   * from low speed or up a steep climb (front down) and back under braking; centred in the air, where the bike lines
   * itself up for the landing.
   */
  private updateAutoLean(c: Controls, roll: number, speed: number) {
    if (!this.grounded) {
      this.autoLean.set(0, 0);
      return;
    }
    const side = THREE.MathUtils.clamp(roll / MAX_LEAN, -1, 1) * 0.35;
    const drive = c.throttle * (1 - THREE.MathUtils.smoothstep(speed, 6, 14)) * 0.35;
    // Up a steep wall, right over the bars to keep the front down.
    const climb = c.throttle * THREE.MathUtils.smoothstep(_fwd.y, Math.sin(0.3), Math.sin(0.7));
    this.autoLean.set(side, THREE.MathUtils.clamp(Math.max(drive, climb) - c.brake * 0.4, -1, 1));
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
    const limit = this.assist ? 0.1 : 0.18 + 0.27 * Math.max(0, -this.lean.y);
    const feather = 1 - 0.9 * THREE.MathUtils.smoothstep(this.wheelieAngle, limit, limit + 0.2);
    // Easy: traction control eases the drive as the rear tyre reaches its grip limit.
    const traction = this.assist ? 1 - 0.5 * THREE.MathUtils.smoothstep(this.wheels[1].slip, 0.85, 1) : 1;
    const f = (torqueAt(this.spec, this.curve, this.rpm) * c.throttle * feather * traction * this.gearRatio * 0.9) / WHEEL_RADIUS;
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

    // Shift on road speed, not engine revs: wheelspin and clutch slip rev the engine, which would
    // hold a tall gear while the bike bogs down on a climb.
    if (this.autoShift && this.shiftCooldown === 0 && rear.grounded) {
      const roadRpm = (Math.abs(this.speed) / WHEEL_RADIUS) * (30 / Math.PI) * this.gearRatio;
      if (roadRpm > this.spec.shiftUp && this.gear < GEARS.length - 1) this.shift(1);
      else if (roadRpm < this.spec.shiftDown && this.gear > 0) this.shift(-1);
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
      // Easy: never ask for the last quarter of the tyres' grip; full lock on a keyboard stays safe.
      const tyreLean = this.realistic ? REAL_MAX_LEAN : MAX_LEAN;
      const maxLean = this.assist ? tyreLean * EASY_LEAN : tyreLean;
      const desired = THREE.MathUtils.clamp(turnLean + this.lean.x * 0.2, -maxLean, maxLean);
      // A rider can't throw the bike over instantly; snapping the target makes the wheels skip.
      const rate = this.realistic ? REAL_LEAN_RATE / (1 + Math.abs(this.speed) / 20) : LEAN_RATE;
      this.leanTarget += THREE.MathUtils.clamp(desired - this.leanTarget, -rate * dt, rate * dt);
      const target = this.leanTarget;
      if (this.realistic) torque.addScaledVector(_fwd, INERTIA.z * (LEAN_KP * (target - roll) - LEAN_KD * rollRate));
      // Rear locked: the rider holds the slide, the back end out of the turn by a set angle (turning
      // right, it kicks out left), rather than letting it spin or snap back.
      if (this.rearLocked && Math.abs(this.speed) > 2) {
        const vx = _linv.x, vz = _linv.z;
        const fl = Math.hypot(_fwd.x, _fwd.z) || 1;
        const fx = _fwd.x / fl, fz = _fwd.z / fl;
        const slide = Math.atan2(vx * fz - vz * fx, vx * fx + vz * fz); // + = nose right of travel
        const target = Math.sign(roll || this.requestedSteer) * (this.assist ? EASY_SLIDE : SLIDE_ANGLE);
        const rate = this.slidePrev === null ? 0 : (slide - this.slidePrev) / dt;
        this.slidePrev = slide;
        torque.addScaledVector(_up, -INERTIA.y * (SLIDE_KP * (target - slide) - SLIDE_KD * rate));
      } else {
        this.slidePrev = null;
      }
      // Realistic power slide: the physics sets the angle (more throttle, more slide); the rider damps
      // it and, past what countersteer can hold, fights it back.
      if (this.realistic && !this.rearLocked && Math.abs(this.speed) > 3) {
        const max = this.assist ? EASY_POWERSLIDE_MAX : POWERSLIDE_MAX;
        const over = this.tailOut - THREE.MathUtils.clamp(this.tailOut, -max, max);
        const rate = (this.tailOut - this.tailOutPrev) / dt;
        const held = THREE.MathUtils.smoothstep(Math.abs(this.tailOut), 0.05, 0.2);
        torque.addScaledVector(_up, -INERTIA.y * (SLIDE_KP * over + 4 * held * rate));
      }
      // Classic: the back end may step out to help the bike round, but never far enough to spin it.
      if (!this.realistic && !this.rearLocked && Math.abs(this.speed) > 2 && this.wheels[0].grounded && this.wheels[1].grounded) {
        const over = this.tailOut - THREE.MathUtils.clamp(this.tailOut, -TAIL_FREE, TAIL_FREE);
        const rate = (this.tailOut - this.tailOutPrev) / dt;
        if (over !== 0) torque.addScaledVector(_up, -INERTIA.y * (CLASSIC_TRACK_KP * over + CLASSIC_TRACK_KD * rate));
      }
      this.tailOutPrev = this.tailOut;
      // Easy: at walking pace (stalled on a face, rolling back) the rider dabs a foot and holds it up.
      if (this.assist && this.realistic) {
        const slow = 1 - THREE.MathUtils.smoothstep(Math.abs(this.speed), 1.5, 4);
        if (slow > 0) torque.addScaledVector(_fwd, -INERTIA.z * slow * (60 * roll + 10 * rollRate));
      }
      // A firm stop past the tyres' limit: the rider won't let it fold over.
      const over = Math.abs(roll) - tyreLean - 0.12;
      if (this.realistic && over > 0) torque.addScaledVector(_fwd, -Math.sign(roll) * INERTIA.z * 400 * over);
      // Wheelie control: past a point the rider pulls the nose back down, unless leaning back for it.
      const nose = this.wheelieAngle;
      const limit = this.assist ? 0.08 : 0.12 + 0.32 * Math.max(0, -this.lean.y) - 0.06 * Math.max(0, this.lean.y);
      if (nose > limit) torque.addScaledVector(_right, -INERTIA.x * (70 * (nose - limit) + 6 * Math.max(0, pitchRate)));
    } else if (this.assist) {
      this.leanTarget = roll;
      // Easy: the bike flies itself to land on both wheels, matched to the slope it will land on, and
      // stays upright. The rider's lean still nudges it (for stunts and style).
      const pitch = Math.asin(THREE.MathUtils.clamp(_fwd.y, -1, 1));
      const target = this.landingSlope() + 0.35 * -this.lean.y;
      torque.addScaledVector(_right, INERTIA.x * (14 * (target - pitch) - 5 * pitchRate));
      torque.addScaledVector(_fwd, INERTIA.z * (4 * this.lean.x - 10 * roll - 4 * rollRate));
      const yawRate = _angv.dot(_up);
      torque.addScaledVector(_up, -INERTIA.y * (5 * yawRate + 1.5 * c.steer));
      const fx = _fwd.x, fz = _fwd.z, vx = _linv.x, vz = _linv.z;
      if (vx * vx + vz * vz > 25 && fx * fx + fz * fz > 0.1) {
        torque.addScaledVector(_up, INERTIA.y * 3 * Math.atan2(fz * vx - fx * vz, fx * vx + fz * vz));
      }
    } else {
      this.leanTarget = roll;
      // Mid-air: weight shift pitches and rolls the bike; throttle/brake torque the rear wheel.
      // Realistic: the spinning rear wheel is the main control, revving it lifts the nose and a dab of
      // rear brake drops it; body English does less, and nothing lines the bike up for you.
      const real = this.realistic;
      const gyro = real ? c.throttle * 0.9 - c.brake * 1.8 : (c.throttle - c.brake) * 0.5;
      torque.addScaledVector(_right, INERTIA.x * ((real ? -4 : -5) * this.lean.y + gyro - 1.2 * pitchRate));
      torque.addScaledVector(_fwd, INERTIA.z * (5 * this.lean.x - (real ? 1.5 : 3) * roll - 2 * rollRate));
      torque.addScaledVector(_up, -INERTIA.y * (real ? 1.2 : 2.5) * c.steer);
      // Spinning wheels and the rider keep the bike pointing where it's going: damp yaw, and turn the
      // nose gently towards the direction of travel.
      const yawRate = _angv.dot(_up);
      torque.addScaledVector(_up, -INERTIA.y * 3 * yawRate);
      const fx = _fwd.x, fz = _fwd.z, vx = _linv.x, vz = _linv.z;
      if (vx * vx + vz * vz > 25 && fx * fx + fz * fz > 0.1) {
        const off = Math.atan2(fz * vx - fx * vz, fx * vx + fz * vz); // + = travelling to the left of the nose
        torque.addScaledVector(_up, INERTIA.y * (real ? 1.5 : 2.5) * off);
      }
      // A gentle pull that lines the bike up with its flight path, like a rider instinctively would.
      if (v2 > 25) {
        const align = _v.crossVectors(_fwd, _linv).divideScalar(Math.sqrt(v2)).dot(_right);
        torque.addScaledVector(_right, INERTIA.x * (real ? 1.6 : 2.5) * align * (1 - Math.abs(this.lean.y)));
      }
    }
    // Split between bike and rider: the rider moves the bike with their body, and pushing only on
    // the light bike makes the controller overshoot from one physics step to the next.
    torque.multiplyScalar(dt * 0.5);
    body.applyTorqueImpulse(toR(torque), true);
    this.rider.body.applyTorqueImpulse(toR(torque), true);
    if (this.grounded && !this.realistic && this.onItsWheels()) this.setClassicLean(roll, dt);
  }

  /** Classic, as in the original: the lean isn't balanced, it's set. Steering asks for a lean that grows
   * with speed (full lean from about 10 mph), and the bike rolls straight to it at up to 120 degrees/s. */
  private setClassicLean(roll: number, dt: number) {
    const body = this.body;
    const share = this.steerShare;
    let want = share * CLASSIC_LEAN_PER_FTS * Math.abs(this.speed) * 3.281;
    if (share !== 0 && Math.abs(want) < CLASSIC_MIN_LEAN * Math.abs(share)) want = CLASSIC_MIN_LEAN * share;
    const maxLean = this.assist ? MAX_LEAN * EASY_LEAN : MAX_LEAN;
    want = THREE.MathUtils.clamp(want + this.lean.x * 0.2, -maxLean, maxLean);
    this.leanTarget = roll + THREE.MathUtils.clamp(want - roll, -LEAN_RATE * dt, LEAN_RATE * dt);
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _qInv.setFromAxisAngle(_fwd, this.leanTarget - roll);
    _q.premultiply(_qInv);
    body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    const av = body.angvel();
    _angv.set(av.x, av.y, av.z);
    _angv.addScaledVector(_fwd, -_angv.dot(_fwd));
    body.setAngvel(toR(_angv), true);
  }

  /** Riding on the ground rather than stood on one wheel (an endo, a big wheelie): nothing holds it up then. */
  private onItsWheels() {
    const w = this.wheels[0].grounded ? this.wheels[0] : this.wheels[1];
    return Math.abs(_fwd.dot(w.surfaceNormal)) < CLASSIC_LEAN_MAX_PITCH;
  }

  /** Classic sideways grip of the front or rear tyre (as a friction coefficient). */
  private sideMu(front: boolean) {
    if (this.assist) return front ? EASY_FRONT_SIDE_MU : EASY_REAR_SIDE_MU;
    return front ? FRONT_SIDE_MU : REAR_SIDE_MU;
  }
}
