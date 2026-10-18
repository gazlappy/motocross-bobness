// Stunts and the out-of-bounds cannon, through the full Player.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { generateHeightmap, rapierHeights, sampleHeight } from '../src/heightmap.ts';
import { Player } from '../src/player.ts';
import type { Controls, StuntDir } from '../src/input.ts';
import { STUNT_LIST, stuntFor } from '../src/stunts.ts';
import { POSE_JOINTS, createPose, ridingPose } from '../src/riderPose.ts';

await RAPIER.init();
const hm = generateHeightmap();
const DT = 1 / 120;
const idle: Controls = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };

// On the start straight, facing down the track (its rollers and tabletop give air).
const START = hm.track!.sample(2);
function setup(at = new THREE.Vector3(START.x, 0, START.z), yaw = Math.atan2(-START.tx, -START.tz)) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
  const spawn = at.clone().setY(sampleHeight(hm, at.x, at.z) + 1);
  const player = new Player(world, hm, spawn, yaw);
  const log: string[] = [];
  player.onCrash = (cause) => log.push(`crash: ${cause}`);
  player.onCannon = () => log.push('cannon');
  player.stunts.onBank = (p, label) => log.push(`banked ${p} (${label})`);
  const run = (seconds: number, controls: (t: number) => Controls, until?: () => boolean) => {
    for (let i = 0; i < seconds / DT; i++) {
      player.physicsStep(controls(i * DT), DT);
      player.update(DT);
      if (until?.()) return;
    }
  };
  return { player, log, run };
}

let ok = true;
const check = (name: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  ok &&= pass;
};

// 1. Superman off the jumps, tucked back in on the way down: should bank points.
{
  const s = setup();
  s.run(9, () => {
    const b = s.player.bike;
    const t = b.body.translation();
    const high = t.y - sampleHeight(hm, t.x, t.z) > 3;
    const rising = b.body.linvel().y > -3;
    return { ...idle, throttle: 1, stunt: !b.grounded && high && rising ? 1 : 0, stuntDir: 'down' as StuntDir };
  }, () => s.log.some((l) => l.includes('Superman')) || s.player.crashed);
  const banked = s.log.filter((l) => l.startsWith('banked'));
  check('clean Superman', banked.some((l) => l.includes('Superman')) && !s.log.some((l) => l.startsWith('crash')), s.log.join(', '));
}

// 2. Same, but held all the way to the ground: botched.
{
  const s = setup();
  s.run(9, () => ({ ...idle, throttle: 1, stunt: 1, stuntDir: 'down' as StuntDir }), () => s.player.crashed);
  check('Superman held into the landing', s.log.some((l) => l.includes('botched the Superman')), s.log.join(', ') || 'no crash');
}

// 3. Over the edge of the map: the cannon fires and lands you near the middle.
{
  const limit = hm.size / 2 - 22;
  const s = setup(new THREE.Vector3(limit + 2, 0, 0), -Math.PI / 2);
  s.player.bike.body.setLinvel({ x: 15, y: 0, z: 0 }, true);
  s.player.bike.rider.snapTo(s.player.bike.body);
  let landed: THREE.Vector3 | null = null;
  let flew = false;
  let maxHeight = -Infinity;
  s.run(14, () => idle, () => {
    const t = s.player.bike.body.translation();
    if (s.log.includes('cannon')) maxHeight = Math.max(maxHeight, t.y);
    if (s.log.includes('cannon') && t.y - sampleHeight(hm, t.x, t.z) > 3) flew = true;
    if (flew && (s.player.bike.grounded || s.player.crashed) && !landed) {
      landed = new THREE.Vector3(t.x, t.y, t.z);
    }
    return landed !== null;
  });
  const p = landed as THREE.Vector3 | null;
  const dist = p ? Math.hypot(p.x, p.z) : Infinity;
  check('cannon', s.log.includes('cannon') && dist < 140,
    `${s.log.join(', ')}; peak ${maxHeight.toFixed(0)} m, came down ${dist.toFixed(0)} m from the centre`);
}

