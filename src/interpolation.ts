import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

// Physics runs at a fixed 120 Hz but the screen refreshes at whatever rate it likes (60, 75, 144 Hz
// or an uneven mix). Drawing the latest step as-is makes moving bikes judder, so for drawing we put
// every body part way between its previous and current step, then put it back before physics runs.

type Pose = { t: RAPIER.Vector; r: RAPIER.Rotation };

/** Bodies that moved further than this in one step were teleported (respawn): don't smear them. */
const TELEPORT = 3;

const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();

export class PoseInterpolator {
  private world: RAPIER.World;
  private prev = new Map<number, Pose>();
  private saved: { body: RAPIER.RigidBody; pose: Pose }[] = [];

  constructor(world: RAPIER.World) {
    this.world = world;
  }

  /** Call before each physics step: remember where every moving body is. */
  record() {
    this.prev.clear();
    this.world.forEachRigidBody((b) => {
      if (b.isDynamic()) this.prev.set(b.handle, { t: b.translation(), r: b.rotation() });
    });
  }

  /** Move every body `alpha` of the way from its previous step towards its current one, for drawing. */
  apply(alpha: number) {
    this.world.forEachRigidBody((b) => {
      const p = this.prev.get(b.handle);
      if (!p || !b.isDynamic()) return;
      const t = b.translation(), r = b.rotation();
      if (Math.hypot(t.x - p.t.x, t.y - p.t.y, t.z - p.t.z) > TELEPORT) return;
      this.saved.push({ body: b, pose: { t, r } });
      b.setTranslation({ x: p.t.x + (t.x - p.t.x) * alpha, y: p.t.y + (t.y - p.t.y) * alpha, z: p.t.z + (t.z - p.t.z) * alpha }, false);
      _a.set(p.r.x, p.r.y, p.r.z, p.r.w).slerp(_b.set(r.x, r.y, r.z, r.w), alpha);
      b.setRotation(_a, false);
    });
  }

  /** Put every body back where physics left it. */
  restore() {
    for (const { body, pose } of this.saved) {
      body.setTranslation(pose.t, false);
      body.setRotation(pose.r, false);
    }
    this.saved.length = 0;
  }

  /** A new game: forget the old bodies. */
  clear() {
    this.prev.clear();
    this.saved.length = 0;
  }
}
