// Steady turns at several speeds: the bike should lean in and hold the turn without falling.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Bike } from '../src/bike.ts';
import type { Controls } from '../src/input.ts';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;
// Flat ground, big enough for a 45 mph circle.
world.createCollider(RAPIER.ColliderDesc.heightfield(4, 4, new Float32Array(25), { x: 1000, y: 1, z: 1000 }));
const spawn = new THREE.Vector3(0, 1, 0);
const bike = new Bike(world, spawn, 0);
const base: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
const roll = () => {
  const r = bike.body.rotation();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  return -Math.asin(right.y) * 57.3;
};
for (const mph of [10, 20, 30, 45, 60]) {
  bike.reset(spawn, 0);
  for (let i = 0; i < 60; i++) { bike.step(base, 1 / 120); world.step(); }
  const v = mph / 2.237;
  bike.body.setLinvel({ x: 0, y: 0, z: -v }, true);
  bike.rider.snapTo(bike.body);
  let maxRoll = 0, fell = false;
  for (let i = 0; i < 3 * 120; i++) {
    // Hold speed roughly with throttle so the test isolates cornering; steer ramps in like the keyboard.
    const c = { ...base, steer: Math.min(1, (i / 120) * 3.5), throttle: Math.min(1, Math.max(0, (v - bike.speed) * 0.5)) };
    bike.step(c, 1 / 120);
    world.step();
    maxRoll = Math.max(maxRoll, Math.abs(roll()));
    if (Math.abs(roll()) > 75) fell = true;
  }
  console.log(`${mph} mph full lock: max lean ${maxRoll.toFixed(0)} deg, now ${roll().toFixed(0)} deg, speed ${(bike.speed * 2.237).toFixed(0)} mph, yaw ${bike.yaw.toFixed(2)}${fell ? '  FELL' : ''}`);
}

// Pulling away from a standstill on full lock with part throttle.
bike.reset(spawn, 0);
for (let i = 0; i < 60; i++) { bike.step(base, 1 / 120); world.step(); }
let fellFromStop = false, maxLeanStop = 0;
for (let i = 0; i < 4 * 120; i++) {
  bike.step({ ...base, steer: Math.min(1, (i / 120) * 3.5), throttle: 0.6 }, 1 / 120);
  world.step();
  maxLeanStop = Math.max(maxLeanStop, Math.abs(roll()));
  if (Math.abs(roll()) > 75) fellFromStop = true;
}
console.log(`standstill, part throttle, full lock: max lean ${maxLeanStop.toFixed(0)} deg, speed ${(bike.speed * 2.237).toFixed(0)} mph${fellFromStop ? '  FELL' : ''}`);
