// Classic vs realistic handling on flat ground: realistic should power-slide when you gas it mid-turn,
// hold back off the throttle (engine braking), and still corner and brake-slide without throwing you.
// Usage: node scripts/handling-test.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Bike } from '../src/bike.ts';
import type { Controls } from '../src/input.ts';
import { DEFAULT_TUNING, type EngineChoice, type Tuning } from '../src/tuning.ts';

await RAPIER.init();
const DT = 1 / 120;
let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};
const idle: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };

/** Angle from the direction of travel to where the nose points, degrees: + = nose right of travel. */
function noseVsTravel(bike: Bike) {
  const r = bike.body.rotation(), v = bike.body.linvel();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  const vel = new THREE.Vector3(v.x, 0, v.z).normalize();
  f.y = 0;
  f.normalize();
  return THREE.MathUtils.radToDeg(Math.atan2(vel.x * f.z - vel.z * f.x, vel.dot(f)));
}

function setup(realistic: boolean, assist: boolean, speed: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(4, 4, new Float32Array(25), { x: 2000, y: 1, z: 2000 }));
  const bike = new Bike(world, new THREE.Vector3(0, 1, 600), 0);
  bike.realistic = realistic;
  bike.assist = assist;
  for (let i = 0; i < 60; i++) {
    bike.step(idle, DT);
    world.step();
  }
  bike.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
  bike.rider.snapTo(bike.body);
  const run = (seconds: number, controls: (b: Bike) => Controls, each?: (b: Bike) => void) => {
    for (let i = 0; i < seconds / DT; i++) {
      bike.step(controls(bike), DT);
      world.step();
      each?.(bike);
    }
  };
  const hold = (v: number) => (b: Bike) => Math.max(0, Math.min(1, (v - b.speed) * 0.5));
  return { bike, run, hold };
}

const upright = (b: Bike) => {
  const r = b.body.rotation();
  return 1 - 2 * (r.x * r.x + r.z * r.z);
};

for (const realistic of [false, true]) {
  for (const assist of [false, true]) {
    const name = `${realistic ? 'Realistic' : 'Classic'} ${assist ? 'Easy' : 'Advanced'}`;

    // Gas it mid-turn: settle into a right-hander at 9 m/s, then full throttle.
    {
      const { bike, run, hold } = setup(realistic, assist, 9);
      run(1.5, (b) => ({ ...idle, steer: 0.7, throttle: hold(9)(b) }));
      const before = noseVsTravel(bike);
      let out = 0;
      run(1.2, () => ({ ...idle, steer: 0.7, throttle: 1 }), (b) => (out = Math.max(out, Math.abs(noseVsTravel(b) - before))));
      const crash = bike.crashCause;
      console.log(`${name}: gassing it mid-turn, back end out ${out.toFixed(1)} deg, crash ${crash}, upright ${upright(bike).toFixed(2)}`);
      if (realistic) check(out > 8, `${name}: full throttle mid-turn steps the back end out`);
      check(!crash && upright(bike) > 0.5, `${name}: the power slide doesn't throw the rider`);
      if (realistic) check(out < 60, `${name}: the slide is held, not a spin (${out.toFixed(1)} deg)`);
    }

    // Engine braking: roll off the throttle at 16 m/s.
    {
      const { bike, run, hold } = setup(realistic, assist, 16);
      run(1, (b) => ({ ...idle, throttle: hold(16)(b) }));
      const v0 = bike.speed;
      run(2, () => idle);
      const lost = v0 - bike.speed;
      console.log(`${name}: 2 s off the throttle from ${v0.toFixed(1)} m/s loses ${lost.toFixed(1)} m/s`);
      if (realistic) check(lost > 4, `${name}: the engine holds the bike back off the throttle`);
    }

    // Full lock at speed for a while, and straight-line launches: no crash.
    {
      const { bike, run, hold } = setup(realistic, assist, 13);
      run(3, (b) => ({ ...idle, steer: 1, throttle: hold(13)(b) }));
      check(!bike.crashCause && upright(bike) > 0.5, `${name}: full lock at 13 m/s for 3 s stays up (${bike.crashCause})`);
    }
    {
      const { bike, run } = setup(realistic, assist, 0);
      let worst = 0;
      run(4, () => ({ ...idle, throttle: 1 }), (b) => b.speed > 3 && (worst = Math.max(worst, Math.abs(noseVsTravel(b)))));
      check(!bike.crashCause && worst < 15, `${name}: a full-throttle launch goes straight (${worst.toFixed(1)} deg, ${bike.speed.toFixed(1)} m/s)`);
    }

    // Hard brake in a right-hander: realistic slides the rear; classic holds its line.
    {
      const { bike, run, hold } = setup(realistic, assist, 15);
      run(1.6, (b) => ({ ...idle, steer: 0.6, throttle: hold(15)(b) }));
      const before = noseVsTravel(bike);
      let out = 0;
      run(1.2, () => ({ ...idle, steer: 0.6, brake: 1 }), (b) => (out = Math.max(out, noseVsTravel(b) - before)));
      if (realistic) check(out > 6 && !bike.crashCause && upright(bike) > 0.6, `${name}: a hard brake mid-turn slides the back end out and stays up (${out.toFixed(1)} deg, ${bike.crashCause})`);
      else check(Math.abs(out) < 8 && !bike.crashCause && upright(bike) > 0.6, `${name}: a hard brake mid-turn stays in line, as in the original (${out.toFixed(1)} deg)`);
    }
  }
}

// The garage: every engine pulls and they differ; soft springs sag more; more traction turns tighter.
{
  const launch = (tuning: Partial<Tuning>) => {
    const { bike, run } = setup(false, false, 0);
    bike.setTuning({ ...DEFAULT_TUNING, ...tuning });
    let t = 0;
    run(8, () => ({ ...idle, throttle: 1 }), (b) => { if (b.speed < 26.8) t += 1 / 120; });
    return t;
  };
  const times = (['stock', 'A', 'B', 'C'] as EngineChoice[]).map((engine) => launch({ engine }));
  console.log(`0-60 mph by engine (stock, A, B, C): ${times.map((t) => t.toFixed(2)).join(', ')} s`);
  check(times.every((t) => t > 1 && t < 8) && new Set(times.map((t) => t.toFixed(2))).size > 2, 'every engine pulls, and they differ');

  const sag = (frontSpring: number) => {
    const { bike, run } = setup(false, false, 0);
    bike.setTuning({ ...DEFAULT_TUNING, frontSpring });
    run(1, () => idle);
    return bike.wheels[0].compression;
  };
  check(sag(-2) > sag(2) + 0.01, `soft front springs sag more (${(sag(-2) * 100).toFixed(1)} vs ${(sag(2) * 100).toFixed(1)} cm)`);

  const turnRate = (traction: number) => {
    const { bike, run, hold } = setup(false, false, 12);
    bike.setTuning({ ...DEFAULT_TUNING, traction });
    run(2, (b) => ({ ...idle, steer: 1, throttle: hold(12)(b) }));
    return Math.abs(bike.body.angvel().y);
  };
  check(turnRate(2) > turnRate(-2) * 1.05, `more traction turns tighter (${turnRate(2).toFixed(2)} vs ${turnRate(-2).toFixed(2)} rad/s)`);
}

console.log(failed ? `\n${failed} handling check(s) FAILED` : '\nAll handling checks passed.');
if (failed) process.exit(1);
