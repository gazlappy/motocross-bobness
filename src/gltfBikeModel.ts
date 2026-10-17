import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BikeView } from './bike.ts';
import { type BikeMounts, createMounts } from './riderPose.ts';

// The "Mid poly dirt bike" model (see CREDITS.md). The file holds seven colour variants, each split
// into body, handlebars ("throttle") -> fork -> front wheel, swingarm -> rear wheel, and motor, so
// steering, both suspensions and wheel spin are animated from the physics.

export const BIKE_COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'black'] as const;
export type BikeColour = (typeof BIKE_COLOURS)[number];

const WHEEL_RADIUS = 0.34; // physics wheel
/** Lifts the model so its wheels sit where the physics wheels are at ride height. */
const MODEL_OFFSET_Y = 0.27;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class GltfBikeModel {
  readonly root = new THREE.Group();
  private throttle: THREE.Object3D;
  private fork: THREE.Object3D;
  private frontWheel: THREE.Object3D;
  private swingarm: THREE.Object3D;
  private rearWheel: THREE.Object3D;
  private steerAxis = new THREE.Vector3(); // in the handlebars' parent space
  private forkAxis = new THREE.Vector3(); // fork travel direction in the fork's parent space
  private forkRest = new THREE.Vector3();
  private forkTravelPerMetre = 1; // fork-space units per metre of wheel travel along bike Y
  private frontRestY = 0;
  private swingRestAngle = 0;
  private swingSign = 1;
  private pivot = new THREE.Vector3(); // swingarm pivot, bike space
  private armLength = 0;
  /** Grips in handlebar space (they turn with the bars) and pegs in bike space. */
  private gripsLocal: [THREE.Vector3, THREE.Vector3];
  private pegs: [THREE.Vector3, THREE.Vector3];
  private mountsOut = createMounts();

  constructor(gltf: GLTF, colour: BikeColour = 'red') {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    // Loaders tidy node names ("dirt_bike red" -> "dirt_bike_red"), so compare letters only.
    const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
    const found = findNode(scene, (o) => key(o.name) === `dirtbike${colour}`);
    if (!found) throw new Error(`bike colour "${colour}" not found in model`);

    // Copy the chosen variant out with its full world transform, minus its spot in the line-up.
    // (A copy, so the same colour can be used again by the next game.)
    const m = found.matrixWorld.clone();
    m.setPosition(0, MODEL_OFFSET_Y, 0);
    const variant = found.clone(true);
    m.decompose(variant.position, variant.quaternion, variant.scale);
    this.root.add(variant);
    variant.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });

    const part = (name: string) => {
      const o = variant.getObjectByProperty('name', name) ??
        variant.children.find((c) => c.name.startsWith(name)) ??
        findByPrefix(variant, name);
      if (!o) throw new Error(`bike part "${name}" not found`);
      return o;
    };
    this.throttle = part('throttle');
    this.fork = part('fork');
    this.frontWheel = part('front_wheel');
    this.swingarm = part('swingarm');
    this.rearWheel = part('rear_wheel');

    this.root.updateMatrixWorld(true);
    const bikePos = (o: THREE.Object3D) => this.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));

    // Steering turns the bars about the head-tube axis: from the bar pivot to the front axle.
    const head = bikePos(this.throttle);
    const axle = bikePos(this.frontWheel);
    const down = axle.clone().sub(head).normalize();
    this.steerAxis.copy(down).negate().transformDirection(inverseWorld(this.throttle.parent!, this.root));
    this.forkAxis.copy(down).transformDirection(inverseWorld(this.fork.parent!, this.root));
    this.forkRest.copy(this.fork.position);
    this.frontRestY = axle.y;
    const parentScale = this.fork.parent!.getWorldScale(new THREE.Vector3()).x / this.root.getWorldScale(new THREE.Vector3()).x;
    this.forkTravelPerMetre = 1 / (parentScale * Math.abs(down.y));

    // The swingarm swings about its pivot; work out which rotation sign lifts the wheel.
    this.pivot.copy(bikePos(this.swingarm));
    const rear = bikePos(this.rearWheel);
    this.armLength = Math.hypot(rear.y - this.pivot.y, rear.z - this.pivot.z);
    this.swingRestAngle = Math.atan2(rear.y - this.pivot.y, rear.z - this.pivot.z);
    this.swingarm.rotation.x += 0.1;
    this.root.updateMatrixWorld(true);
    this.swingSign = bikePos(this.rearWheel).y > rear.y ? 1 : -1;
    this.swingarm.rotation.x -= 0.1;
    this.root.updateMatrixWorld(true);

    // Grips: the outermost handlebar vertices, each side.
    const bars = meshVertices(this.throttle, this.root);
    const maxX = Math.max(...bars.map((v) => Math.abs(v.x)));
    const grip = (side: number) => average(bars.filter((v) => v.x * side > maxX - 0.08));
    const toBars = this.throttle.matrixWorld.clone().invert();
    this.gripsLocal = [grip(-1).applyMatrix4(toBars), grip(1).applyMatrix4(toBars)];

    // Pegs: the widest frame vertices low down, around the swingarm pivot.
    const low = meshVertices(variant, this.root, [this.throttle, this.swingarm]).filter(
      (v) => v.y < this.pivot.y + 0.06 && Math.abs(v.z - this.pivot.z) < 0.25,
    );
    const pegX = Math.max(...low.map((v) => Math.abs(v.x)));
    const peg = (side: number) => average(low.filter((v) => v.x * side > pegX - 0.04));
    this.pegs = [peg(-1), peg(1)];
  }

  /** Where the rider's hands and feet go, in bike space, for the current steering angle. */
  mounts(): BikeMounts {
    this.root.updateMatrixWorld(true);
    const toBike = this.root.matrixWorld.clone().invert().multiply(this.throttle.matrixWorld);
    const m = this.mountsOut;
    m.gripL.copy(this.gripsLocal[0]).applyMatrix4(toBike);
    m.gripR.copy(this.gripsLocal[1]).applyMatrix4(toBike);
    m.pegL.copy(this.pegs[0]);
    m.pegR.copy(this.pegs[1]);
    return m;
  }

  update(bike: BikeView) {
    const t = bike.body.translation(), q = bike.body.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(q.x, q.y, q.z, q.w);

    const [front, rear] = bike.wheels;
    const wheelY = (w: (typeof bike.wheels)[number]) => w.attach.y - (w.rayLength - WHEEL_RADIUS);

    this.throttle.quaternion.setFromAxisAngle(this.steerAxis, -bike.steerAngle);
    const travel = (this.frontRestY - wheelY(front)) * this.forkTravelPerMetre;
    this.fork.position.copy(this.forkRest).addScaledVector(this.forkAxis, travel);

    const sin = THREE.MathUtils.clamp((wheelY(rear) - this.pivot.y) / this.armLength, -1, 1);
    // atan2 of the arm's (y, z): rear-pointing arm, so z is positive.
    const angle = Math.atan2(sin, Math.sqrt(1 - sin * sin));
    this.swingarm.rotation.x = this.swingSign * (angle - this.swingRestAngle);

    this.frontWheel.rotation.x = -front.spin;
    this.rearWheel.rotation.x = -rear.spin;
  }
}