// 4. All sixteen tricks, one per stunt button and lean direction, as in the original; every pose is
// finite, and none is picked with no direction.
{
  const s = setup();
  const pose = createPose();
  const bad: string[] = [];
  const names = new Set<string>();
  for (const { button, dir } of STUNT_LIST) {
    const def = stuntFor(button, dir)!;
    names.add(def.name);
    ridingPose(s.player.bike, pose, undefined, undefined, { def, weight: 1, taunt: 1 });
    if (POSE_JOINTS.some((j) => !Number.isFinite(pose[j].x + pose[j].y + pose[j].z))) bad.push(def.name);
  }
  check('16 different tricks', names.size === 16 && STUNT_LIST.length === 16, [...names].join(', '));
  check('all trick poses finite', bad.length === 0, bad.length ? `bad: ${bad.join(', ')}` : 'finite');
  check('no trick without a direction', stuntFor(1, 'none') === null && stuntFor(2, 'none') === null, '');
}

// 5. Big Kahuna Dumpster: a Skurfer, then the rider leaps off (scores, then it's a wipeout).
{
  const s = setup();
  s.run(2, () => ({ ...idle, throttle: 0.6 }));
  s.player.stunts.dumpster();
  s.run(3, () => idle, () => s.player.crashed);
  check('Big Kahuna Dumpster', s.log.some((l) => l.includes('banked') && l.includes('Big Kahuna Dumpster')) && s.log.some((l) => l.includes('crash: Big Kahuna Dumpster')), s.log.join(', '));
}

// 6. Tail Stand hauls the nose up in the air.
{
  const pitch = (stuntDir: StuntDir) => {
    const s = setup();
    let most = -Infinity;
    s.run(9, () => {
      const b = s.player.bike;
      const t = b.body.translation();
      const high = t.y - sampleHeight(hm, t.x, t.z) > 3;
      return { ...idle, throttle: 1, stunt: !b.grounded && high ? 2 : 0, stuntDir };
    }, () => {
      const b = s.player.bike;
      const r = b.body.rotation();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      if (!b.grounded && s.player.stunts.state.weight > 0.9) most = Math.max(most, fwd.y);
      return s.player.crashed;
    });
    return most;
  };
  const tail = pitch('downLeft'), skurfer = pitch('down');
  check('Tail Stand pulls the nose up', tail > skurfer + 0.2, `nose height (sin of pitch) ${tail.toFixed(2)} vs ${skurfer.toFixed(2)} in a Skurfer`);
}

// 7. Racing off the track: cut across to another part of it and you're put back where you left it;
// ride back on where you left and nothing happens.
{
  const track = hm.track!;
  const place = (s: number, lateral = 0) => {
    const p = track.sample(s);
    return new THREE.Vector3(p.x + p.tz * lateral, 0, p.z - p.tx * lateral);
  };
  const heading = (s: number) => Math.atan2(-track.sample(s).tx, -track.sample(s).tz);
  const leave = (player: Player, at: THREE.Vector3, leftAt: number) => {
    player.placeBike(at, 0, false);
    (player as unknown as { courseS: number }).courseS = leftAt;
  };

  const cut = setup(place(440), heading(440));
  cut.player.track = track;
  cut.player.keepOnCourse = true;
  cut.run(0.5, () => idle);
  leave(cut.player, place(740), 440); // onto another leg, 300 m further round
  let resetAt: THREE.Vector3 | null = null;
  cut.player.onRespawn = () => {
    const t = cut.player.bike.body.translation();
    resetAt = new THREE.Vector3(t.x, t.y, t.z);
  };
  cut.run(6, () => idle, () => resetAt !== null);
  const at = resetAt as THREE.Vector3 | null;
  const hit = at ? track.nearest(at.x, at.z, 60) : null;
  check('cutting across resets you where you left', hit !== null && Math.abs(hit.s - 440) < 15,
    hit ? `put back at ${hit.s.toFixed(0)} m (left at 440 m)` : 'never reset');

  const stay = setup(place(440), heading(440));
  stay.player.track = track;
  stay.player.keepOnCourse = true;
  let reset = false;
  stay.player.onRespawn = () => { reset = true; };
  stay.run(0.5, () => idle);
  leave(stay.player, place(445, 20), 440); // off the edge
  stay.run(2, () => idle);
  const shown = stay.player.offCourseTarget !== null;
  leave(stay.player, place(450), 440); // back on, where we left
  stay.run(5, () => idle);
  check('rejoining where you left is fine', shown && !reset && stay.player.offCourseTarget === null,
    `arrow shown while off: ${shown}, reset: ${reset}`);
}

console.log(ok ? '\nAll stunt checks passed.' : '\nSome stunt checks FAILED.');
