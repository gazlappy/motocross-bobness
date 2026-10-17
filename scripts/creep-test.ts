// The bike should sit still on flat ground with no input.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { generateHeightmap, sampleHeight, rapierHeights } from '../src/heightmap.ts';
import { Bike } from '../src/bike.ts';
await RAPIER.init();
const hm = generateHeightmap();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;
world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
const bike = new Bike(world, new THREE.Vector3(0, sampleHeight(hm, 0, 20) + 1, 20), 0);
const idle = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
for (let i = 1; i <= 6 * 120; i++) {
  bike.step(idle, 1 / 120);
  world.step();
  if (i % 120 === 0) console.log(`t=${i / 120}s z=${bike.body.translation().z.toFixed(3)} v=${bike.speed.toFixed(3)} m/s`);
}
