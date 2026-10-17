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

/** Furthest the fork slider can travel up the tubes, metres. */
const FORK_MAX_TRAVEL = 0.28;

/** Each rider's colour: the same as their kit. Red keeps the model's own plastics. */
const TARGET: Record<BikeColour, number | null> = {
  red: null, orange: 0xf07a1a, yellow: 0xf2c418, green: 0x2f9e3a, blue: 0x1f5fd1, white: 0xe8e8e8, black: 0x2a2a2e,
};
/** Materials that carry the red plastics. */
const PLASTICS = ['hondared', 'fenders', 'shrouds', 'numberplates', 'seat', 'forkguard'];
/** HSL lightness of the Honda's plastic red: shading is measured relative to it. */
const RED_LIGHTNESS = 0.43;

const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How red a pixel is (0..1) and its shade relative to the plastic red. */
function redness(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = ((g - b) / (max - min)) * 60;
    else if (max === g) hue = ((b - r) / (max - min)) * 60 + 120;
    else hue = ((r - g) / (max - min)) * 60 + 240;
  }
  hue = ((hue % 360) + 360) % 360;
  const fromRed = Math.min(hue, 360 - hue);
  return { weight: smooth(0.25, 0.45, s) * (1 - smooth(18, 32, fromRed)), shade: Math.min(2.2, l / RED_LIGHTNESS) };
}

/** Per texture image: its pixels plus how red each one is, worked out once and reused for every colour. */
const masks = new WeakMap<object, { pixels: ImageData; weight: Float32Array; shade: Float32Array }>();

function redMask(img: CanvasImageSource & { width: number; height: number }) {
  let mask = masks.get(img);
  if (mask) return mask;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, img.width, img.height);
  const n = img.width * img.height;
  const weight = new Float32Array(n), shade = new Float32Array(n);
  const d = pixels.data;
  for (let i = 0; i < n; i++) {
    const r = redness(d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255);
    weight[i] = r.weight;
    shade[i] = r.shade;
  }
  mask = { pixels, weight, shade };
  masks.set(img, mask);
  return mask;
}

const recoloured = new Map<string, THREE.Texture>();

/** The texture with its red plastic swapped for the rider's colour, keeping the light and shade. */
function recolourTexture(tex: THREE.Texture, colour: BikeColour, id: string) {
  const cacheKey = `${colour}:${id}`;
  let out = recoloured.get(cacheKey);
  if (!out) {
    const { pixels, weight, shade } = redMask(tex.image as CanvasImageSource & { width: number; height: number });
    const hex = TARGET[colour]!; // sRGB, like the texture pixels
    const sr = (hex >> 16) & 255, sg = (hex >> 8) & 255, sb = hex & 255;
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(pixels.width, pixels.height);
    const src = pixels.data, dst = img.data;
    for (let i = 0; i < weight.length; i++) {
      const w = weight[i], k = shade[i], j = i * 4;
      dst[j] = src[j] + (Math.min(255, sr * k) - src[j]) * w;
      dst[j + 1] = src[j + 1] + (Math.min(255, sg * k) - src[j + 1]) * w;
      dst[j + 2] = src[j + 2] + (Math.min(255, sb * k) - src[j + 2]) * w;
      dst[j + 3] = src[j + 3];
    }
    ctx.putImageData(img, 0, 0);
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

/** A plain (untextured) red material colour, swapped the same way. */
function recolourColor(c: THREE.Color, colour: BikeColour) {
  const hex = c.getHex(THREE.SRGBColorSpace);
  const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => v / 255);
  const { weight, shade } = redness(r, g, b);
  const t = TARGET[colour]!;
  const mix = (orig: number, to: number) => orig + (Math.min(1, (to / 255) * shade) - orig) * weight;
  return new THREE.Color().setRGB(mix(r, (t >> 16) & 255), mix(g, (t >> 8) & 255), mix(b, t & 255), THREE.SRGBColorSpace);
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
    // The model's fork is built near full extension (the tubes barely overlap the fork guards), so
    // it can compress but not extend: in the air the wheel stays put rather than pulling apart.
    const travel = THREE.MathUtils.clamp((wheelY(front) - AXLE_REST_Y) / this.forkLift, 0, FORK_MAX_TRAVEL);
    this.slider.position.copy(this.sliderRest).addScaledVector(this.sliderPerMetre, travel);

    const sin = THREE.MathUtils.clamp((wheelY(rear) - this.pivot.y) / this.armLength, -1, 1);
    const angle = Math.atan2(sin, Math.sqrt(1 - sin * sin));
    this.swingarm.set(this.swingSign * (angle - this.swingRestAngle));

    this.frontSpin.set(-front.spin);
    this.rearSpin.set(-rear.spin);
  }
}
