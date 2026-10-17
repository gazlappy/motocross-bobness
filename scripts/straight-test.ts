// Cruise in a straight line on flat ground at a steady speed: both wheels should stay planted.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Bike } from '../src/bike.ts';
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;
world.createCollider(RAPIER.ColliderDesc.heightfield(4, 4, new Float32Array(25), { x: 1000, y: 1, z: 1000 }));
const bike = new Bike(world, new THREE.Vector3(0, 1, 300), 0);
const base = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
for (let i = 0; i < 60; i++) { bike.step(base, 1 / 120); world.step(); }
const v = 45 / 2.237;
bike.body.setLinvel({ x: 0, y: 0, z: -v }, true);
bike.rider.snapTo(bike.body);
for (let i = 0; i < 240; i++) {
  bike.step({ ...base, throttle: Math.min(1, Math.max(0, (v - bike.speed) * 0.5)) }, 1 / 120);
  world.step();
  if (i % 20 === 0) {
    const r = bike.body.rotation();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    console.log(`t=${(i / 120).toFixed(2)} v=${(bike.speed * 2.237).toFixed(1)}mph gear=${bike.gear + 1} rpm=${bike.rpm.toFixed(0)} pitch=${(Math.asin(f.y) * 57.3).toFixed(1)} comp=${bike.wheels.map(w => w.compression.toFixed(2))} y=${bike.body.translation().y.toFixed(2)}`);
  }
}
