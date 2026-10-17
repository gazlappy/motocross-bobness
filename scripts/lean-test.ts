// Checks rider weight shift: launch wheelie with lean forward/neutral/back, and air pitch control.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { generateHeightmap, sampleHeight, rapierHeights } from '../src/heightmap.ts';
import { Bike } from '../src/bike.ts';
import type { Controls } from '../src/input.ts';

await RAPIER.init();
const hm = generateHeightmap();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;
world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
const spawn = new THREE.Vector3(0, sampleHeight(hm, 0, 20) + 1, 20);
const bike = new Bike(world, spawn, 0);
const base: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };

function pitch() {
  const r = bike.body.rotation();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  return Math.asin(f.y) * 57.3;
}
function run(seconds: number, c: Controls) {
  let maxPitch = -99, minPitch = 99;
  for (let i = 0; i < seconds * 120; i++) {
    bike.step(c, 1 / 120);
    world.step();
    maxPitch = Math.max(maxPitch, pitch());
    minPitch = Math.min(minPitch, pitch());
  }
  return { maxPitch, minPitch };
}
for (const lean of [1, 0, -1]) {
  bike.reset(spawn, 0);
  run(1, base);
  const r = run(2, { ...base, throttle: 1, leanForward: lean });
  console.log(`launch lean=${lean}: max nose-up ${r.maxPitch.toFixed(0)} deg, speed ${(bike.speed * 2.237).toFixed(0)} mph`);
}
for (const lean of [0, 1, -1]) {
  bike.reset(spawn.clone().setY(spawn.y + 30), 0);
  bike.body.setLinvel({ x: 0, y: 8, z: -15 }, true);
  bike.rider.snapTo(bike.body);
  const r = run(1.2, { ...base, leanForward: lean });
  console.log(`air lean=${lean}: pitch range ${r.minPitch.toFixed(0)}..${r.maxPitch.toFixed(0)} deg, end ${pitch().toFixed(0)}`);
}
