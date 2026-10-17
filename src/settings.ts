import type { CameraMode } from './camera.ts';
import type { BikeColour } from './gltfBikeModel.ts';

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
