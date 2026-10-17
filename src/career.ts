import { BIKES, type BikeId } from './bikes.ts';
import type { BikeColour } from './gltfBikeModel.ts';
import type { Difficulty } from './settings.ts';
import type { SessionConfig } from './session.ts';
import type { VenueId } from './venue.ts';

// Career: seasons of six events against the same six rivals, in three tiers. Finishing places
// earn championship points and prize money; the money buys bikes, and a top-three championship
// unlocks the next tier. Saved in the browser.

export interface Tier {
  name: string;
  difficulty: Difficulty;
  /** What the rivals ride. */
  rivalBike: BikeId;
  /** Bikes allowed in. */
  eligible: BikeId[];
  /** Prize money multiplier. */
  purse: number;
  /** Extra laps on every race. */
  extraLaps: number;
}

export const TIERS: Tier[] = [
  { name: 'Rookie Series', difficulty: 'easy', rivalBike: '125', eligible: ['125', '250', '250f'], purse: 1, extraLaps: 0 },
  { name: 'Pro Series', difficulty: 'medium', rivalBike: '250', eligible: ['250', '250f'], purse: 2, extraLaps: 0 },
  { name: 'Champions Cup', difficulty: 'hard', rivalBike: '250f', eligible: ['250', '250f'], purse: 3, extraLaps: 1 },
];

export interface CareerEvent {
  name: string;
  mode: 'race' | 'baja' | 'quarry';
  venue: VenueId;
  laps: number;
  /** Stunt Quarry: seconds. A bonus round: cash only, no points. */
  duration: number;
}

export const SEASON: CareerEvent[] = [
  { name: 'Nationals Opener', mode: 'race', venue: 'nationals', laps: 2, duration: 0 },
  { name: 'Supercross Round', mode: 'race', venue: 'supercross', laps: 3, duration: 0 },
  { name: 'Baja Run', mode: 'baja', venue: 'baja', laps: 1, duration: 0 },
  { name: 'Stunt Quarry Bonus', mode: 'quarry', venue: 'quarry', laps: 1, duration: 120 },
  { name: 'Supercross Main', mode: 'race', venue: 'supercross', laps: 4, duration: 0 },
  { name: 'Nationals Final', mode: 'race', venue: 'nationals', laps: 3, duration: 0 },
];

export const POINTS = [25, 20, 16, 13, 11, 10, 9];
const PRIZE = [1500, 1000, 700, 500, 350, 250, 150];
const CHAMPIONSHIP_BONUS = [5000, 2500, 1500];
/** Stunt Quarry bonus: dollars per stunt point (before the tier's purse). */
const STUNT_RATE = 0.25;
const KEY = 'motocross-bobness:career';

export interface Season {
  tier: number;
  /** Index into SEASON of the next event; SEASON.length when the season is over. */
  next: number;
  /** The field, you first. Fixed for the season so the championship adds up. */
  riders: string[];
  points: Record<string, number>;
  colour: BikeColour;
  /** What each event paid you, for the season summary. */
  log: { event: string; place: number | null; points: number; cash: number }[];
}

export interface Career {
  cash: number;
  owned: BikeId[];
  bike: BikeId;
  /** Highest tier you may enter. */
  unlocked: number;
  season: Season | null;
  titles: string[];
}

export const YOU = 'You';

export function newCareer(): Career {
  return { cash: 0, owned: ['125'], bike: '125', unlocked: 0, season: null, titles: [] };
}

export function loadCareer(): Career {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...newCareer(), ...JSON.parse(raw) };
  } catch {
    // Fall through to a fresh career.
  }
  return newCareer();
}

export function saveCareer(c: Career) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Not saved; play on.
  }
}

export function canEnter(c: Career, tier: number) {
  return tier <= c.unlocked && TIERS[tier].eligible.includes(c.bike);
}

/** Start a season in `tier` against `rivals` (names, in grid order). */
export function startSeason(c: Career, tier: number, rivals: string[], colour: BikeColour) {
  const riders = [YOU, ...rivals];
  c.season = { tier, next: 0, riders, points: Object.fromEntries(riders.map((r) => [r, 0])), colour, log: [] };
}

export function currentEvent(c: Career): CareerEvent | null {
  const s = c.season;
  return s && s.next < SEASON.length ? SEASON[s.next] : null;
}

/** The game to start for the season's next event. */
export function eventConfig(c: Career): SessionConfig {
  const s = c.season!;
  const tier = TIERS[s.tier];
  const e = SEASON[s.next];
  return {
    mode: e.mode,
    venue: e.venue,
    laps: e.mode === 'race' ? e.laps + tier.extraLaps : 1,
    opponents: s.riders.length - 1,
    difficulty: tier.difficulty,
    colour: s.colour,
    duration: e.duration,
    bike: c.bike,
    rivalBike: tier.rivalBike,
    rivals: s.riders.slice(1),
  };
}

export interface EventPayout {
  event: string;
  place: number | null;
  points: number;
  cash: number;
  /** Set when that was the season's last event. */
  final: { position: number; bonus: number; unlocked: string | null; title: string | null } | null;
}

/**
 * Bank an event. `order` is every rider's name in finishing order (races), or null for the stunt
 * bonus round, which pays on `stuntScore`.
 */
export function recordEvent(c: Career, order: string[] | null, stuntScore = 0): EventPayout {
  const s = c.season!;
  const tier = TIERS[s.tier];
  const e = SEASON[s.next];
  let place: number | null = null;
  let points = 0;
  let cash: number;
  if (order) {
    order.forEach((name, i) => {
      if (name in s.points) s.points[name] += POINTS[i] ?? 0;
    });
    place = order.indexOf(YOU) + 1;
    points = POINTS[place - 1] ?? 0;
    cash = (PRIZE[place - 1] ?? 0) * tier.purse;
  } else {
    cash = Math.round((stuntScore * STUNT_RATE * tier.purse) / 10) * 10;
  }
  c.cash += cash;
  s.log.push({ event: e.name, place, points, cash });
  s.next++;

  let final: EventPayout['final'] = null;
  if (s.next >= SEASON.length) {
    const position = standings(c).indexOf(YOU) + 1;
    const bonus = (CHAMPIONSHIP_BONUS[position - 1] ?? 0) * tier.purse;
    c.cash += bonus;
    let unlocked: string | null = null;
    if (position <= 3 && s.tier + 1 < TIERS.length && c.unlocked <= s.tier) {
      c.unlocked = s.tier + 1;
      unlocked = TIERS[c.unlocked].name;
    }
    const title = position === 1 ? `${tier.name} champion` : null;
    if (title) c.titles.push(title);
    final = { position, bonus, unlocked, title };
  }
  saveCareer(c);
  return { event: e.name, place, points, cash, final };
}

/** Championship order, leader first. */
export function standings(c: Career) {
  const s = c.season!;
  return [...s.riders].sort((a, b) => s.points[b] - s.points[a] || (a === YOU ? -1 : b === YOU ? 1 : 0));
}

export function buyBike(c: Career, id: BikeId) {
  const price = BIKES[id].price;
  if (c.owned.includes(id) || c.cash < price) return false;
  c.cash -= price;
  c.owned.push(id);
  c.bike = id;
  saveCareer(c);
  return true;
}

export function rideBike(c: Career, id: BikeId) {
  if (!c.owned.includes(id)) return;
  c.bike = id;
  saveCareer(c);
}

export function money(n: number) {
  return `$${n.toLocaleString('en-US')}`;
}
