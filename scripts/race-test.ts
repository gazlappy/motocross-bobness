// Seven AI riders race at a venue; reports finishing times, crashes and where they happened.
// Usage: node scripts/race-test.ts [laps] [nationals|supercross|baja] [125|250|250f]
import RAPIER from '@dimforge/rapier3d-compat';
import { rapierHeights } from '../src/heightmap.ts';
import { Player } from '../src/player.ts';
import { Sim } from '../src/sim.ts';
import { Race } from '../src/race.ts';
import { BajaRace } from '../src/bajaRace.ts';
import { AIDriver, type Driver } from '../src/ai.ts';
import { BajaDriver } from '../src/bajaDriver.ts';
import type { Competition } from '../src/competition.ts';
import type { Ground } from '../src/venue.ts';
import { nationalsGround } from '../src/venues/nationals.ts';
import { supercrossGround } from '../src/venues/supercross.ts';
import { bajaGround } from '../src/venues/baja.ts';
import { BIKES, type BikeId } from '../src/bikes.ts';

await RAPIER.init();
const laps = Number(process.argv[2] ?? 1);
const venueId = process.argv[3] ?? 'nationals';
const spec = BIKES[(process.argv[4] ?? '250') as BikeId];
const ground: Ground = venueId === 'supercross' ? supercrossGround() : venueId === 'baja' ? bajaGround() : nationalsGround();
const hm = ground.hm;
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const DT = 1 / 120;
world.timestep = DT;
world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
for (const d of ground.extra ?? []) world.createCollider(d);

const sim = new Sim(world);
const event: Competition = venueId === 'baja' ? new BajaRace(ground.waypoints!) : new Race(hm.track!, laps);
const drivers: Driver[] = [];
const crashes = new Map<string, string[]>();
const names = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'White', 'Black'];
names.forEach((name, i) => {
  const [pos, yaw] = ground.grid(i);
  const player = new Player(world, hm, pos, yaw, spec);
  player.track = hm.track;
  player.cannonEnabled = venueId !== 'supercross';
  sim.players.push(player);
  event.add(name, player, false);
  const racer = event.racers[i];
  if (event instanceof BajaRace) {
    const baja = event;
    player.respawnGuide = { back: () => (racer.nextCheckpoint > 0 ? baja.waypoints[racer.nextCheckpoint - 1] : pos), ahead: () => baja.target(racer) };
  }
  const skill = 0.88 + 0.02 * (i % 6);
  drivers.push(event instanceof BajaRace
    ? new BajaDriver(player, event, racer, hm, skill, (i % 2 ? 1 : -1) * (10 + i * 6))
    : new AIDriver(player, hm.track!, { skill, lane: ((i % 3) - 1) * Math.min(3.5, hm.track!.halfWidth * 0.6) }));
  crashes.set(name, []);
  player.onCrash = (cause) => {
    const t = player.bike.body.translation(), v = player.bike.body.linvel();
    const where = hm.track ? `@${hm.track.nearest(t.x, t.z, 400)?.s.toFixed(0)}m` : `@(${t.x.toFixed(0)},${t.z.toFixed(0)})`;
    crashes.get(name)!.push(`${cause} ${where} ${Math.hypot(v.x, v.z).toFixed(0)}m/s`);
  };
});
event.onFinish = (r, place) => console.log(`${r.name} finished P${place} at ${r.finishTime.toFixed(1)} s`);

const limit = venueId === 'baja' ? 400 : laps * 120 + 10;
const t0 = performance.now();
for (let i = 0; i < limit / DT; i++) {
  const controls = drivers.map((d) => d.controls(DT, sim.players, event.started));
  sim.step(controls, DT);
  for (const p of sim.players) p.update(DT);
  event.update(DT);
  if (event.racers.every((r) => r.finished)) break;
}
console.log(`\n${venueId} on ${spec.name}s: simulated ${event.clock.toFixed(0)} s of racing in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
for (const r of event.standings()) {
  const c = crashes.get(r.name)!;
  const status = r.finished ? `finished ${r.finishTime.toFixed(1)} s` : venueId === 'baja' ? `at waypoint ${r.nextCheckpoint + 1}` : `lap ${r.lap} at ${r.s.toFixed(0)} m`;
  console.log(`${String(event.position(r)).padStart(2)}. ${r.name.padEnd(7)} ${status} | crashes ${c.length}${c.length ? ` (${c.join(', ')})` : ''}`);
}
