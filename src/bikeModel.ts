import * as THREE from 'three';
import type { Bike } from './bike.ts';
import { RIDER_POINTS } from './rider.ts';

// Placeholder bike + rider built from primitives. Swap for a glTF model once one is chosen.

const PLASTIC = new THREE.MeshLambertMaterial({ color: 0xd8261c });
const PLASTIC_WHITE = new THREE.MeshLambertMaterial({ color: 0xf2efe6 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
const METAL = new THREE.MeshLambertMaterial({ color: 0x9a9ca3 });
const TYRE = new THREE.MeshLambertMaterial({ color: 0x151515 });
const JERSEY = new THREE.MeshLambertMaterial({ color: 0x1f5fd1 });
const PANTS = new THREE.MeshLambertMaterial({ color: 0xe8e2d4 });
const HELMET = new THREE.MeshLambertMaterial({ color: 0xffc21a });
const SKIN = new THREE.MeshLambertMaterial({ color: 0x222222 });

const WHEEL_RADIUS = 0.34;
const HEAD_TUBE = new THREE.Vector3(0, 0.62, -0.5);
const RAKE = 0.47;
const SWINGARM_PIVOT = new THREE.Vector3(0, 0.12, 0.05);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();
const _riderPos = new THREE.Vector3();
const _riderRot = new THREE.Quaternion();
const _KNEE_L = new THREE.Vector3(-0.3, 0, -1);
const _KNEE_R = new THREE.Vector3(0.3, 0, -1);
const _ELBOW_L = new THREE.Vector3(-1, 0.2, 0.4);
const _ELBOW_R = new THREE.Vector3(1, 0.2, 0.4);

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function makeWheel() {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS - 0.06, 0.065, 8, 20), TYRE);
  tyre.rotation.y = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS - 0.11, 0.015, 4, 20), METAL);
  rim.rotation.y = Math.PI / 2;
  g.add(rim);
  for (let i = 0; i < 6; i++) {
    const spoke = box(0.012, (WHEEL_RADIUS - 0.11) * 2, 0.012, METAL);
    spoke.rotation.x = (i / 6) * Math.PI;
    g.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8), METAL);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  // Spin happens on this inner group so the outer one can steer.
  const outer = new THREE.Group();
  outer.add(g);
  return { outer, spin: g };
}

