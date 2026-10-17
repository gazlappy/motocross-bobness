// Headless smoke test for the bike sim: settle, accelerate down the straight, then turn.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { generateHeightmap, sampleHeight } from '../src/heightmap.ts';
import { Bike } from '../src/bike.ts';
import type { Controls } from '../src/input.ts';

await RAPIER.init();
const hm = generateHeightmap();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;
const { rapierHeights } = await import('../src/heightmap.ts');
world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }).setFriction(0.9));
const spawn = new THREE.Vector3(0, sampleHeight(hm, 0, 20) + 1, 20);
const bike = new Bike(world, spawn, 0);

const idle: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
function run(seconds: number, c: Controls, label: string, every = 1) {
  let maxAir = 0;
  for (let i = 0; i < seconds * 120; i++) {
    bike.step(c, 1 / 120);
    world.step();
    maxAir = Math.max(maxAir, bike.airTime);
    if (i % (120 * every) === 119) {
      const t = bike.body.translation();
      const r = bike.body.rotation();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      console.log(`${label} t=${((i + 1) / 120).toFixed(1)}s pos=(${t.x.toFixed(1)},${(t.y - sampleHeight(hm, t.x, t.z)).toFixed(2)}agl,${t.z.toFixed(1)}) v=${(bike.speed * 2.237).toFixed(0)}mph gear=${bike.gear + 1} rpm=${bike.rpm.toFixed(0)} upY=${up.y.toFixed(2)} yaw=${bike.yaw.toFixed(2)} comp=${bike.wheels.map(w => w.compression.toFixed(2)).join('/')}`);
    }
  }
  console.log(`${label} max air time ${maxAir.toFixed(2)}s`);
}
run(2, idle, 'settle');
run(10, { ...idle, throttle: 1 }, 'full gas');
run(3, { ...idle, throttle: 0.6, steer: 1 }, 'turn right');
run(3, { ...idle, brake: 1 }, 'brake');
