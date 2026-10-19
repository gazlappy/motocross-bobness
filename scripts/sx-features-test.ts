// Every supercross piece feature, alone on a long straight: which take-off speeds land cleanly (a
// hands-off rider holding speed), so the AI's speeds sit inside the safe range. Also checks that
// random tracks are valid and the editor's rules hold.
// Usage: node scripts/sx-features-test.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { rapierHeights, sampleHeight } from '../src/heightmap.ts';
import { Player } from '../src/player.ts';
import { supercrossGround } from '../src/venues/supercross.ts';
import { type SxPiece, type SxTrack, problems, randomTrack, toTrackDef } from '../src/sxTrack.ts';

await RAPIER.init();
const DT = 1 / 120;
let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};

/** Two lanes across the floor; the feature sits on the top lane, eight tiles in. */
function testTrack(feature: SxPiece): SxTrack {
  const lane = (n: number) => Array<SxPiece>(n).fill('straight');
  const top = [...lane(7), feature, ...lane(3)]; // columns 2..12 heading east
  return {
    name: feature,
    start: { col: 1, row: 1, dir: 1 },
    pieces: ['finish', ...top, 'left', 'left', ...lane(12), 'left', 'left'],
  };
}

for (const feature of ['jump', 'smallJump', 'mound', 'smallMound', 'table', 'whoops'] as SxPiece[]) {
  const track = testTrack(feature);
  const bad = problems(track);
  if (bad.length) {
    check(false, `${feature} test track: ${bad.join(', ')}`);
    continue;
  }
  const ground = supercrossGround({ track });
  const hm = ground.hm, t = hm.track!;
  const def = toTrackDef(track);
  const at = def.jumps[0].at, aiSpeed = def.jumps[0].speed;
  const clean: number[] = [];
  for (let v = 5; v <= 13; v++) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
    for (const d of ground.extra ?? []) world.createCollider(d);
    const s0 = t.sample(at - 12);
    const p = new Player(world, hm, new THREE.Vector3(s0.x, sampleHeight(hm, s0.x, s0.z) + 0.9, s0.z), Math.atan2(-s0.tx, -s0.tz));
    p.bike.body.setLinvel({ x: s0.tx * v, y: 0, z: s0.tz * v }, true);
    p.bike.rider.snapTo(p.bike.body);
    let crashed = false;
    p.onCrash = () => (crashed = true);
    for (let i = 0; i < 4 / DT && !crashed; i++) {
      const throttle = Math.max(0, Math.min(1, (v - p.bike.speed) * 0.5));
      p.physicsStep({ throttle, brake: 0, steer: 0, leanForward: 0, leanSide: 0 }, DT);
      p.update(DT);
      const pos = p.bike.body.translation();
      if ((t.nearest(pos.x, pos.z, 30)?.s ?? 0) > at + 25) break;
    }
    if (!crashed) clean.push(v);
  }
  const ok = clean.includes(aiSpeed) && clean.includes(aiSpeed - 1) && clean.includes(aiSpeed + 1);
  check(ok, `${feature}: clean at ${clean.join(', ') || 'none'} m/s (AI takes it at ${aiSpeed})`);
}

// Random tracks are always valid.
const bad = Array.from({ length: 40 }, (_, i) => [i, problems(randomTrack(i))] as const).filter(([, p]) => p.length);
check(bad.length === 0, `40 random tracks valid${bad.length ? `: ${bad.map(([i, p]) => `${i} ${p.join('/')}`).join('; ')}` : ''}`);

console.log(failed ? `\n${failed} supercross check(s) FAILED` : '\nAll supercross checks passed.');
if (failed) process.exit(1);
