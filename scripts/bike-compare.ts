// Drag race on flat ground: each bike's 0-60 mph time, 100 m time and top speed, plus a roll-on
// from 25 to 50 mph (driving out of a turn).
// Usage: node scripts/bike-compare.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Bike } from '../src/bike.ts';
import { BIKES, BIKE_IDS } from '../src/bikes.ts';

await RAPIER.init();
const DT = 1 / 120;
for (const id of BIKE_IDS) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(4, 4, new Float32Array(25), { x: 2000, y: 1, z: 2000 }));
  const bike = new Bike(world, new THREE.Vector3(0, 1, 900), 0, BIKES[id]);
  const idle = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
  for (let i = 0; i < 60; i++) { bike.step(idle, DT); world.step(); }
  const z0 = bike.body.translation().z;
  let t60 = NaN, t100m = NaN, top = 0;
  for (let i = 0; i < 25 / DT; i++) {
    // Lean forward a touch to keep the front down, as a rider would.
    bike.step({ ...idle, throttle: 1, leanForward: 0.5 }, DT);
    world.step();
    const t = i * DT;
    const mph = bike.speed * 2.237;
    top = Math.max(top, mph);
    if (isNaN(t60) && mph >= 60) t60 = t;
    if (isNaN(t100m) && z0 - bike.body.translation().z >= 100) t100m = t;
  }
  // Roll-on: slow to 25 mph in auto gear, then full throttle to 50.
  while (bike.speed * 2.237 > 25) { bike.step({ ...idle, brake: 0.6 }, DT); world.step(); }
  let roll = 0;
  while (bike.speed * 2.237 < 50 && roll < 15) { bike.step({ ...idle, throttle: 1, leanForward: 0.5 }, DT); world.step(); roll += DT; }
  console.log(`${BIKES[id].name.padEnd(18)} 0-60 mph ${t60.toFixed(2)} s | 100 m ${t100m.toFixed(2)} s | top ${top.toFixed(0)} mph | 25-50 mph ${roll.toFixed(2)} s`);
}
