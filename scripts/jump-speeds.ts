// For each jump on the track, which approach speeds land cleanly? Starts a bike on the centreline
// 35 m before the take-off at a set speed, holds that speed (no rider input in the air) and records
// whether it crashes before 30 m past the jump. Prints the clean range per jump.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { generateHeightmap, jumpApproaches, rapierHeights, sampleHeight } from '../src/heightmap.ts';
import { Player } from '../src/player.ts';

await RAPIER.init();
const hm = generateHeightmap();
const track = hm.track;
const DT = 1 / 120;

function attempt(jumpS: number, speed: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
  const start = track.sample(jumpS - 35);
  const p = new Player(world, hm, new THREE.Vector3(start.x, sampleHeight(hm, start.x, start.z) + 0.9, start.z), Math.atan2(-start.tx, -start.tz));
  p.bike.body.setLinvel({ x: start.tx * speed, y: 0, z: start.tz * speed }, true);
  p.bike.rider.snapTo(p.bike.body);
  let crashed = '';
  p.onCrash = (c) => (crashed = c);
  let s = jumpS - 35;
  for (let i = 0; i < 8 / DT && !crashed; i++) {
    const v = p.bike.speed;
    const t = p.bike.body.translation();
    s = track.follow(t.x, t.z, s, 20).s;
    if (s > jumpS + 30 && s < jumpS + 200) break;
    const throttle = p.bike.grounded ? Math.max(0, Math.min(1, (speed - v) * 0.8 + 0.3)) : 0.3;
    const brake = p.bike.grounded && v > speed + 1 ? 0.5 : 0;
    // Steer gently back to the centreline so the run stays on the jump.
    const hit = track.follow(t.x, t.z, s, 20);
    const steer = Math.max(-1, Math.min(1, hit.lateral * -0.15));
    p.physicsStep({ throttle, brake, steer, leanForward: 0, leanSide: 0 }, DT);
    p.update(DT);
  }
  return crashed;
}

// Group jumps that run into each other (doubles, whoops) and test from the first take-off.
const groups: { s: number; speed: number }[][] = [];
for (const j of jumpApproaches().sort((a, b) => a.s - b.s)) {
  const last = groups.at(-1);
  if (last && j.s - last.at(-1)!.s < 30) last.push(j);
  else groups.push([j]);
}
for (const g of groups) {
  const results: string[] = [];
  const clean: number[] = [];
  for (let v = 8; v <= 26; v += 1) {
    const crash = attempt(g[0].s, v);
    results.push(crash ? `${v}:x` : `${v}:ok`);
    if (!crash) clean.push(v);
  }
  console.log(`jump at ${g[0].s} m (${g.length} part${g.length > 1 ? 's' : ''}, AI speed ${g[0].speed}): clean ${clean.length ? `${clean[0]}..${clean.at(-1)}` : 'none'}  [${results.join(' ')}]`);
}
