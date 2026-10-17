import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BikeView } from './bike.ts';
import type { BikeColour } from './gltfBikeModel.ts';
import { type BikeMounts, createMounts } from './riderPose.ts';

// "(FREE) Honda CRF 450" by Jacobdesigns (see CREDITS.md). It comes rigged: bones for the steering
// head, the fork slider, the swingarm and both wheels, plus hand and foot attach points. Physics
// drives those bones. The plastics are Honda red; other colours are made by hue-shifting them.

const WHEEL_RADIUS = 0.34; // physics wheel
const WHEELBASE = 1.48; // physics wheel attach points, front z -0.82 to rear z 0.66
const AXLE_MID_Z = (-0.82 + 0.66) / 2;
/** Axle height in bike space at rest: attach y 0.12 less the sagged suspension (~0.14 m). */
const AXLE_REST_Y = 0.12 - (0.42 + WHEEL_RADIUS - 0.142 - WHEEL_RADIUS);

/** How each colour is made from the red plastics (canvas filters). */
const RECOLOUR: Record<BikeColour, string> = {
  red: 'none',
  orange: 'hue-rotate(28deg) saturate(1.2)',
  yellow: 'hue-rotate(52deg) saturate(1.25) brightness(1.25)',
  green: 'hue-rotate(115deg) brightness(0.9)',
  blue: 'hue-rotate(218deg) brightness(1.05)',
  white: 'saturate(0) brightness(2.1)',
  black: 'saturate(0) brightness(0.4)',
};
/** Materials that carry the red plastics. */
const PLASTICS = ['hondared', 'fenders', 'shrouds', 'numberplates', 'seat', 'forkguard'];

const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

const recoloured = new Map<string, THREE.Texture>();

function recolourTexture(tex: THREE.Texture, colour: BikeColour, id: string) {
  const cacheKey = `${colour}:${id}`;
  let out = recoloured.get(cacheKey);
  if (!out) {
    const img = tex.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.filter = RECOLOUR[colour];
    ctx.drawImage(img, 0, 0);
    out = new THREE.CanvasTexture(canvas);
    out.colorSpace = tex.colorSpace;
    out.flipY = tex.flipY;
    out.wrapS = tex.wrapS;
    out.wrapT = tex.wrapT;
    out.channel = tex.channel;
    recoloured.set(cacheKey, out);
  }
  return out;
}

function recolourColor(c: THREE.Color, colour: BikeColour) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.filter = RECOLOUR[colour];
  ctx.fillStyle = `#${c.getHexString(THREE.SRGBColorSpace)}`;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

/** Bones that move independently; everything else is the frame. */
const MOVING = ['frontsteer', 'frontsusattatch', 'frontwheeldef', 'susrear', 'rearwheeldef'];

const prepared = new WeakMap<GLTF, THREE.Object3D>();

/**
 * The model with its 81 parts merged into one mesh per material for each moving piece (frame, bars,
 * fork slider, front wheel, swingarm, rear wheel), so a field of eight bikes stays cheap to draw.
 * Done once per file; every bike clones the result.
 */
function prepare(gltf: GLTF) {
  let template = prepared.get(gltf);
  if (template) return template;
  template = cloneSkinned(gltf.scene);
  template.updateMatrixWorld(true);
  const owners: THREE.Object3D[] = [];
  template.traverse((o) => {
    if (MOVING.includes(key(o.name))) owners.push(o);
  });
  const ownerOf = (o: THREE.Object3D) => {
    for (let p = o.parent; p; p = p.parent) if (owners.includes(p)) return p;
    return template!;
  };
  const batches = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
  const merged: THREE.Mesh[] = [];
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material)) return;
    const owner = ownerOf(mesh);
    const toOwner = owner.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    let byMaterial = batches.get(owner);
    if (!byMaterial) batches.set(owner, (byMaterial = new Map()));
    const list = byMaterial.get(mesh.material) ?? [];
    list.push(mesh.geometry.clone().applyMatrix4(toOwner));
    byMaterial.set(mesh.material, list);
    merged.push(mesh);
  });
  for (const mesh of merged) mesh.removeFromParent();
  for (const [owner, byMaterial] of batches) {
    for (const [material, list] of byMaterial) {
      // Merging needs matching attributes and indexing throughout.
      const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => n in g.attributes));
      const indexed = list.every((g) => g.index);
      const ready = list.map((g) => {
        const out = indexed ? g : g.toNonIndexed();
        for (const n of Object.keys(out.attributes)) if (!names.includes(n)) out.deleteAttribute(n);
        out.morphAttributes = {};
        return out;
      });
      const geometry = mergeGeometries(ready);
      if (!geometry) continue;
      owner.add(new THREE.Mesh(geometry, material));
    }
  }
  prepared.set(gltf, template);
  return template;
}

