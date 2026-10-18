// How hard is the bike for a beginner? A "novice" rides Nationals: steers at the track and slows for
// corners, but takes every jump at whatever speed it has, never leans, never sets up a landing.
// Counts crashes (and why) with no assist, and with Easy controls' assist (bike.assist).
// Usage: node scripts/novice-test.ts [laps] [realistic]   (averages nine riders per case)
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { rapierHeights } from '../src/heightmap.ts';
import { Player } from '../src/player.ts';
import { nationalsGround } from '../src/venues/nationals.ts';
import type { Controls } from '../src/input.ts';

await RAPIER.init();
const laps = Number(process.argv[2] ?? 2);
const realistic = process.argv[3] === 'realistic';
const DT = 1 / 120;
const ground = nationalsGround();
const hm = ground.hm, track = hm.track!;

function ride(easy: boolean, keyboard: boolean, slot: number, deadband: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
  const [pos, yaw] = ground.grid(slot);
  const p = new Player(world, hm, pos, yaw);
  p.track = track;
  p.keepOnCourse = true; // as in a race
  p.bike.assist = easy;
  p.bike.realistic = realistic;
  const causes: Record<string, number> = {};
  const where: string[] = [];
  p.onCrash = (c) => {
    causes[c] = (causes[c] ?? 0) + 1;
    const v = p.bike.body.linvel();
    where.push(`${c} @${s.toFixed(0)}m ${Math.hypot(v.x, v.z).toFixed(0)}m/s air ${p.bike.airTime.toFixed(2)}s`);
  };
  const q = new THREE.Quaternion(), f = new THREE.Vector3();
  let s = track.nearest(pos.x, pos.z, 50)!.s;
  let distance = 0, lastS = s, time = 0, steerKey = 0;
  while (distance < laps * track.length && time < laps * 150) {
    const b = p.bike, t = b.body.translation();
    const hit = track.follow(t.x, t.z, s, 30);
    s = hit.distance > 30 ? (track.nearest(t.x, t.z, 400)?.s ?? s) : hit.s;
    let ds = s - lastS;
    if (ds < -track.length / 2) ds += track.length;
    if (ds > track.length / 2) ds -= track.length;
    if (!p.crashed) distance += Math.max(0, ds);
    lastS = s;

    // Steer at a point ahead on the centre line.
    const ahead = track.sample(s + 9 + Math.max(0, b.speed) * 0.8);
    const r = b.body.rotation();
    q.set(r.x, r.y, r.z, r.w).invert();
    const local = f.set(ahead.x - t.x, 0, ahead.z - t.z).applyQuaternion(q);
    const angle = Math.atan2(local.x, -local.z);
    // Corner speed only: a novice doesn't think about jumps.
    let target = 26;
    for (let d = 0; d <= 60; d += 3) {
      const k = Math.abs(track.sample(s + d).curvature);
      if (k > 1e-4) target = Math.min(target, Math.sqrt(Math.sqrt(0.6 * 9.81 / k) ** 2 + 2 * 5 * d));
    }
    // Keyboard: steering keys are on or off (smoothed the way the game smooths them), gas held
    // everywhere, brake key slammed for corners.
    const wantSteer = keyboard ? (Math.abs(angle) > deadband ? Math.sign(angle) : 0) : THREE.MathUtils.clamp(angle * (1 + deadband * 8), -1, 1);
    const rate = wantSteer === 0 ? 6 : 3.5;
    steerKey += THREE.MathUtils.clamp(wantSteer - steerKey, -rate * DT, rate * DT);
    const braking = b.speed > target + 1.5;
    const c: Controls = {
      throttle: keyboard ? (braking ? 0 : 1) : b.speed < target ? 1 : 0,
      brake: braking ? (keyboard ? 1 : 0.6) : 0,
      steer: keyboard ? steerKey : wantSteer,
      leanForward: 0, leanSide: 0,
    };
    p.physicsStep(c, DT);
    p.update(DT);
    time += DT;
  }
  const total = Object.values(causes).reduce((a, b) => a + b, 0);
  return { total, causes, time, where };
}

// Nine riders per case (three start slots x three steering styles): single runs are too chaotic.
for (const keyboard of [false, true]) {
  for (const easy of [false, true]) {
    let total = 0, time = 0;
    const causes: Record<string, number> = {};
    for (const slot of [0, 1, 2]) {
      for (const deadband of [0.04, 0.06, 0.09]) {
        const r = ride(easy, keyboard, slot, deadband);
        total += r.total;
        time += r.time;
        for (const [k, n] of Object.entries(r.causes)) causes[k] = (causes[k] ?? 0) + n;
      }
    }
    console.log(`${keyboard ? 'keyboard' : 'smooth  '} ${easy ? 'Easy    ' : 'Advanced'}: ${(total / 9).toFixed(1)} crashes per ${laps} laps, ${(time / 9).toFixed(0)} s ${JSON.stringify(causes)}`);
  }
}
