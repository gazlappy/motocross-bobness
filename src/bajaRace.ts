import type * as THREE from 'three';
import { type Competition, type Contestant, type Racer, type ResultsTable, newRacer } from './competition.ts';
import { clockText, ordinal } from './format.ts';
import { COUNTDOWN } from './race.ts';

// Baja: no track, just waypoints across open country, taken in order. Ride whatever line you like
// between them; reaching the last one is the finish.

export const WAYPOINT_RADIUS = 18; // m

export class BajaRace implements Competition {
  readonly racers: Racer[] = [];
  readonly waypoints: THREE.Vector3[];
  clock = -COUNTDOWN;
  onLap?: (racer: Racer, lap: number, lapTime: number) => void;
  onFinish?: (racer: Racer, place: number) => void;
  /** A racer reached a waypoint (index into `waypoints`). */
  onWaypoint?: (racer: Racer, index: number) => void;
  private finishedCount = 0;

  constructor(waypoints: THREE.Vector3[]) {
    this.waypoints = waypoints;
  }

  get started() {
    return this.clock >= 0;
  }

  add(name: string, player: Contestant, human: boolean) {
    this.racers.push(newRacer(name, player, human));
  }

  /** The waypoint a racer is heading for. */
  target(r: Racer) {
    return this.waypoints[Math.min(r.nextCheckpoint, this.waypoints.length - 1)];
  }

  distanceToTarget(r: Racer) {
    const t = r.player.bike.body.translation();
    const w = this.target(r);
    return Math.hypot(w.x - t.x, w.z - t.z);
  }

  update(dt: number) {
    this.clock += dt;
    if (!this.started) return;
    for (const r of this.racers) {
      if (r.finished || r.pending) continue;
      if (this.distanceToTarget(r) < WAYPOINT_RADIUS) {
        const index = r.nextCheckpoint;
        r.lap = ++r.nextCheckpoint;
        this.onWaypoint?.(r, index);
        if (r.nextCheckpoint >= this.waypoints.length) {
          if (r.remote) r.pending = true;
          else this.finishRacer(r, this.clock);
        }
      }
    }
  }

  private progress(r: Racer) {
    if (r.finished) return 1e9 - r.finishTime;
    return r.nextCheckpoint * 1e5 - this.distanceToTarget(r);
  }

  finishRacer(r: Racer, time: number) {
    if (r.finished) return;
    r.finished = true;
    r.pending = false;
    r.nextCheckpoint = this.waypoints.length;
    r.finishTime = time;
    this.onFinish?.(r, ++this.finishedCount);
  }

  standings() {
    return [...this.racers].sort((a, b) => this.progress(b) - this.progress(a));
  }

  position(r: Racer) {
    return this.standings().indexOf(r) + 1;
  }

  hud(r: Racer) {
    const n = this.waypoints.length;
    const time = r.finished ? r.finishTime : Math.max(0, this.clock);
    const next = Math.min(r.nextCheckpoint + 1, n);
    const dist = r.finished ? '' : ` &nbsp; <b>${Math.round(this.distanceToTarget(r))}</b> m`;
    return `WAYPOINT <b>${next}/${n}</b>${dist} &nbsp; <b>${ordinal(this.position(r))}</b>/${this.racers.length} &nbsp; ${clockText(time)}`;
  }

  results(): ResultsTable {
    return {
      title: 'Baja Results',
      head: ['', 'Rider', 'Time', 'Waypoints'],
      rows: this.standings().map((r, i) => ({
        me: r.human,
        cells: [String(i + 1), r.name, r.finished ? clockText(r.finishTime) : 'racing', `${r.nextCheckpoint}/${this.waypoints.length}`],
      })),
    };
  }
}
