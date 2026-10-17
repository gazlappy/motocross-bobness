import * as THREE from 'three';
import type { Track } from './track.ts';
import { type Competition, type Contestant, type Racer, type ResultsTable, newRacer } from './competition.ts';
import { clockText, ordinal } from './format.ts';

export type { Racer } from './competition.ts';

// A track race (Nationals, Supercross): a countdown on the grid, ordered checkpoints round the lap (no shortcuts),
// lap counting from the start/finish line, and live standings.

const CHECKPOINTS = 10;
const CHECKPOINT_WINDOW = 45; // m past a checkpoint in which it still counts
const CHECKPOINT_REACH = 35; // m from the centreline
export const COUNTDOWN = 3.5; // s: "3, 2, 1, GO" with GO at 0

export class Race implements Competition {
  readonly laps: number;
  readonly racers: Racer[] = [];
  readonly track: Track;
  /** Seconds since GO (negative during the countdown). */
  clock = -COUNTDOWN;
  onLap?: (racer: Racer, lap: number, lapTime: number) => void;
  onFinish?: (racer: Racer, place: number) => void;
  private finishedCount = 0;
  private checkpoints: number[];

  constructor(track: Track, laps = 3) {
    this.track = track;
    this.laps = laps;
    this.checkpoints = Array.from({ length: CHECKPOINTS }, (_, i) => (i / CHECKPOINTS) * track.length);
  }

  /** Grid slot `i` behind the start line: rows of three. Returns position (x, z) and heading. */
  static gridSlot(track: Track, i: number): [THREE.Vector3, number] {
    const row = Math.floor(i / 3), col = (i % 3) - 1;
    const p = track.sample(track.length - 8 - row * 7);
    const spacing = Math.min(4, track.halfWidth * 0.6);
    const lateral = col * spacing + (row % 2 ? spacing * 0.4 : 0);
    return [new THREE.Vector3(p.x + p.tz * lateral, 0, p.z - p.tx * lateral), Math.atan2(-p.tx, -p.tz)];
  }

  add(name: string, player: Contestant, human: boolean) {
    const t = player.bike.body.translation();
    const hit = this.track.nearest(t.x, t.z, 100);
    this.racers.push(newRacer(name, player, human, hit?.s ?? 0));
  }

  get started() {
    return this.clock >= 0;
  }

  /** Per physics step, after the world has moved. */
  update(dt: number) {
    this.clock += dt;
    if (!this.started) return;
    for (const r of this.racers) {
      if (r.finished || r.pending) continue;
      const t = r.player.bike.body.translation();
      let hit = this.track.follow(t.x, t.z, r.s, 30);
      // Lost the thread (respawn, cannon): search properly.
      if (hit.distance > 30) hit = this.track.nearest(t.x, t.z, 400) ?? hit;
      r.s = hit.s;

      const cp = this.checkpoints[r.nextCheckpoint];
      const past = (((r.s - cp) % this.track.length) + this.track.length) % this.track.length;
      if (past < CHECKPOINT_WINDOW && hit.distance < CHECKPOINT_REACH) {
        if (r.nextCheckpoint === 0) this.crossLine(r);
        r.nextCheckpoint = (r.nextCheckpoint + 1) % CHECKPOINTS;
      }
    }
  }

  private crossLine(r: Racer) {
    if (r.lap > 0) {
      const lapTime = this.clock - r.lapStart;
      r.bestLap = Math.min(r.bestLap, lapTime);
      this.onLap?.(r, r.lap, lapTime);
    }
    r.lap++;
    r.lapStart = this.clock;
    if (r.lap > this.laps) {
      if (r.remote) r.pending = true;
      else this.finishRacer(r, this.clock);
    }
  }

  finishRacer(r: Racer, time: number) {
    if (r.finished) return;
    r.finished = true;
    r.pending = false;
    r.finishTime = time;
    this.onFinish?.(r, ++this.finishedCount);
  }

  /** How far round the race a racer is, for ordering. */
  progress(r: Racer) {
    if (r.finished) return 1e9 - r.finishTime;
    // On the grid (lap 0) the racer is just short of the line.
    const s = r.lap === 0 && r.s > this.track.length / 2 ? r.s - this.track.length : r.s;
    return Math.max(0, r.lap - 1) * this.track.length + s;
  }

  standings() {
    return [...this.racers].sort((a, b) => this.progress(b) - this.progress(a));
  }

  position(r: Racer) {
    return this.standings().indexOf(r) + 1;
  }

  hud(r: Racer) {
    const lap = Math.min(Math.max(r.lap, 1), this.laps);
    const time = r.finished ? r.finishTime : Math.max(0, this.clock);
    return `LAP <b>${lap}/${this.laps}</b> &nbsp; <b>${ordinal(this.position(r))}</b>/${this.racers.length} &nbsp; ${clockText(time)}`;
  }

  results(): ResultsTable {
    return {
      title: 'Race Results',
      head: ['', 'Rider', 'Time', 'Best lap'],
      rows: this.standings().map((r, i) => ({
        me: r.human,
        cells: [String(i + 1), r.name, r.finished ? clockText(r.finishTime) : 'racing', Number.isFinite(r.bestLap) ? clockText(r.bestLap) : '-'],
      })),
    };
  }
}
