// The bowl walls round the outdoor maps can be ridden up with a run-up in classic handling (the rear
// tyre digs in on steep climbs; realistic tyres can't hold slopes this steep). Full throttle straight
// out from 100 m inside the wall's foot at twelve spots round Nationals should mostly make the flats.
// Usage: node scripts/wall-climb-test.ts [run-up m] [bikes, e.g. 125,450f] [realistic]
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Bike } from '../src/bike.ts';
import { EDGE_PLATEAU, nationalsTerrain, rapierHeights, sampleHeight } from '../src/heightmap.ts';
import { BIKES, type BikeId } from '../src/bikes.ts';
import { nationalsGround } from '../src/venues/nationals.ts';

await RAPIER.init();
const DT = 1 / 120;
const idle = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };
const hm = nationalsGround().hm;
const half = hm.size / 2;
const foot = half - EDGE_PLATEAU - nationalsTerrain().edgeWall!.width; // where the wall starts rising
const RUN_UP = Number(process.argv[2] ?? 100);
/** Climbs out of twelve each case must make: Advanced riders here never shift their weight. */
const NEEDED = { easy: 10, advanced: 6 };
let failed = 0;

/** Ride from just inside the wall's foot straight out towards the edge; true if the bike makes the flats. */
function climb(realistic: boolean, assist: boolean, along: number, side: 0 | 1 | 2 | 3, bikeId: BikeId) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
  // side: 0 = +x, 1 = -x, 2 = +z, 3 = -z. Start 30 m inside the foot, facing out.
  const out = [new THREE.Vector2(1, 0), new THREE.Vector2(-1, 0), new THREE.Vector2(0, 1), new THREE.Vector2(0, -1)][side];
  const x = side < 2 ? out.x * (foot - RUN_UP) : along;
  const z = side < 2 ? along : out.y * (foot - RUN_UP);
  const yaw = Math.atan2(-out.x, -out.y);
  const bike = new Bike(world, new THREE.Vector3(x, sampleHeight(hm, x, z) + 1, z), yaw, BIKES[bikeId]);
  bike.realistic = realistic;
  bike.assist = assist;
  bike.groundHeight = (px, pz) => sampleHeight(hm, px, pz);
  for (let i = 0; i < 60; i++) {
    bike.step(idle, DT);
    world.step();
  }
  for (let i = 0; i < 25 / DT; i++) {
    // Keep pointing straight out, as a player would.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(bike.body.rotation() as THREE.Quaternion);
    const steer = THREE.MathUtils.clamp((fwd.x * out.y - fwd.z * out.x) * 3, -1, 1);
    bike.step({ ...idle, throttle: 1, steer }, DT);
    world.step();
    const t = bike.body.translation();
    const edge = half - Math.max(Math.abs(t.x), Math.abs(t.z));
    if (edge < EDGE_PLATEAU - 5) return { made: true, crash: null };
    if (bike.crashCause) return { made: false, crash: bike.crashCause };
  }
  return { made: false, crash: 'stalled' };
}

const bikes = (process.argv[3]?.split(',') ?? ['250f', '450f']) as BikeId[];
for (const bikeId of bikes) for (const realistic of process.argv[4] === 'realistic' ? [true] : [false]) {
  for (const assist of [false, true]) {
    const name = `${bikeId} ${realistic ? 'Realistic' : 'Classic'} ${assist ? 'Easy' : 'Advanced'}`;
    let made = 0, tries = 0;
    const why: string[] = [];
    for (const side of [0, 1, 2, 3] as const) {
      for (const along of [-150, 0, 150]) {
        const r = climb(realistic, assist, along, side, bikeId);
        tries++;
        if (r.made) made++;
        else why.push(`${'+x -x +z -z'.split(' ')[side]}@${along}: ${r.crash}`);
      }
    }
    const ok = made >= NEEDED[assist ? 'easy' : 'advanced'];
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: climbed onto the flats ${made}/${tries}${why.length ? ` (${why.join(', ')})` : ''}`);
  }
}

console.log(failed ? `\n${failed} wall check(s) FAILED` : '\nAll wall checks passed.');
if (failed) process.exit(1);
