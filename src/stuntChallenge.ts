import { type Competition, type Contestant, type Racer, type ResultsTable, newRacer } from './competition.ts';
import { clockText } from './format.ts';
import { COUNTDOWN } from './race.ts';

// Stunt Quarry: a timed session in the quarry; score as many stunt points as you can before the
// clock runs out. Your best score for each session length is kept in the browser.

const BEST_KEY = 'motocross-bobness:quarry-best';

function loadBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export class StuntChallenge implements Competition {
  readonly racers: Racer[] = [];
  readonly duration: number;
  clock = -COUNTDOWN;
  onLap?: (racer: Racer, lap: number, lapTime: number) => void;
  onFinish?: (racer: Racer, place: number) => void;
  /** Best score before this session, and whether this one beat it. */
  previousBest: number;
  newBest = false;
  private over = false;

  constructor(duration: number) {
    this.duration = duration;
    this.previousBest = loadBest()[String(duration)] ?? 0;
  }

  get started() {
    return this.clock >= 0;
  }

  add(name: string, player: Contestant, human: boolean) {
    this.racers.push(newRacer(name, player, human));
  }

  score(r: Racer) {
    return r.player.stunts.total;
  }

  update(dt: number) {
    this.clock += dt;
    if (this.clock < this.duration || this.over) return;
    this.over = true;
    for (const r of this.racers) {
      r.finished = true;
      r.finishTime = this.duration;
      if (r.human) this.recordBest(this.score(r));
    }
    for (const r of this.racers) this.onFinish?.(r, this.position(r));
  }

  private recordBest(score: number) {
    if (score <= this.previousBest) return;
    this.newBest = true;
    try {
      const best = loadBest();
      best[String(this.duration)] = score;
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch {
      // Not saved; the session still counts.
    }
  }

  standings() {
    return [...this.racers].sort((a, b) => this.score(b) - this.score(a));
  }

  position(r: Racer) {
    return this.standings().indexOf(r) + 1;
  }

  hud(r: Racer) {
    const left = r.finished ? 0 : Math.max(0, this.duration - Math.max(0, this.clock));
    const best = Math.max(this.previousBest, r.finished && this.newBest ? this.score(r) : 0);
    return `TIME <b>${clockText(left)}</b> &nbsp; SCORE <b>${this.score(r).toLocaleString()}</b> &nbsp; BEST ${best.toLocaleString()}`;
  }

  results(): ResultsTable {
    const me = this.racers.find((r) => r.human);
    const rows = this.standings().map((r, i) => ({ me: r.human, cells: [String(i + 1), r.name, this.score(r).toLocaleString()] }));
    if (me) {
      rows.push({
        me: false,
        cells: ['', this.newBest ? 'New best!' : 'Best', (this.newBest ? this.score(me) : this.previousBest).toLocaleString()],
      });
    }
    return { title: `Stunt Quarry: ${clockText(this.duration).replace(/\.0$/, '')}`, head: ['', 'Rider', 'Score'], rows };
  }
}
