// For each jump on the track, which approach speeds land cleanly? Starts a bike on the centreline
// 35 m before the take-off at a set speed, holds that speed (no rider input in the air) and records
// whether it crashes before 30 m past the jump. Prints the clean range per jump.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { rapierHeights, sampleHeight } from '../src/heightmap.ts';
import { nationalsGround } from '../src/venues/nationals.ts';
import { supercrossGround } from '../src/venues/supercross.ts';
import { Player } from '../src/player.ts';

await RAPIER.init();
// Usage: node scripts/jump-speeds.ts [nationals|supercross]
const ground = process.argv[2] === 'supercross' ? supercrossGround() : nationalsGround();
const hm = ground.hm;
const track = hm.track!;
const DT = 1 / 120;
// Supercross straights are short: start closer to the jump there.
const RUN_IN = process.argv[2] === 'supercross' ? 15 : 35;

function attempt(jumpS: number, speed: number, groupEnd: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
  for (const d of ground.extra ?? []) world.createCollider(d);
  const start = track.sample(jumpS - RUN_IN);
  const p = new Player(world, hm, new THREE.Vector3(start.x, sampleHeight(hm, start.x, start.z) + 0.9, start.z), Math.atan2(-start.tx, -start.tz));
  p.bike.body.setLinvel({ x: start.tx * speed, y: 0, z: start.tz * speed }, true);
  p.bike.rider.snapTo(p.bike.body);
  let crashed = '';
  p.onCrash = (c) => (crashed = c);
  let s = jumpS - RUN_IN;
  for (let i = 0; i < 8 / DT && !crashed; i++) {
    const v = p.bike.speed;
    const t = p.bike.body.translation();
    s = track.follow(t.x, t.z, s, 20).s;
    if (s > groupEnd + 15 && s < groupEnd + 200) break;
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
for (const j of track.jumps.map((jj) => ({ s: jj.at, speed: jj.speed }))) {
  const last = groups.at(-1);
  if (last && j.s - last.at(-1)!.s < 30) last.push(j);
  else groups.push([j]);
}
for (const g of groups) {
  const results: string[] = [];
  const clean: number[] = [];
  for (let v = process.argv[2] === 'supercross' ? 5 : 8; v <= (process.argv[2] === 'supercross' ? 18 : 26); v += 1) {
    const last = track.jumps.filter((j) => j.at >= g[0].s && j.at <= g.at(-1)!.s).at(-1)!;
    const crash = attempt(g[0].s, v, last.at + last.up + last.top + last.down);
    results.push(crash ? `${v}:x` : `${v}:ok`);
    if (!crash) clean.push(v);
  }
  console.log(`jump at ${g[0].s} m (${g.length} part${g.length > 1 ? 's' : ''}, AI speed ${g[0].speed}): clean ${clean.length ? `${clean[0]}..${clean.at(-1)}` : 'none'}  [${results.join(' ')}]`);
}
