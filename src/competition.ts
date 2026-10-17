import type { Player } from './player.ts';

// What every kind of event (track race, Baja, Stunt Quarry) offers the HUD, results and session.

export interface Racer {
  name: string;
  player: Player;
  human: boolean;
  /** Track races: distance along the track. */
  s: number;
  /** Track races: 0 on the grid, 1 once over the line. Baja: waypoints reached. */
  lap: number;
  nextCheckpoint: number;
  finished: boolean;
  finishTime: number;
  lapStart: number;
  bestLap: number;
}

export interface ResultsTable {
  title: string;
  head: string[];
  rows: { me: boolean; cells: string[] }[];
}

export interface Competition {
  readonly racers: Racer[];
  /** Seconds since GO (negative during the countdown). */
  clock: number;
  readonly started: boolean;
  onLap?: (racer: Racer, lap: number, lapTime: number) => void;
  onFinish?: (racer: Racer, place: number) => void;
  add(name: string, player: Player, human: boolean): void;
  /** Per physics step, after the world has moved. */
  update(dt: number): void;
  standings(): Racer[];
  position(r: Racer): number;
  /** Top-bar HUD text (HTML) for a racer. */
  hud(r: Racer): string;
  results(): ResultsTable;
}

export function newRacer(name: string, player: Player, human: boolean, s = 0): Racer {
  return { name, player, human, s, lap: 0, nextCheckpoint: 0, finished: false, finishTime: 0, lapStart: 0, bestLap: Infinity };
}