/** All vertex positions of the meshes under `obj`, in `space`, skipping subtrees in `skip`. */
function meshVertices(obj: THREE.Object3D, space: THREE.Object3D, skip: THREE.Object3D[] = []) {
  const toSpace = space.matrixWorld.clone().invert();
  const out: THREE.Vector3[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o !== obj && skip.includes(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const pos = mesh.geometry.getAttribute('position');
      const m = toSpace.clone().multiply(mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
    }
    for (const c of o.children) visit(c);
  };
  visit(obj);
  return out;
}

function average(vs: THREE.Vector3[]) {
  const sum = new THREE.Vector3();
  for (const v of vs) sum.add(v);
  return sum.divideScalar(Math.max(1, vs.length));
}

function findNode(root: THREE.Object3D, test: (o: THREE.Object3D) => boolean) {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && test(o)) found = o;
  });
  return found;
}

function findByPrefix(root: THREE.Object3D, prefix: string) {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && o.name.startsWith(prefix) && !(o as THREE.Mesh).isMesh) found = o;
  });
  return found;
}

/** Matrix taking directions in `space` (relative to `root`) back into `obj`-local directions. */
function inverseWorld(obj: THREE.Object3D, root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const rel = rootInv.multiply(obj.matrixWorld);
  rel.decompose(_v, _q, new THREE.Vector3());
  return new THREE.Matrix4().makeRotationFromQuaternion(_q.invert());
}
