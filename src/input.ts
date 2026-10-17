export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  leanForward: number; // -1 (back) .. 1 (forward)
  leanSide: number; // -1 (left) .. 1 (right)
  /** Stunt button held: 0 none, 1 (Space / pad A) or 2 (Shift / pad X). */
  stunt?: 0 | 1 | 2;
  /** Direction picking the trick while a stunt button is held. */
  stuntDir?: StuntDir;
}

export type StuntDir = 'none' | 'up' | 'down' | 'left' | 'right';

function toDir(forward: number, side: number): StuntDir {
  if (Math.abs(forward) < 0.4 && Math.abs(side) < 0.4) return 'none';
  if (Math.abs(forward) >= Math.abs(side)) return forward > 0 ? 'up' : 'down';
  return side > 0 ? 'right' : 'left';
}

type Action = 'reset' | 'camera' | 'shiftUp' | 'shiftDown' | 'toggleAuto' | 'help' | 'mute' | 'pause';

const KEY_ACTIONS: Record<string, Action> = {
  KeyR: 'reset',
  KeyC: 'camera',
  KeyE: 'shiftUp',
  KeyQ: 'shiftDown',
  KeyM: 'toggleAuto',
  KeyH: 'help',
  KeyN: 'mute',
};

// Standard gamepad mapping button indices.
// (Esc on the keyboard is handled by the menu itself.)
const PAD_ACTIONS: Record<number, Action> = { 3: 'reset', 1: 'camera', 5: 'shiftUp', 4: 'shiftDown', 9: 'pause' };

const deadzone = (v: number, dz = 0.15) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));

export class Input {
  private keys = new Set<string>();
  private pending: Action[] = [];
  private padPrev: boolean[] = [];
  private steerSmooth = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code.startsWith('Shift')) e.preventDefault();
      if (!e.repeat && KEY_ACTIONS[e.code]) this.pending.push(KEY_ACTIONS[e.code]);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c)) ? 1 : 0;
  }

  /** Read the current control state. `dt` smooths digital steering so keyboard play isn't twitchy. */
  read(dt: number): Controls {
    const keySteer = this.down('KeyD') - this.down('KeyA');
    const rate = keySteer === 0 ? 6 : 3.5;
    this.steerSmooth += Math.max(-rate * dt, Math.min(rate * dt, keySteer - this.steerSmooth));

    const c: Controls = {
      throttle: this.down('KeyW'),
      brake: this.down('KeyS'),
      steer: this.steerSmooth,
      leanForward: this.down('ArrowUp') - this.down('ArrowDown'),
      leanSide: this.down('ArrowRight') - this.down('ArrowLeft'),
    };

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      const sx = deadzone(pad.axes[0] ?? 0);
      const rx = deadzone(pad.axes[2] ?? 0);
      const ry = deadzone(pad.axes[3] ?? 0);
      c.throttle = Math.max(c.throttle, rt);
      c.brake = Math.max(c.brake, lt);
      if (sx !== 0) c.steer = sx;
      if (ry !== 0) c.leanForward = -ry;
      if (rx !== 0) c.leanSide = rx;
      pad.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i] && PAD_ACTIONS[i]) this.pending.push(PAD_ACTIONS[i]);
        this.padPrev[i] = b.pressed;
      });
      if (pad.buttons[0]?.pressed) c.stunt = 1;
      else if (pad.buttons[2]?.pressed) c.stunt = 2;
    }

    // Holding a stunt button turns the lean controls into the trick selector, as in the original.
    if (!c.stunt) c.stunt = this.down('Space') ? 1 : this.down('ShiftLeft', 'ShiftRight') ? 2 : 0;
    if (c.stunt) {
      c.stuntDir = toDir(c.leanForward, c.leanSide);
      c.leanForward = 0;
      c.leanSide = 0;
    }
    return c;
  }

  /** One-shot actions pressed since the last call. */
  takeActions(): Action[] {
    const a = this.pending;
    this.pending = [];
    return a;
  }
}
