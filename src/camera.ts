import * as THREE from 'three';
import type { Bike } from './bike.ts';
import { type Heightmap, sampleHeight } from './heightmap.ts';

export type CameraMode = 'chase' | 'far' | 'helmet';
const MODES: CameraMode[] = ['chase', 'far', 'helmet'];

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class CameraRig {
  mode: CameraMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private heading = 0;
  private initialised = false;
  readonly camera: THREE.PerspectiveCamera;
  private hm: Heightmap;

  constructor(camera: THREE.PerspectiveCamera, hm: Heightmap) {
    this.camera = camera;
    this.hm = hm;
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.initialised = false;
  }

  update(bike: Bike, dt: number) {
    const t = bike.body.translation();
    const r = bike.body.rotation();
    _target.set(t.x, t.y, t.z);

    if (this.mode === 'helmet') {
      _q.set(r.x, r.y, r.z, r.w);
      const eye = new THREE.Vector3(0, 1.38, -0.2).applyQuaternion(_q).add(_target);
      this.camera.position.copy(eye);
      this.camera.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.12));
      this.camera.fov = 80;
      this.camera.updateProjectionMatrix();
      return;
    }

    // Follow heading only (not roll/pitch) so flips and crashes stay readable.
    const vel = bike.body.linvel();
    const flatSpeed = Math.hypot(vel.x, vel.z);
    const yaw = bike.yaw;
    if (!this.initialised) this.heading = yaw;
    let dh = yaw - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * Math.min(1, dt * (bike.grounded ? 4 : 1.2));

    const far = this.mode === 'far';
    const dist = (far ? 9 : 5.2) + Math.min(flatSpeed, 30) * 0.05;
    const height = far ? 3.6 : 2.0;
    _desired.set(
      _target.x + Math.sin(this.heading) * dist,
      _target.y + height,
      _target.z + Math.cos(this.heading) * dist,
    );
    const ground = sampleHeight(this.hm, _desired.x, _desired.z) + 0.8;
    if (_desired.y < ground) _desired.y = ground;

    if (!this.initialised) {
      this.pos.copy(_desired);
      this.look.copy(_target);
      this.initialised = true;
    }
    const k = 1 - Math.exp(-dt * 7);
    this.pos.lerp(_desired, k);
    this.look.lerp(_target.add(new THREE.Vector3(0, 0.8, 0)), 1 - Math.exp(-dt * 14));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.fov = 62 + Math.min(flatSpeed, 35) * 0.25;
    this.camera.updateProjectionMatrix();
  }
}
