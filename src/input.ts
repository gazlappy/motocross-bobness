export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  leanForward: number; // -1 (back) .. 1 (forward)
  leanSide: number; // -1 (left) .. 1 (right)
}

type Action = 'reset' | 'camera' | 'shiftUp' | 'shiftDown' | 'toggleAuto' | 'help' | 'mute';

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
const PAD_ACTIONS: Record<number, Action> = { 3: 'reset', 1: 'camera', 5: 'shiftUp', 4: 'shiftDown' };

const deadzone = (v: number, dz = 0.15) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));

export class Input {
  private keys = new Set<string>();
  private pending: Action[] = [];
  private padPrev: boolean[] = [];
  private steerSmooth = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
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
