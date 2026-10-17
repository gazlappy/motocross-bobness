import type { BikeId } from '../bikes.ts';
import type { BikeColour } from '../gltfBikeModel.ts';
import type { Difficulty } from '../settings.ts';
import type { VenueId } from '../venue.ts';

// Everything that goes over the wire. Clients talk only to the host; the host relays riders'
// snapshots to everyone else and decides the rest (lobby, start, tags).

export interface PlayerInfo {
  id: string;
  name: string;
  colour: BikeColour;
  bike: BikeId;
}

export type NetMode = 'race' | 'baja' | 'tag' | 'freeride';

export interface NetSetup {
  mode: NetMode;
  venue: VenueId;
  laps: number;
  /** AI riders the host fills the grid with (races only). */
  ai: number;
  difficulty: Difficulty;
  /** Tag: seconds. */
  duration: number;
}

/** One bike in a networked game: a player's, or an AI rider simulated by the host (`owner`). */
export interface RosterEntry {
  id: string;
  owner: string;
  name: string;
  colour: BikeColour;
  bike: BikeId;
  slot: number;
  ai: boolean;
}

export type Msg =
  | { t: 'hello'; info: PlayerInfo }
  | { t: 'lobby'; host: string; players: PlayerInfo[]; setup: NetSetup; inGame: boolean }
  | { t: 'start'; setup: NetSetup; roster: RosterEntry[] }
  | { t: 'ready'; id: string }
  | { t: 'go' }
  | { t: 'snap'; id: string; s: number[] }
  | { t: 'finish'; id: string; time: number }
  | { t: 'tag'; it: string; times: Record<string, number> }
  | { t: 'end' }
  | { t: 'bye'; id: string };
