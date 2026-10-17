import * as THREE from 'three';
import type { BikeView } from './bike.ts';
import { Limb } from './limb.ts';

// Placeholder bike built from primitives. Swap for a glTF model once one is chosen.

const PLASTIC = new THREE.MeshLambertMaterial({ color: 0xd8261c });
const PLASTIC_WHITE = new THREE.MeshLambertMaterial({ color: 0xf2efe6 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
const METAL = new THREE.MeshLambertMaterial({ color: 0x9a9ca3 });
const TYRE = new THREE.MeshLambertMaterial({ color: 0x151515 });

const WHEEL_RADIUS = 0.34;
const HEAD_TUBE = new THREE.Vector3(0, 0.62, -0.5);
const RAKE = 0.47;
const SWINGARM_PIVOT = new THREE.Vector3(0, 0.12, 0.05);

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

export class BikeModel {
  readonly root = new THREE.Group();
  private frontWheel = makeWheel();
  private rearWheel = makeWheel();
  private steer = new THREE.Group();
  private swingarm: Limb;
  private forks: Limb[];

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
  }

  update(bike: BikeView) {
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

  }
}
