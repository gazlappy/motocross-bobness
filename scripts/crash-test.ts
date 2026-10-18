// Crash scenarios through the full Player: clean riding must not crash, bad riding must, and every
// crash must settle and respawn into a rideable bike.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { generateHeightmap, rapierHeights, sampleHeight } from '../src/heightmap.ts';
import { Player } from '../src/player.ts';
import type { Controls } from '../src/input.ts';

await RAPIER.init();
const hm = generateHeightmap();
const DT = 1 / 120;
const idle: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };

// The start straight: its rollers and tabletop, then the first corner at ~120 m.
const START = hm.track!.sample(2);
const START_YAW = Math.atan2(-START.tx, -START.tz);
const atStart = (lift: number) => new THREE.Vector3(START.x, sampleHeight(hm, START.x, START.z) + lift, START.z);

function setup() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
  const player = new Player(world, hm, atStart(1), START_YAW);
  const log: string[] = [];
  let maxRagdollSpeed = 0;
  player.onCrash = (cause) => log.push(`crash: ${cause}`);
  player.onRespawn = () => log.push('respawn');
  const run = (seconds: number, controls: (t: number) => Controls, until?: () => boolean) => {
    for (let i = 0; i < seconds / DT; i++) {
      if (until?.()) return;
      player.physicsStep(controls(i * DT), DT);
      player.update(DT);
      if (player.ragdoll) maxRagdollSpeed = Math.max(maxRagdollSpeed, player.ragdoll.speed);
    }
  };
  return { world, player, log, run, maxSpeed: () => maxRagdollSpeed };
}

function upY(player: Player) {
  const r = player.bike.body.rotation();
  return 1 - 2 * (r.x * r.x + r.z * r.z);
}

function report(name: string, s: ReturnType<typeof setup>, expectCrash: boolean) {
  const crashed = s.log.some((l) => l.startsWith('crash'));
  const ok = crashed === expectCrash;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${s.log.join(', ') || 'no crash'}` +
    (crashed ? ` | ragdoll top speed ${s.maxSpeed().toFixed(1)} m/s` : ''));
  return ok;
}

let allOk = true;

// Past the start straight's jumps, before the first corner.
const pastJumps = (p: Player) => {
  const t = p.bike.body.translation();
  return (hm.track!.nearest(t.x, t.z, 40)?.s ?? 0) > 112;
};

// 1. Full throttle down the start straight, hands off: the jumps should all be survivable.
{
  const s = setup();
  s.run(9, (t) => ({ ...idle, throttle: t > 0.5 ? 1 : 0 }), () => pastJumps(s.player));
  allOk = report('hands-off run over the jumps', s, false) && allOk;
}

// 2. Off the big kicker leaning hard forward: lands on the front wheel and goes over the bars.
{
  const s = setup();
  s.run(9, (t) => ({ ...idle, throttle: t > 0.5 ? 1 : 0, leanForward: s.player.bike.grounded ? 0 : 1 }), () => pastJumps(s.player) && !s.player.crashed);
  allOk = report('nose-dive off the jumps', s, true) && allOk;
}

// 3. Dropped flat from 20 m: too hard to ride away from.
{
  const s = setup();
  s.player.bike.reset(atStart(20), START_YAW);
  s.run(3, () => idle);
  allOk = report('20 m flat drop', s, true) && allOk;
}

// 4. Upside down: crash, settle, respawn, then ride away.
{
  const s = setup();
  s.player.bike.reset(atStart(2), START_YAW);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
  s.player.bike.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  s.player.bike.rider.snapTo(s.player.bike.body);
  s.run(8, () => idle);
  const ok = report('upside down', s, true) && s.log.includes('respawn');
  s.run(3, (t) => ({ ...idle, throttle: t > 0.5 ? 0.6 : 0 }));
  const rideable = !s.player.crashed && upY(s.player) > 0.9 && s.player.bike.speed > 3;
  console.log(`${rideable ? 'PASS' : 'FAIL'} rides away after respawn: speed ${(s.player.bike.speed * 2.237).toFixed(0)} mph, upright ${upY(s.player).toFixed(2)}`);
  allOk = ok && rideable && allOk;
}

console.log(allOk ? '\nAll crash checks passed.' : '\nSome crash checks FAILED.');
