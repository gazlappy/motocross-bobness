import type { CameraMode } from './camera.ts';
import type { BikeColour } from './gltfBikeModel.ts';
import type { VenueId } from './venue.ts';
import type { BikeId } from './bikes.ts';

// Player options and the last race setup, kept in the browser between visits. Storage can be
// unavailable (private windows, blocked site data), so every read and write is best-effort.

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Settings {
  volume: number; // 0..1
  muted: boolean;
  units: 'mph' | 'kmh';
  gearbox: 'auto' | 'manual';
  camera: CameraMode;
  shadows: boolean;
  resolution: number; // fraction of the screen's pixel ratio
  showHelp: boolean;
  // Last race setup.
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  colour: BikeColour;
  /** Stunt Quarry session length, seconds. */
  duration: number;
  /** Where Free Ride takes place. */
  freeVenue: VenueId;
  /** Bike for single events (career has its own garage). */
  bike: BikeId;
  /** Your name in multiplayer. */
  playerName: string;
  /** Easy: the rider shifts their own weight. Advanced: you do, as in the original. */
  controlScheme: 'easy' | 'advanced';
  /** The detailed Honda CRF 450, or the original low-detail bike. */
  bikeModel: 'crf450' | 'classic';
  /** Retro: the original flat-coloured ground instead of the realistic one. */
  retro: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  muted: false,
  units: 'mph',
  gearbox: 'auto',
  camera: 'chase',
  shadows: true,
  resolution: 1,
  showHelp: true,
  laps: 3,
  opponents: 6,
  difficulty: 'medium',
  colour: 'red',
  duration: 120,
  freeVenue: 'nationals',
  bike: '250',
  playerName: 'Rider',
  controlScheme: 'advanced',
  bikeModel: 'crf450',
  retro: false,
};

const KEY = 'motocross-bobness:settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not saved this time; the game still works.
  }
}
