// Brake hard mid-turn: the rear should lock and step out of the turn (turning right, the back end
// kicks out left) without throwing the rider; a gentle brake shouldn't slide at all. Classic
// slides too, but never spins round. Flat ground.
// Usage: node scripts/brake-slide-test.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Bike } from '../src/bike.ts';
import type { Controls } from '../src/input.ts';

await RAPIER.init();
const DT = 1 / 120;
let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};

/** Angle from the direction of travel to where the nose points, degrees: + = nose right of travel. */
function noseVsTravel(bike: Bike) {
  const r = bike.body.rotation(), v = bike.body.linvel();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  const vel = new THREE.Vector3(v.x, 0, v.z).normalize();
  f.y = 0;
  f.normalize();
  // Turning right from above is clockwise; nose clockwise of travel = to its right.
  return THREE.MathUtils.radToDeg(Math.atan2(vel.x * f.z - vel.z * f.x, vel.dot(f)));
}

function run(assist: boolean, brake: number, steer: number, realistic = true) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(4, 4, new Float32Array(25), { x: 2000, y: 1, z: 2000 }));
  const bike = new Bike(world, new THREE.Vector3(0, 1, 600), 0);
  bike.assist = assist;
  bike.realistic = realistic;
  const idle: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
  for (let i = 0; i < 60; i++) { bike.step(idle, DT); world.step(); }
  bike.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
  bike.rider.snapTo(bike.body);
  // Hold speed into a steady right turn.
  for (let i = 0; i < 1.6 / DT; i++) {
    bike.step({ ...idle, steer, throttle: Math.max(0, Math.min(1, (15 - bike.speed) * 0.5)) }, DT);
    world.step();
  }
  const before = noseVsTravel(bike);
  let maxOut = 0, minOut = 0, locked = 0;
  for (let i = 0; i < 1.2 / DT; i++) {
    bike.step({ ...idle, steer, brake }, DT);
    world.step();
    maxOut = Math.max(maxOut, noseVsTravel(bike) - before);
    minOut = Math.min(minOut, noseVsTravel(bike) - before);
    if (bike.rearLocked) locked++;
  }
  const r = bike.body.rotation();
  const upright = 1 - 2 * (r.x * r.x + r.z * r.z);
  return { before, maxOut, minOut, lockedFor: locked * DT, crashed: bike.crashCause ?? bike.crashed, upright, speed: bike.speed };
}

for (const assist of [false, true]) {
  const name = assist ? 'Easy' : 'Advanced';
  const hard = run(assist, 1, 0.6);
  console.log(`${name} hard brake turning right: rear locked ${hard.lockedFor.toFixed(2)} s, nose swung ${hard.maxOut.toFixed(1)} deg right of travel, speed after ${hard.speed.toFixed(1)} m/s, upright ${hard.upright.toFixed(2)}, crash ${hard.crashed}`);
  check(hard.lockedFor > 0.3, `${name}: a hard brake locks the rear`);
  check(hard.maxOut > 6, `${name}: turning right, the back end kicks out left (nose swings right of travel)`);
  check(!hard.crashed && hard.upright > 0.6, `${name}: the slide doesn't throw the rider`);
  const left = run(assist, 1, -0.6);
  check(left.minOut < -6 && !left.crashed, `${name}: turning left, the back end kicks out right (nose ${left.minOut.toFixed(1)} deg)`);
  check(hard.maxOut < 60, `${name}: the slide is held, not a spin (${hard.maxOut.toFixed(1)} deg)`);
  const soft = run(assist, 0.5, 0.6);
  check(soft.lockedFor === 0 && soft.maxOut < 4, `${name}: a gentle brake doesn't slide (swing ${soft.maxOut.toFixed(1)} deg)`);
  const classic = run(assist, 1, 0.6, false);
  check(classic.maxOut > 6 && classic.maxOut < 60 && !classic.crashed, `Classic ${name}: a hard brake mid-turn slides without spinning round (swing ${classic.maxOut.toFixed(1)} deg)`);
}

console.log(failed ? `\n${failed} brake check(s) FAILED` : '\nAll brake checks passed.');
if (failed) process.exit(1);
