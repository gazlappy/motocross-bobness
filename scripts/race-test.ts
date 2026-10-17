// Seven AI riders race on the Nationals track; reports lap times, crashes and pick-ups.
// Usage: node scripts/race-test.ts [laps]
import RAPIER from '@dimforge/rapier3d-compat';
import { generateHeightmap, rapierHeights, sampleHeight } from '../src/heightmap.ts';
import { Player } from '../src/player.ts';
import { Sim } from '../src/sim.ts';
import { Race } from '../src/race.ts';
import { AIDriver } from '../src/ai.ts';

await RAPIER.init();
const laps = Number(process.argv[2] ?? 1);
const hm = generateHeightmap();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const DT = 1 / 120;
world.timestep = DT;
world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));

const sim = new Sim(world);
const race = new Race(hm.track, laps);
const drivers: AIDriver[] = [];
const stats = new Map<string, { crashes: string[]; resets: number }>();
const names = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'White', 'Black'];
names.forEach((name, i) => {
  const [pos, yaw] = Race.gridSlot(hm.track, i);
  pos.y = sampleHeight(hm, pos.x, pos.z) + 1;
  const player = new Player(world, hm, pos, yaw);
  player.track = hm.track;
  sim.players.push(player);
  race.add(name, player, false);
  const lane = ((i % 3) - 1) * 3.5;
  drivers.push(new AIDriver(player, hm.track, { skill: 0.88 + 0.02 * (i % 6), lane }));
  stats.set(name, { crashes: [], resets: 0 });
  player.onCrash = (cause) => {
    const t = player.bike.body.translation(), v = player.bike.body.linvel();
    const hit = hm.track.nearest(t.x, t.z, 400);
    stats.get(name)!.crashes.push(`${cause} @${hit?.s.toFixed(0)}m ${Math.hypot(v.x, v.z).toFixed(0)}m/s`);
  };
});
race.onLap = (r, lap, time) => console.log(`${r.name} lap ${lap}: ${time.toFixed(1)} s`);
race.onFinish = (r, place) => console.log(`${r.name} finished P${place} at ${r.finishTime.toFixed(1)} s`);

const t0 = performance.now();
for (let i = 0; i < (laps * 110 + 10) / DT; i++) {
  const controls = drivers.map((d) => d.controls(DT, sim.players, race.started));
  sim.step(controls, DT);
  for (const p of sim.players) p.update(DT);
  race.update(DT);
  if (race.racers.every((r) => r.finished)) break;
}
console.log(`\nsimulated ${race.clock.toFixed(0)} s of racing in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
for (const r of race.standings()) {
  const st = stats.get(r.name)!;
  console.log(`${String(race.position(r)).padStart(2)}. ${r.name.padEnd(7)} lap ${Math.min(r.lap, laps)}/${laps} ${r.finished ? `finished ${r.finishTime.toFixed(1)} s` : `at ${r.s.toFixed(0)} m`} | crashes ${st.crashes.length}${st.crashes.length ? ` (${st.crashes.join(', ')})` : ''}`);
}
