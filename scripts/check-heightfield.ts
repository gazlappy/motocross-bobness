// Verifies the Rapier heightfield collider matches our own height sampling.
import RAPIER from '@dimforge/rapier3d-compat';
import { generateHeightmap, rapierHeights, sampleHeight } from '../src/heightmap.ts';

await RAPIER.init();
const hm = generateHeightmap();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.createCollider(
  RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }),
);
world.step();
let maxErr = 0;
for (let i = 0; i < 400; i++) {
  const x = (Math.random() - 0.5) * hm.size * 0.95;
  const z = (Math.random() - 0.5) * hm.size * 0.95;
  const hit = world.castRay(new RAPIER.Ray({ x, y: 500, z }, { x: 0, y: -1, z: 0 }), 1000, true);
  const err = hit ? Math.abs(500 - hit.timeOfImpact - sampleHeight(hm, x, z)) : Infinity;
  maxErr = Math.max(maxErr, err);
}
console.log('max height error (m):', maxErr.toFixed(3), maxErr < 0.5 ? 'OK' : 'MISMATCH');