/** A bone turned about a bike-space axis through its own origin. */
class Pivot {
  readonly bone: THREE.Object3D;
  private rest: THREE.Quaternion;
  private axis = new THREE.Vector3(); // in the bone's parent space
  private q = new THREE.Quaternion();

  constructor(bone: THREE.Object3D, bikeAxis: THREE.Vector3, bikeSpace: THREE.Object3D) {
    this.bone = bone;
    this.rest = bone.quaternion.clone();
    const parentRot = new THREE.Quaternion();
    bikeSpace.updateMatrixWorld(true);
    const rel = bikeSpace.matrixWorld.clone().invert().multiply(bone.parent!.matrixWorld);
    rel.decompose(new THREE.Vector3(), parentRot, new THREE.Vector3());
    this.axis.copy(bikeAxis).applyQuaternion(parentRot.invert()).normalize();
  }

  set(angle: number) {
    this.bone.quaternion.copy(this.q.setFromAxisAngle(this.axis, angle)).multiply(this.rest);
  }
}

export class HondaBikeModel {
  readonly root = new THREE.Group();
  private steer: Pivot;
  private swingarm: Pivot;
  private frontSpin: Pivot;
  private rearSpin: Pivot;
  private slider: THREE.Object3D;
  private sliderRest = new THREE.Vector3();
  /** One metre of fork travel (towards the steering head), in the slider's parent space. */
  private sliderPerMetre = new THREE.Vector3();
  private forkLift = 1; // metres of axle rise per metre of fork travel
  private pivot = new THREE.Vector3(); // swingarm pivot, bike space
  private armLength = 0;
  private swingRestAngle = 0;
  private swingSign = 1;
  private gripsLocal: [THREE.Vector3, THREE.Vector3];
  private pegs: [THREE.Vector3, THREE.Vector3];
  private steerBone: THREE.Object3D;
  private mountsOut = createMounts();

