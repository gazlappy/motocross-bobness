import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RiderPose, RiderProportions } from './riderPose.ts';

// The rigged "Low-poly Motocross Character" (see CREDITS.md), a Mixamo skeleton. Each frame its
// bones are aimed at the pose's joints, so the same code shows the rider riding and ragdolling.

/** Overall size: the source is ~2 m to the helmet top; this makes the rider about 1.7 m. */
const SCALE = 0.85;

const BONES = {
  hips: 'Hips', spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2', neck: 'Neck', head: 'Head',
  upLegL: 'LeftUpLeg', legL: 'LeftLeg', footL: 'LeftFoot',
  upLegR: 'RightUpLeg', legR: 'RightLeg', footR: 'RightFoot',
  armL: 'LeftArm', foreArmL: 'LeftForeArm', handL: 'LeftHand',
  armR: 'RightArm', foreArmR: 'RightForeArm', handR: 'RightHand',
} as const;
type BoneKey = keyof typeof BONES;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();

/**
 * The rider comes as five skinned meshes on one skeleton, one per plain colour. Bake the colours
 * into the vertices and draw them as one mesh: a field of eight riders then skins and draws once
 * each instead of five times.
 */
function mergeParts(model: THREE.Object3D) {
  const parts: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  const [first] = parts;
  if (parts.length < 2) return;
  const fits = parts.every((p) =>
    p.parent === first.parent && p.matrix.equals(first.matrix) && p.bindMatrix.equals(first.bindMatrix) &&
    !Array.isArray(p.material) && !(p.material as THREE.MeshStandardMaterial).map &&
    p.skeleton.bones.length === first.skeleton.bones.length && p.skeleton.bones.every((b, i) => b === first.skeleton.bones[i]));
  if (!fits) return;
  const geometry = mergeGeometries(parts.map((p) => {
    const g = p.geometry.clone();
    const { r, g: green, b } = (p.material as THREE.MeshStandardMaterial).color;
    const colours = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colours.length; i += 3) colours.set([r, green, b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return g;
  }));
  if (!geometry) return;
  const material = (first.material as THREE.MeshStandardMaterial).clone();
  material.color.set(0xffffff);
  material.vertexColors = true;
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = first.name;
  mesh.position.copy(first.position);
  mesh.quaternion.copy(first.quaternion);
  mesh.scale.copy(first.scale);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  first.parent!.add(mesh);
  mesh.bind(first.skeleton, first.bindMatrix);
  for (const p of parts) p.removeFromParent();
}

export class GltfRiderModel {
  readonly root = new THREE.Group();
  readonly proportions: RiderProportions;
  private bones = {} as Record<BoneKey, THREE.Bone>;
  private bindLocal = new Map<THREE.Bone, THREE.Quaternion>();
  private bindWorld = new Map<THREE.Bone, THREE.Quaternion>();
  /** Hips bone position relative to the midpoint of the hip joints, in rider space at bind. */
  private hipsFromHipCentre = new THREE.Vector3();

  /**
   * @param model the rider's scene (clone it with SkeletonUtils for each extra rider)
   * @param tint recolours the red parts of the kit, for team colours
   */
  constructor(model: THREE.Object3D, tint?: THREE.ColorRepresentation) {
    const team = tint === undefined ? null : new THREE.Color(tint);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (team && mesh.isMesh) {
        const recolour = (m: THREE.Material) => {
          const c = (m as THREE.MeshStandardMaterial).color;
          if (!c || !(c.r > 0.12 && c.r > 4 * Math.max(c.g, c.b))) return m; // the red parts of the kit
          const copy = m.clone() as THREE.MeshStandardMaterial;
          copy.color.copy(team);
          return copy;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolour) : recolour(mesh.material);
      }
      if ((o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned bounds are from the bind pose, not where the bones are
      }
      if ((o as THREE.Bone).isBone) {
        // Mixamo names come through as "mixamorig:Hips_01" or "mixamorigHips_01".
        const base = o.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, '');
        for (const [key, name] of Object.entries(BONES)) if (base === name) this.bones[key as BoneKey] = o as THREE.Bone;
      }
    });
    mergeParts(model);
    for (const key of Object.keys(BONES) as BoneKey[]) {
      if (!this.bones[key]) throw new Error(`rider skeleton is missing bone ${BONES[key]}`);
    }
    this.root.add(model);
    model.scale.setScalar(SCALE);
    model.updateMatrixWorld(true);

    // Turn the model to face the game's forward (-Z) with +X on its right, standing at the origin.
    const pos = (k: BoneKey) => this.bones[k].getWorldPosition(new THREE.Vector3());
    const right = pos('upLegR').sub(pos('upLegL')).normalize();
    const up = pos('neck').sub(pos('hips'));
    up.addScaledVector(right, -up.dot(right)).normalize();
    const back = new THREE.Vector3().crossVectors(right, up);
    const facing = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
    model.quaternion.premultiply(facing.invert());
    model.updateMatrixWorld(true);

    for (const bone of Object.values(this.bones)) {
      this.bindLocal.set(bone, bone.quaternion.clone());
      this.bindWorld.set(bone, bone.getWorldQuaternion(new THREE.Quaternion()));
    }
    const hipCentre = pos('upLegL').add(pos('upLegR')).multiplyScalar(0.5);
    this.hipsFromHipCentre.copy(pos('hips')).sub(hipCentre);
    const shoulderCentre = pos('armL').add(pos('armR')).multiplyScalar(0.5);
    this.proportions = {
      thigh: pos('upLegL').distanceTo(pos('legL')),
      shin: pos('legL').distanceTo(pos('footL')),
      upperArm: pos('armL').distanceTo(pos('foreArmL')),
      foreArm: pos('foreArmL').distanceTo(pos('handL')),
      halfHips: pos('upLegL').distanceTo(pos('upLegR')) / 2,
      halfShoulders: pos('armL').distanceTo(pos('armR')) / 2,
      torso: hipCentre.distanceTo(shoulderCentre),
      neck: shoulderCentre.distanceTo(pos('head')),
    };
  }

  setPose(p: RiderPose) {
    const b = this.bones;

    // Hips: place and orient from the torso frame (across the hips, up towards the shoulders).
    const hipC = _a.addVectors(p.hipL, p.hipR).multiplyScalar(0.5);
    const shoulderC = _b.addVectors(p.shoulderL, p.shoulderR).multiplyScalar(0.5);
    _right.subVectors(p.hipR, p.hipL).normalize();
    _up.subVectors(shoulderC, hipC);
    _up.addScaledVector(_right, -_up.dot(_right)).normalize();
    _back.crossVectors(_right, _up);
    const torso = _q.setFromRotationMatrix(_m.makeBasis(_right, _up, _back));
    const hipsWorld = _c.copy(this.hipsFromHipCentre).applyQuaternion(torso).add(hipC);
    b.hips.position.copy(b.hips.parent!.worldToLocal(hipsWorld));
    this.setWorldRotation(b.hips, _q2.copy(torso).multiply(this.bindWorld.get(b.hips)!));

    this.aim(b.spine, b.spine1, shoulderC);
    this.aim(b.spine1, b.spine2, shoulderC);
    this.rest(b.spine2);
    this.aim(b.neck, b.head, p.head);
    this.setWorldRotation(b.head, _q2.copy(p.headRot).multiply(this.bindWorld.get(b.head)!));

    this.aim(b.upLegL, b.legL, p.kneeL);
    this.aim(b.legL, b.footL, p.footL);
    this.rest(b.footL);
    this.aim(b.upLegR, b.legR, p.kneeR);
    this.aim(b.legR, b.footR, p.footR);
    this.rest(b.footR);
    this.aim(b.armL, b.foreArmL, p.elbowL);
    this.aim(b.foreArmL, b.handL, p.handL);
    this.rest(b.handL);
    this.aim(b.armR, b.foreArmR, p.elbowR);
    this.aim(b.foreArmR, b.handR, p.handR);
    this.rest(b.handR);
  }

  private rest(bone: THREE.Bone) {
    bone.quaternion.copy(this.bindLocal.get(bone)!);
  }

  /** Swing `bone` (from its bind rotation) so its child joint points at `target`. */
  private aim(bone: THREE.Bone, child: THREE.Bone, target: THREE.Vector3) {
    this.rest(bone);
    bone.updateWorldMatrix(true, false);
    child.updateWorldMatrix(false, false);
    const joint = bone.getWorldPosition(new THREE.Vector3());
    const cur = child.getWorldPosition(new THREE.Vector3()).sub(joint);
    const want = target.clone().sub(joint);
    if (cur.lengthSq() < 1e-10 || want.lengthSq() < 1e-10) return;
    const swing = new THREE.Quaternion().setFromUnitVectors(cur.normalize(), want.normalize());
    this.setWorldRotation(bone, swing.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
  }

  private setWorldRotation(bone: THREE.Bone, world: THREE.Quaternion) {
    const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentWorld.invert().multiply(world));
    bone.updateWorldMatrix(false, false);
  }
}
