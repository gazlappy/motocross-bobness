import * as THREE from 'three';
import type { Bike } from './bike.ts';
import { type Heightmap, sampleHeight } from './heightmap.ts';

export type CameraMode = 'chase' | 'far' | 'helmet' | 'thrill';
const MODES: CameraMode[] = ['chase', 'far', 'helmet', 'thrill'];

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class CameraRig {
  mode: CameraMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private heading = 0;
  private initialised = false;
  private spot = new THREE.Vector3();
  private spotTime = 0;
  private spotSide = 1;
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

    if (this.mode === 'thrill') {
      this.updateThrill(bike, dt);
      return;
    }

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

  /**
   * Thrill Cam: a trackside camera placed ahead of the bike that zooms to follow it, cutting to a
   * new spot when the bike gets far away, passes behind it, or a hill blocks the view.
   */
  private updateThrill(bike: Bike, dt: number) {
    const t = bike.body.translation();
    _target.set(t.x, t.y + 0.7, t.z);
    this.spotTime += dt;
    const dist = this.spot.distanceTo(_target);
    if (!this.initialised || dist > 60 || this.spotTime > 7 || (this.spotTime > 1 && this.occluded(this.spot, _target))) {
      this.pickSpot(bike);
      this.look.copy(_target);
      this.initialised = true;
    }
    this.look.lerp(_target, 1 - Math.exp(-dt * 10));
    this.camera.position.copy(this.spot);
    this.camera.lookAt(this.look);
    const d = Math.max(4, this.spot.distanceTo(_target));
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(4.5 / d)), 14, 65);
    this.camera.updateProjectionMatrix();
  }

  private pickSpot(bike: Bike) {
    const v = bike.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    const dir = speed > 2 ? new THREE.Vector3(v.x, 0, v.z).normalize() : new THREE.Vector3(-Math.sin(bike.yaw), 0, -Math.cos(bike.yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const half = this.hm.size / 2 - 20;
    for (let attempt = 0; attempt < 8; attempt++) {
      this.spotSide = -this.spotSide;
      const ahead = THREE.MathUtils.clamp(speed * 1.8, 12, 45) * (1 - attempt * 0.08);
      const lateral = (7 + Math.random() * 9) * this.spotSide;
      this.spot.copy(_target).addScaledVector(dir, ahead).addScaledVector(side, lateral);
      this.spot.x = THREE.MathUtils.clamp(this.spot.x, -half, half);
      this.spot.z = THREE.MathUtils.clamp(this.spot.z, -half, half);
      const airborne = !bike.grounded;
      this.spot.y = sampleHeight(this.hm, this.spot.x, this.spot.z) + (airborne ? 0.6 : 1.2 + Math.random() * 3);
      if (!this.occluded(this.spot, _target)) break;
    }
    this.spotTime = 0;
  }

  /** True when terrain blocks the straight line between two points. */
  private occluded(a: THREE.Vector3, b: THREE.Vector3) {
    for (let i = 1; i < 12; i++) {
      const k = i / 12;
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
      if (sampleHeight(this.hm, x, z) > y + 0.3) return true;
    }
    return false;
  }
}