  constructor(gltf: GLTF, colour: BikeColour = 'red') {
    const model = cloneSkinned(prepare(gltf));
    const bone = (name: string) => {
      let found: THREE.Object3D | undefined;
      model.traverse((o) => {
        if (!found && key(o.name) === name) found = o;
      });
      if (!found) throw new Error(`bike bone "${name}" not found`);
      return found;
    };
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      if (colour !== 'red') {
        const recolour = (m: THREE.Material) => {
          const std = m as THREE.MeshStandardMaterial;
          if (!PLASTICS.includes(key(std.name))) return m;
          const copy = std.clone();
          if (std.map) copy.map = recolourTexture(std.map, colour, std.uuid);
          else copy.color = recolourColor(std.color, colour);
          return copy;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolour) : recolour(mesh.material);
      }
    });

    // Fit the model to the physics bike: axles on the physics wheels, facing -Z.
    model.updateMatrixWorld(true);
    const worldOf = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const frontAxle = worldOf(bone('frontwheeldef'));
    const rearAxle = worldOf(bone('rearwheeldef'));
    const forward = frontAxle.clone().sub(rearAxle);
    const fit = new THREE.Group();
    fit.scale.setScalar(WHEELBASE / forward.length());
    fit.quaternion.setFromUnitVectors(new THREE.Vector3(forward.x, 0, forward.z).normalize(), new THREE.Vector3(0, 0, -1));
    const mid = frontAxle.clone().add(rearAxle).multiplyScalar(0.5).applyQuaternion(fit.quaternion).multiplyScalar(fit.scale.x);
    fit.position.set(-mid.x, AXLE_REST_Y - mid.y, AXLE_MID_Z - mid.z);
    fit.add(model);
    this.root.add(fit);
    this.root.updateMatrixWorld(true);
    const bikePos = (o: THREE.Object3D) => this.root.worldToLocal(worldOf(o));

    // Steering: the bars turn about the head tube, from the steering head down to the front axle.
    this.steerBone = bone('frontsteer');
    const head = bikePos(this.steerBone);
    const axle = bikePos(bone('frontwheeldef'));
    const down = axle.clone().sub(head).normalize();
    this.steer = new Pivot(this.steerBone, down.clone().negate(), this.root);

    // Fork: the slider (lowers + wheel) runs along the same axis.
    this.slider = bone('frontsusattatch');
    this.sliderRest.copy(this.slider.position);
    const parent = this.slider.parent!;
    const at = worldOf(this.slider);
    const toward = at.clone().add(down.clone().negate().transformDirection(this.root.matrixWorld).multiplyScalar(1));
    this.sliderPerMetre.copy(parent.worldToLocal(toward.clone())).sub(parent.worldToLocal(at.clone()));
    this.forkLift = Math.abs(down.y);

    // Swingarm: turns about its pivot across the bike.
    const arm = bone('susrear');
    this.swingarm = new Pivot(arm, new THREE.Vector3(1, 0, 0), this.root);
    this.pivot.copy(bikePos(arm));
    const rear = bikePos(bone('rearwheeldef'));
    this.armLength = Math.hypot(rear.y - this.pivot.y, rear.z - this.pivot.z);
    this.swingRestAngle = Math.atan2(rear.y - this.pivot.y, rear.z - this.pivot.z);
    this.swingarm.set(0.1);
    this.root.updateMatrixWorld(true);
    this.swingSign = bikePos(bone('rearwheeldef')).y > rear.y ? 1 : -1;
    this.swingarm.set(0);

    // Wheels spin about their axles.
    this.frontSpin = new Pivot(bone('frontwheeldef'), new THREE.Vector3(1, 0, 0), this.root);
    this.rearSpin = new Pivot(bone('rearwheeldef'), new THREE.Vector3(1, 0, 0), this.root);

    // The rig's own attach points: hands turn with the bars, feet stay on the frame.
    this.root.updateMatrixWorld(true);
    const byX = (a: THREE.Vector3, b: THREE.Vector3): [THREE.Vector3, THREE.Vector3] => (a.x < b.x ? [a, b] : [b, a]);
    const hands = byX(bikePos(bone('handsnapl')), bikePos(bone('handsnapr')));
    this.gripsLocal = hands.map((h) => this.steerBone.worldToLocal(this.root.localToWorld(h.clone()))) as [THREE.Vector3, THREE.Vector3];
    this.pegs = byX(bikePos(bone('footatchl')), bikePos(bone('footatchr')));
  }

  /** Where the rider's hands and feet go, in bike space, for the current steering angle. */
  mounts(): BikeMounts {
    this.root.updateMatrixWorld(true);
    const m = this.mountsOut;
    const toBike = (local: THREE.Vector3, out: THREE.Vector3) => this.root.worldToLocal(this.steerBone.localToWorld(out.copy(local)));
    toBike(this.gripsLocal[0], m.gripL);
    toBike(this.gripsLocal[1], m.gripR);
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

    this.steer.set(-bike.steerAngle);
    const travel = (wheelY(front) - AXLE_REST_Y) / this.forkLift;
    this.slider.position.copy(this.sliderRest).addScaledVector(this.sliderPerMetre, travel);

    const sin = THREE.MathUtils.clamp((wheelY(rear) - this.pivot.y) / this.armLength, -1, 1);
    const angle = Math.atan2(sin, Math.sqrt(1 - sin * sin));
    this.swingarm.set(this.swingSign * (angle - this.swingRestAngle));

    this.frontSpin.set(-front.spin);
    this.rearSpin.set(-rear.spin);
  }
}
