import * as THREE from 'three';
import { Limb } from './limb.ts';
import type { RiderPose } from './riderPose.ts';

// Placeholder rider built from boxes, drawn in world space from a RiderPose. A rigged glTF rider
// can replace this by implementing the same `setPose`.

const JERSEY = new THREE.MeshLambertMaterial({ color: 0x1f5fd1 });
const PANTS = new THREE.MeshLambertMaterial({ color: 0xe8e2d4 });
const HELMET = new THREE.MeshLambertMaterial({ color: 0xffc21a });
const VISOR = new THREE.MeshLambertMaterial({ color: 0x222222 });

const _hip = new THREE.Vector3();
const _shoulder = new THREE.Vector3();

export class RiderModel {
  readonly root = new THREE.Group();
  private limbs: Record<string, Limb> = {};
  private torso: Limb;
  private head: THREE.Mesh;

  constructor() {
    const L = (name: string, t: number, mat: THREE.Material) => (this.limbs[name] = new Limb(this.root, t, mat));
    L('thighL', 0.13, PANTS); L('thighR', 0.13, PANTS);
    L('shinL', 0.11, PANTS); L('shinR', 0.11, PANTS);
    L('upperArmL', 0.09, JERSEY); L('upperArmR', 0.09, JERSEY);
    L('foreArmL', 0.08, JERSEY); L('foreArmR', 0.08, JERSEY);
    this.torso = new Limb(this.root, 0.3, JERSEY);
    this.torso.mesh.scale.x = 1.15;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), HELMET);
    this.head.castShadow = true;
    this.root.add(this.head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.14), VISOR);
    visor.position.set(0, 0, -0.13);
    this.head.add(visor);
  }

  setPose(p: RiderPose) {
    const l = this.limbs;
    l.thighL.set(p.hipL, p.kneeL); l.shinL.set(p.kneeL, p.footL);
    l.thighR.set(p.hipR, p.kneeR); l.shinR.set(p.kneeR, p.footR);
    l.upperArmL.set(p.shoulderL, p.elbowL); l.foreArmL.set(p.elbowL, p.handL);
    l.upperArmR.set(p.shoulderR, p.elbowR); l.foreArmR.set(p.elbowR, p.handR);
    _hip.addVectors(p.hipL, p.hipR).multiplyScalar(0.5);
    _shoulder.addVectors(p.shoulderL, p.shoulderR).multiplyScalar(0.5);
    this.torso.set(_hip, _shoulder);
    this.head.position.copy(p.head);
    this.head.quaternion.copy(p.headRot);
  }
}
