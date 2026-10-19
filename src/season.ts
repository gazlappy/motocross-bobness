import type { BikeColour } from './gltfBikeModel.ts';
import type { SessionConfig } from './session.ts';
import { rivalsFor } from './session.ts';
import type { Settings } from './settings.ts';
import { SEASON_ROUNDS, seasonTrack } from './sxLibrary.ts';
import { STADIUMS } from './venues/supercross.ts';

// The 1998 Season, as in the original: fifteen rounds of supercross, a week apart, city to city,
// against the same field. Points for every finish; the most after Week 15 takes the championship.
// Progress is kept in the browser.

const KEY = 'motocross-bobness:season';
export const YOU = 'You';
/** Points by finishing place (the AMA's 1998-style spread, eight deep). */
const POINTS = [25, 22, 20, 18, 16, 15, 14, 13];

export interface SeasonState {
  /** Next round to ride, 0-based (15 when it's over). */
  round: number;
  colour: BikeColour;
  riders: string[];
  points: Record<string, number>;
  /** Your place in each round ridden. */
  results: number[];
}

export function loadSeason(): SeasonState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SeasonState | null;
    return s && Array.isArray(s.riders) ? s : null;
  } catch {
    return null;
  }
}

function save(s: SeasonState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for this visit only.
  }
}

export function newSeason(colour: BikeColour): SeasonState {
  const riders = [YOU, ...rivalsFor(colour)];
  const s: SeasonState = { round: 0, colour, riders, points: Object.fromEntries(riders.map((r) => [r, 0])), results: [] };
  save(s);
  return s;
}

export function endSeason() {
  save(null);
}

export const seasonOver = (s: SeasonState) => s.round >= SEASON_ROUNDS.length;

/** Everyone, most points first. */
export function seasonStandings(s: SeasonState) {
  return [...s.riders].sort((a, b) => s.points[b] - s.points[a]);
}

/** The next round's game. */
export function roundConfig(s: SeasonState, settings: Settings): SessionConfig {
  const r = SEASON_ROUNDS[s.round];
  return {
    mode: 'race', venue: 'supercross', laps: Math.max(3, settings.laps), opponents: s.riders.length - 1,
    difficulty: settings.difficulty, colour: s.colour, duration: 0, bike: settings.bike,
    rivals: s.riders.slice(1),
    sx: { track: seasonTrack(s.round), stadium: r.stadium },
  };
}

/** Bank a round from its finishing order; returns a summary for the results screen. */
export function recordRound(s: SeasonState, order: string[]) {
  const week = s.round + 1;
  order.forEach((name, i) => {
    if (name in s.points) s.points[name] += POINTS[i] ?? 0;
  });
  const place = order.indexOf(YOU) + 1;
  s.results.push(place);
  s.round++;
  save(s);
  const standing = seasonStandings(s).indexOf(YOU) + 1;
  return { week, place, points: POINTS[place - 1] ?? 0, total: s.points[YOU], standing, over: seasonOver(s) };
}

export function roundName(i: number) {
  const r = SEASON_ROUNDS[i];
  return `Week ${String(i + 1).padStart(2, '0')} - ${r.city}`;
}

export function stadiumName(i: number) {
  return STADIUMS.find((x) => x.id === SEASON_ROUNDS[i].stadium)?.name ?? '';
}
