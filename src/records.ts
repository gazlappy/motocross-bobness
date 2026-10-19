// Track records, as in the original: your best lap and best race time on each track, and your best
// Baja time, kept in the browser. (Stunt Quarry bests live with the stunt challenge.)

const KEY = 'motocross-bobness:records';

export interface TrackRecords {
  /** Best single lap, seconds. */
  lap?: number;
  /** Best race time by number of laps, seconds. */
  race?: Record<string, number>;
  /** Best Baja finish, seconds. */
  baja?: number;
}

function load(): Record<string, TrackRecords> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function save(all: Record<string, TrackRecords>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not kept; still shown for this visit.
  }
}

export function recordsFor(track: string): TrackRecords {
  return load()[track] ?? {};
}

/** Note a lap; true if it's a new record. */
export function recordLap(track: string, time: number) {
  const all = load();
  const r = (all[track] ??= {});
  if (r.lap !== undefined && r.lap <= time) return false;
  r.lap = time;
  save(all);
  return true;
}

/** Note a finished race (or Baja run); true if it's a new record. */
export function recordFinish(track: string, time: number, laps: number | null) {
  const all = load();
  const r = (all[track] ??= {});
  if (laps === null) {
    if (r.baja !== undefined && r.baja <= time) return false;
    r.baja = time;
  } else {
    r.race ??= {};
    const best = r.race[String(laps)];
    if (best !== undefined && best <= time) return false;
    r.race[String(laps)] = time;
  }
  save(all);
  return true;
}
