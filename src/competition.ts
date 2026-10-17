
// What every kind of event (track race, Baja, Stunt Quarry) offers the HUD, results and session.

/** What an event needs from a rider: where their bike is and their stunt score. Riders on this
 * machine (Player) and riders seen over the network both fit. */
export interface Contestant {
  bike: { body: { translation(): { x: number; y: number; z: number } } };
  stunts: { total: number };
}

export interface Racer {
  name: string;
  player: Contestant;
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
  /** Multiplayer: simulated on another machine, which says when they finish. */
  remote?: boolean;
  /** A remote racer has crossed the line here; waiting for their machine's word. */
  pending?: boolean;
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
  add(name: string, player: Contestant, human: boolean): void;
  /** Per physics step, after the world has moved. */
  update(dt: number): void;
  standings(): Racer[];
  position(r: Racer): number;
  /** Multiplayer: a remote racer's own machine says they finished, at `time` on its clock. */
  finishRacer?(r: Racer, time: number): void;
  /** Top-bar HUD text (HTML) for a racer. */
  hud(r: Racer): string;
  results(): ResultsTable;
}

export function newRacer(name: string, player: Contestant, human: boolean, s = 0): Racer {
  return { name, player, human, s, lap: 0, nextCheckpoint: 0, finished: false, finishTime: 0, lapStart: 0, bestLap: Infinity };
}