/** A box stretched between two points, used for the rider's limbs and the forks. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, thickness: number, mat: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, 1), mat);
    this.mesh.castShadow = true;
    parent.add(this.mesh);
  }
  set(a: THREE.Vector3, b: THREE.Vector3) {
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    this.mesh.scale.z = Math.max(0.01, len);
    if (len > 1e-4) this.mesh.quaternion.setFromUnitVectors(Z_AXIS, _dir.subVectors(b, a).divideScalar(len));
  }
}

export class BikeModel {
  readonly root = new THREE.Group();
  private frontWheel = makeWheel();
  private rearWheel = makeWheel();
  private steer = new THREE.Group();
  private swingarm: Limb;
  private forks: Limb[];
  private rider = new THREE.Group();
  private limbs: Record<string, Limb> = {};
  private head: THREE.Mesh;
  private torso: Limb;

  constructor() {
    const r = this.root;
    r.add(box(0.1, 0.12, 0.85, DARK, 0, 0.42, -0.05)); // frame spine
    r.add(box(0.26, 0.3, 0.34, METAL, 0, 0.12, -0.12)); // engine
    r.add(box(0.34, 0.2, 0.42, PLASTIC, 0, 0.5, -0.28)); // tank + shrouds
    r.add(box(0.24, 0.08, 0.72, DARK, 0, 0.6, 0.12)); // seat
    r.add(box(0.36, 0.22, 0.3, PLASTIC_WHITE, 0, 0.42, 0.28)); // side panels
    const fender = box(0.18, 0.03, 0.55, PLASTIC, 0, 0.62, 0.62);
    fender.rotation.x = -0.25;
    r.add(fender);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.7, 8), METAL);
    pipe.rotation.x = Math.PI / 2 - 0.3;
    pipe.position.set(0.16, 0.45, 0.4);
    r.add(pipe);

    // Steering head: tilt by rake, then steer around the tilted axis.
    const head = new THREE.Group();
    head.position.copy(HEAD_TUBE);
    head.rotation.x = RAKE;
    r.add(head);
    head.add(this.steer);
    const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.78, 6), DARK);
    bars.rotation.z = Math.PI / 2;
    bars.position.set(0, 0.2, 0.05);
    this.steer.add(bars);
    this.steer.add(box(0.26, 0.06, 0.08, METAL, 0, 0.08, 0)); // triple clamp
    const plate = box(0.26, 0.22, 0.02, PLASTIC_WHITE, 0, 0.0, -0.12);
    plate.rotation.x = 0.2;
    this.steer.add(plate);

    this.forks = [new Limb(r, 0.05, METAL), new Limb(r, 0.05, METAL)];
    this.swingarm = new Limb(r, 0.07, METAL);
    const frontFender = box(0.16, 0.03, 0.42, PLASTIC_WHITE);
    this.frontWheel.outer.add(frontFender);
    frontFender.position.set(0, WHEEL_RADIUS + 0.06, 0);

    r.add(this.frontWheel.outer, this.rearWheel.outer);

    // Rider.
    r.add(this.rider);
    const L = (name: string, t: number, mat: THREE.Material) => (this.limbs[name] = new Limb(this.rider, t, mat));
    L('thighL', 0.13, PANTS); L('thighR', 0.13, PANTS);
    L('shinL', 0.11, PANTS); L('shinR', 0.11, PANTS);
    L('upperArmL', 0.09, JERSEY); L('upperArmR', 0.09, JERSEY);
    L('foreArmL', 0.08, JERSEY); L('foreArmR', 0.08, JERSEY);
    this.torso = new Limb(this.rider, 0.3, JERSEY);
    this.torso.mesh.scale.x = 1.15;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), HELMET);
    this.head.castShadow = true;
    this.rider.add(this.head);
    const visor = box(0.2, 0.05, 0.14, SKIN, 0, 0.0, -0.13);
    this.head.add(visor);
  }

  update(bike: Bike) {
    const t = bike.body.translation();
    const q = bike.body.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(q.x, q.y, q.z, q.w);

    const [front, rear] = bike.wheels;
    const fPos = front.attach.clone().setY(front.attach.y - (front.rayLength - WHEEL_RADIUS));
    const rPos = rear.attach.clone().setY(rear.attach.y - (rear.rayLength - WHEEL_RADIUS));
    this.frontWheel.outer.position.copy(fPos);
    this.frontWheel.outer.rotation.y = -bike.steerAngle;
    this.frontWheel.spin.rotation.x = -front.spin;
    this.rearWheel.outer.position.copy(rPos);
    this.rearWheel.spin.rotation.x = -rear.spin;
    this.steer.rotation.y = -bike.steerAngle;

    const clampTop = HEAD_TUBE.clone().add(new THREE.Vector3(0, 0.08, 0).applyEuler(new THREE.Euler(RAKE, 0, 0)));
    for (const [i, side] of [-0.09, 0.09].entries()) {
      this.forks[i].set(clampTop.clone().setX(side), fPos.clone().setX(side));
    }
    this.swingarm.set(SWINGARM_PIVOT, rPos);

    this.poseRider(bike);
  }

  private poseRider(bike: Bike) {
    // Hips, shoulders and head come from the rider's physics body; hands and feet stay on the bike.
    bike.rider.localPose(bike.body, _riderPos, _riderRot);
    const at = (p: THREE.Vector3, x = 0) => p.clone().setX(p.x + x).applyQuaternion(_riderRot).add(_riderPos);
    const hip = at(RIDER_POINTS.hip);
    const shoulder = at(RIDER_POINTS.shoulder);
    const hipL = at(RIDER_POINTS.hip, -0.11), hipR = at(RIDER_POINTS.hip, 0.11);
    const shL = at(RIDER_POINTS.shoulder, -0.19), shR = at(RIDER_POINTS.shoulder, 0.19);

    const steer = bike.steerAngle;
    const barL = new THREE.Vector3(-0.36, 0.84, -0.48 + steer * 0.3);
    const barR = new THREE.Vector3(0.36, 0.84, -0.48 - steer * 0.3);
    const pegL = new THREE.Vector3(-0.2, 0.2, 0.0);
    const pegR = new THREE.Vector3(0.2, 0.2, 0.0);

    const kL = bend(hipL, pegL, 0.46, _KNEE_L), kR = bend(hipR, pegR, 0.46, _KNEE_R);
    const eL = bend(shL, barL, 0.32, _ELBOW_L), eR = bend(shR, barR, 0.32, _ELBOW_R);
    this.limbs.thighL.set(hipL, kL); this.limbs.shinL.set(kL, pegL);
    this.limbs.thighR.set(hipR, kR); this.limbs.shinR.set(kR, pegR);
    this.limbs.upperArmL.set(shL, eL); this.limbs.foreArmL.set(eL, barL);
    this.limbs.upperArmR.set(shR, eR); this.limbs.foreArmR.set(eR, barR);
    this.torso.set(hip, shoulder);
    this.head.position.copy(at(RIDER_POINTS.head));
    this.head.quaternion.copy(_riderRot);
  }
}

/** Two-bone joint position: equal-length bones from `a` to `b`, bending towards `hint`. */
function bend(a: THREE.Vector3, b: THREE.Vector3, bone: number, hint: THREE.Vector3) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const ab = b.clone().sub(a);
  const half = ab.length() / 2;
  const out = hint.clone().addScaledVector(ab, -hint.dot(ab) / Math.max(1e-6, ab.lengthSq())).normalize();
  return mid.addScaledVector(out, Math.sqrt(Math.max(0, bone * bone - half * half)));
}
