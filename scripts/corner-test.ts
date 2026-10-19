// How quickly the bike turns: from straight, full lock (ramped in like the keyboard) holding speed,
// the time to turn 90 degrees and the steady cornering force. Classic should turn on its bars like
// the original, not only as hard as a 40-degree lean allows (0.84 g).
// Usage: node scripts/corner-test.ts [realistic] [easy] [gas]
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Bike } from '../src/bike.ts';
import type { Controls } from '../src/input.ts';

await RAPIER.init();
const DT = 1 / 120;
const realistic = process.argv.includes('realistic');
const easy = process.argv.includes('easy');
/** Hold the throttle wide open through the turn, as players do. */
const gas = process.argv.includes('gas');
const idle: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
const heading = (b: Bike) => {
  const v = b.body.linvel();
  return Math.atan2(-v.x, -v.z);
};

function corner(speed: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(4, 4, new Float32Array(25), { x: 2000, y: 1, z: 2000 }));
  const bike = new Bike(world, new THREE.Vector3(0, 1, 0), 0);
  bike.realistic = realistic;
  bike.assist = easy;
  for (let i = 0; i < 60; i++) {
    bike.step(idle, DT);
    world.step();
  }
  bike.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
  bike.rider.snapTo(bike.body);
  let turned = 0, prev = heading(bike), t90 = 0;
  for (let i = 1; i <= 4 / DT; i++) {
    bike.step({ ...idle, steer: Math.min(1, i * DT * 6), throttle: gas ? 1 : Math.max(0, Math.min(1, (speed - bike.speed) * 0.5)) }, DT);
    world.step();
    const h = heading(bike);
    turned += Math.abs(Math.atan2(Math.sin(h - prev), Math.cos(h - prev)));
    prev = h;
    if (!t90 && turned >= Math.PI / 2) t90 = i * DT;
    if (bike.crashCause) break;
  }
  const g = Math.abs(bike.speed * bike.body.angvel().y) / 9.81;
  return { t90, g, speed: bike.speed, crash: bike.crashCause };
}

/** A keyboard hairpin: brake key and steer key together, then gas, until the nose has turned 180. */
function hairpin(speed: number, brakeFor: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(4, 4, new Float32Array(25), { x: 2000, y: 1, z: 2000 }));
  const bike = new Bike(world, new THREE.Vector3(0, 1, 0), 0);
  bike.realistic = realistic;
  bike.assist = easy;
  for (let i = 0; i < 60; i++) {
    bike.step(idle, DT);
    world.step();
  }
  bike.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
  bike.rider.snapTo(bike.body);
  const nose = () => {
    const r = bike.body.rotation();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    return Math.atan2(-f.x, -f.z);
  };
  let turned = 0, prev = nose(), dist = 0, swing = 0, t = 0;
  for (; t < 6 && turned < Math.PI; t += DT) {
    const braking = t < brakeFor;
    bike.step({ ...idle, steer: Math.min(1, t * 6), brake: braking ? 1 : 0, throttle: braking ? 0 : 1 }, DT);
    world.step();
    const y = nose();
    turned += Math.abs(Math.atan2(Math.sin(y - prev), Math.cos(y - prev)));
    prev = y;
    const v = bike.body.linvel();
    dist += Math.hypot(v.x, v.z) * DT;
    swing = Math.max(swing, Math.abs(Math.atan2(Math.sin(y - heading(bike)), Math.cos(y - heading(bike)))));
  }
  return { t, dist, swing: THREE.MathUtils.radToDeg(swing), crash: bike.crashCause };
}

for (const mph of [10, 20, 30, 40, 50]) {
  const r = corner(mph / 2.237);
  console.log(`${mph} mph: 90 deg in ${r.t90.toFixed(2)} s, ${r.g.toFixed(2)} g, ends at ${(r.speed * 2.237).toFixed(0)} mph${r.crash ? `, crashed: ${r.crash}` : ''}`);
}
for (const [speed, brakeFor] of [[12, 0.6], [16, 0.9], [20, 1.2]]) {
  const r = hairpin(speed, brakeFor);
  console.log(`hairpin from ${speed} m/s (brake ${brakeFor} s, then gas): 180 deg in ${r.t.toFixed(2)} s over ${r.dist.toFixed(0)} m, tail out ${r.swing.toFixed(0)} deg at most${r.crash ? `, crashed: ${r.crash}` : ''}`);
}
