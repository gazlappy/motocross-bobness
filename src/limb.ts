import * as THREE from 'three';

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();

/** A box stretched between two points, used for placeholder limbs, forks and swingarm. */
export class Limb {
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
