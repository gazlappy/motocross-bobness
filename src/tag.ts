import { type Competition, type Contestant, type Racer, type ResultsTable, newRacer } from './competition.ts';
import { clockText } from './format.ts';
import { COUNTDOWN } from './race.ts';

// Tag, the original's multiplayer party game: one rider is "it" and racks up time until they ride
// into someone else, who becomes it. Least time spent as it when the clock runs out wins. Only the
// host decides tags (everyone's view of a near miss differs); the others follow its calls.

const TAG_DISTANCE = 3; // m between bikes
const TAG_PAUSE = 3; // s after a tag before the next one can happen
const NO_TAG_BACKS = 10; // s before the new it can tag the rider who just got them

export class TagGame implements Competition {
  readonly racers: Racer[] = [];
  readonly duration: number;
  clock = -COUNTDOWN;
  onLap?: (racer: Racer, lap: number, lapTime: number) => void;
  onFinish?: (racer: Racer, place: number) => void;
  /** The host's game makes the calls. */
  referee: boolean;
  /** Host: a tag happened (or the first "it" was picked). */
  onTag?: (it: Racer, by: Racer | null) => void;
  it: Racer | null = null;
  readonly timeIt = new Map<Racer, number>();
  readonly ids = new Map<Racer, string>();
  private lastTag = -Infinity;
  private lastTagger: Racer | null = null;
  private over = false;

  constructor(duration: number, referee: boolean) {
    this.duration = duration;
    this.referee = referee;
  }

  get started() {
    return this.clock >= 0;
  }

  add(name: string, player: Contestant, human: boolean) {
    const r = newRacer(name, player, human);
    this.racers.push(r);
    this.timeIt.set(r, 0);
  }

  /** The network id behind a racer, for the host's announcements. */
  identify(r: Racer, id: string) {
    this.ids.set(r, id);
  }

  byId(id: string) {
    return this.racers.find((r) => this.ids.get(r) === id) ?? null;
  }

  update(dt: number) {
    this.clock += dt;
    if (!this.started || this.over) return;
    if (this.clock >= this.duration) {
      this.over = true;
      for (const r of this.racers) {
        r.finished = true;
        r.finishTime = this.duration;
      }
      for (const r of this.racers) this.onFinish?.(r, this.position(r));
      return;
    }
    if (this.it) this.timeIt.set(this.it, this.timeIt.get(this.it)! + dt);
    if (!this.referee) return;

    if (!this.it) {
      this.tag(this.racers[Math.floor(Math.random() * this.racers.length)], null);
      return;
    }
    const since = this.clock - this.lastTag;
    if (since < TAG_PAUSE) return;
    const a = this.it.player.bike.body.translation();
    for (const r of this.racers) {
      if (r === this.it || (r === this.lastTagger && since < NO_TAG_BACKS)) continue;
      const b = r.player.bike.body.translation();
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < TAG_DISTANCE) {
        this.tag(r, this.it);
        return;
      }
    }
  }

  private tag(r: Racer, by: Racer | null) {
    this.it = r;
    this.lastTagger = by;
    this.lastTag = this.clock;
    this.onTag?.(r, by);
  }

  /** Follow the host's call: who's it, and everyone's time so far. */
  applyTag(itId: string, times: Record<string, number>) {
    const it = this.byId(itId);
    if (it && it !== this.it) this.lastTag = this.clock;
    this.it = it;
    for (const r of this.racers) {
      const id = this.ids.get(r);
      if (id && id in times) this.timeIt.set(r, times[id]);
    }
  }

  /** Everyone's time as it, by network id, for the host to send. */
  times() {
    const out: Record<string, number> = {};
    for (const [r, t] of this.timeIt) {
      const id = this.ids.get(r);
      if (id) out[id] = Math.round(t * 100) / 100;
    }
    return out;
  }

  standings() {
    return [...this.racers].sort((a, b) => this.timeIt.get(a)! - this.timeIt.get(b)!);
  }

  position(r: Racer) {
    return this.standings().indexOf(r) + 1;
  }

  hud(r: Racer) {
    const left = Math.max(0, this.duration - Math.max(0, this.clock));
    const who = !this.it ? 'TAG' : this.it === r ? "<b>YOU'RE IT!</b>" : `IT: <b>${this.it.name}</b>`;
    return `${who} &nbsp; YOUR TIME <b>${clockText(this.timeIt.get(r) ?? 0)}</b> &nbsp; LEFT <b>${clockText(left)}</b>`;
  }

  results(): ResultsTable {
    return {
      title: 'Tag Results',
      head: ['', 'Rider', 'Time as it'],
      rows: this.standings().map((r, i) => ({ me: r.human, cells: [String(i + 1), r.name, clockText(this.timeIt.get(r)!)] })),
    };
  }
}
