import { type SxTrack, problems, randomTrack } from './sxTrack.ts';
import type { StadiumId } from './venues/supercross.ts';

// Every supercross track you can pick: the classic layout, the 1998 Season's fifteen rounds (named
// after the original season's cities; the layouts are our own), and the ones you've built.

export const SEASON_ROUNDS: { city: string; stadium: StadiumId }[] = [
  { city: 'San Diego', stadium: 'square-night' },
  { city: 'Indianapolis', stadium: 'dome' },
  { city: 'Phoenix', stadium: 'square-night' },
  { city: 'Minneapolis', stadium: 'dome' },
  { city: 'Denver', stadium: 'square-day' },
  { city: 'Houston', stadium: 'dome' },
  { city: 'Pittsburgh', stadium: 'square-night' },
  { city: 'Detroit', stadium: 'dome' },
  { city: 'Seattle', stadium: 'dome' },
  { city: 'Boston', stadium: 'square-night' },
  { city: 'Atlanta', stadium: 'square-night' },
  { city: 'Tampa Bay', stadium: 'square-day' },
  { city: 'Charlotte', stadium: 'square-night' },
  { city: 'Cleveland', stadium: 'square-day' },
  { city: 'Dallas', stadium: 'square-night' },
];

/** Round `i` of the Season (0-based): its own track, the same every time. */
export function seasonTrack(i: number): SxTrack {
  return randomTrack(1998 + i * 31, `Week ${String(i + 1).padStart(2, '0')} - ${SEASON_ROUNDS[i].city}`);
}

const KEY = 'motocross-bobness:tracks';

/** Tracks you've built and saved, newest first. */
export function userTracks(): SxTrack[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SxTrack[];
    return Array.isArray(list) ? list.filter((t) => t && Array.isArray(t.pieces) && problems(t).length === 0) : [];
  } catch {
    return [];
  }
}

export function saveUserTrack(t: SxTrack) {
  const list = userTracks().filter((x) => x.name !== t.name);
  list.unshift(t);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    // Not saved; it can still be ridden this visit.
  }
}

export function deleteUserTrack(name: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(userTracks().filter((x) => x.name !== name)));
  } catch {
    // Nothing to do.
  }
}

/** Track choices for the event screen: an id and a name. */
export function trackChoices() {
  return [
    { id: 'classic', name: 'Classic' },
    ...SEASON_ROUNDS.map((r, i) => ({ id: `season:${i}`, name: r.city })),
    ...userTracks().map((t) => ({ id: `user:${t.name}`, name: `${t.name} (yours)` })),
  ];
}

/** The track for a choice id (null: the classic layout). */
export function trackFor(id: string): SxTrack | null {
  if (id.startsWith('season:')) return seasonTrack(Number(id.slice(7)));
  if (id.startsWith('user:')) return userTracks().find((t) => t.name === id.slice(5)) ?? null;
  return null;
}
