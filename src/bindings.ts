// Which keys and gamepad inputs do what. Every keyboard action takes a main and an alternate key;
// the gamepad maps each analogue control to a stick axis or trigger, and each action to a button.
// Saved in the browser, separately from the other options.

export type KeyAction =
  | 'throttle' | 'brake' | 'steerLeft' | 'steerRight'
  | 'leanForward' | 'leanBack' | 'leanLeft' | 'leanRight'
  | 'stunt1' | 'stunt2'
  | 'shiftUp' | 'shiftDown' | 'toggleAuto' | 'reset' | 'camera' | 'help' | 'mute' | 'toggleRetro';

export const KEY_ACTIONS: { id: KeyAction; label: string }[] = [
  { id: 'throttle', label: 'Throttle' },
  { id: 'brake', label: 'Brake' },
  { id: 'steerLeft', label: 'Steer left' },
  { id: 'steerRight', label: 'Steer right' },
  { id: 'leanForward', label: 'Lean forward' },
  { id: 'leanBack', label: 'Lean back' },
  { id: 'leanLeft', label: 'Lean left' },
  { id: 'leanRight', label: 'Lean right' },
  { id: 'stunt1', label: 'Stunt button 1' },
  { id: 'stunt2', label: 'Stunt button 2' },
  { id: 'shiftUp', label: 'Shift up' },
  { id: 'shiftDown', label: 'Shift down' },
  { id: 'toggleAuto', label: 'Auto / manual gears' },
  { id: 'reset', label: 'Reset / skip wipeout' },
  { id: 'camera', label: 'Change camera' },
  { id: 'help', label: 'Show / hide help' },
  { id: 'mute', label: 'Mute' },
  { id: 'toggleRetro', label: 'Retro / realistic ground' },
];

/** A gamepad input: a button, or one direction (or both) of an axis. */
export type PadInput =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; invert: boolean };

export type PadAnalog = 'throttle' | 'brake' | 'steer' | 'leanFB' | 'leanLR';
export type PadButton = 'stunt1' | 'stunt2' | 'reset' | 'camera' | 'shiftUp' | 'shiftDown' | 'toggleAuto' | 'pause' | 'toggleRetro';

export const PAD_ANALOG: { id: PadAnalog; label: string; twoWay: boolean }[] = [
  { id: 'throttle', label: 'Throttle', twoWay: false },
  { id: 'brake', label: 'Brake', twoWay: false },
  { id: 'steer', label: 'Steer', twoWay: true },
  { id: 'leanFB', label: 'Lean forward / back', twoWay: true },
  { id: 'leanLR', label: 'Lean left / right', twoWay: true },
];

export const PAD_BUTTONS: { id: PadButton; label: string }[] = [
  { id: 'stunt1', label: 'Stunt button 1' },
  { id: 'stunt2', label: 'Stunt button 2' },
  { id: 'reset', label: 'Reset / skip wipeout' },
  { id: 'camera', label: 'Change camera' },
  { id: 'shiftUp', label: 'Shift up' },
  { id: 'shiftDown', label: 'Shift down' },
  { id: 'toggleAuto', label: 'Auto / manual gears' },
  { id: 'pause', label: 'Pause / menu' },
  { id: 'toggleRetro', label: 'Retro / realistic ground' },
];

export interface Bindings {
  keys: Record<KeyAction, string[]>;
  pad: {
    analog: Record<PadAnalog, PadInput | null>;
    buttons: Record<PadButton, number | null>;
  };
}

/** Standard gamepad layout (Xbox names): RT/LT gas and brake, left stick steer, right stick lean. */
export function defaultBindings(): Bindings {
  return {
    keys: {
      throttle: ['KeyW'], brake: ['KeyS'], steerLeft: ['KeyA'], steerRight: ['KeyD'],
      leanForward: ['ArrowUp'], leanBack: ['ArrowDown'], leanLeft: ['ArrowLeft'], leanRight: ['ArrowRight'],
      stunt1: ['Space'], stunt2: ['ShiftLeft', 'ShiftRight'],
      shiftUp: ['KeyE'], shiftDown: ['KeyQ'], toggleAuto: ['KeyM'], reset: ['KeyR'], camera: ['KeyC'], help: ['KeyH'], mute: ['KeyN'],
      toggleRetro: ['KeyG'],
    },
    pad: {
      analog: {
        throttle: { kind: 'button', index: 7 },
        brake: { kind: 'button', index: 6 },
        steer: { kind: 'axis', index: 0, invert: false },
        leanFB: { kind: 'axis', index: 3, invert: true },
        leanLR: { kind: 'axis', index: 2, invert: false },
      },
      buttons: { stunt1: 0, stunt2: 2, reset: 3, camera: 1, shiftUp: 5, shiftDown: 4, toggleAuto: null, pause: 9, toggleRetro: null },
    },
  };
}

const KEY = 'motocross-bobness:controls';

export function loadBindings(): Bindings {
  const b = defaultBindings();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Bindings> | null;
    if (saved?.keys) for (const a of KEY_ACTIONS) if (Array.isArray(saved.keys[a.id])) b.keys[a.id] = saved.keys[a.id].slice(0, 2);
    if (saved?.pad?.analog) Object.assign(b.pad.analog, saved.pad.analog);
    if (saved?.pad?.buttons) Object.assign(b.pad.buttons, saved.pad.buttons);
  } catch {
    // Defaults it is.
  }
  return b;
}

export function saveBindings(b: Bindings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // Not saved; they still apply until the page closes.
  }
}

/**
 * Give `action` the key `code` in `slot` (0 main, 1 alternate). A key does one thing: it comes off
 * any other action that had it. Returns the action it was taken from, if any.
 */
export function bindKey(b: Bindings, action: KeyAction, slot: number, code: string): KeyAction | null {
  let taken: KeyAction | null = null;
  for (const a of KEY_ACTIONS) {
    const list = b.keys[a.id];
    const i = list.indexOf(code);
    if (i >= 0 && !(a.id === action && i === slot)) {
      list.splice(i, 1);
      if (a.id !== action) taken = a.id;
    }
  }
  const list = b.keys[action];
  if (slot >= list.length) list.push(code);
  else list[slot] = code;
  return taken;
}

export function unbindKey(b: Bindings, action: KeyAction, slot: number) {
  b.keys[action].splice(slot, 1);
}

/** Give a pad button to `action`, taking it off any other button action. */
export function bindPadButton(b: Bindings, action: PadButton, index: number) {
  for (const p of PAD_BUTTONS) if (b.pad.buttons[p.id] === index) b.pad.buttons[p.id] = null;
  b.pad.buttons[action] = index;
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'Caps', Semicolon: ';', Quote: "'", Comma: ',',
  Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
};

export function keyName(code: string) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** Standard-mapping button names (Xbox layout). */
const PAD_BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L stick', 'R stick', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];
const AXIS_NAMES = ['Left stick ↔', 'Left stick ↕', 'Right stick ↔', 'Right stick ↕'];

export function padButtonName(i: number | null) {
  return i === null ? '-' : PAD_BUTTON_NAMES[i] ?? `Button ${i}`;
}

export function padInputName(p: PadInput | null) {
  if (!p) return '-';
  if (p.kind === 'button') return padButtonName(p.index);
  return `${AXIS_NAMES[p.index] ?? `Axis ${p.index}`}${p.invert ? ' (inverted)' : ''}`;
}

/** The keys for an action as text, e.g. "W" or "L Shift / R Shift". */
export function keysText(b: Bindings, action: KeyAction) {
  return b.keys[action].map(keyName).join('/') || '-';
}
