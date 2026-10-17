import type { Bindings, KeyAction, PadInput } from './bindings.ts';

export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  leanForward: number; // -1 (back) .. 1 (forward)
  leanSide: number; // -1 (left) .. 1 (right)
  /** Stunt button held: 0 none, 1 or 2. */
  stunt?: 0 | 1 | 2;
  /** Direction picking the trick while a stunt button is held. */
  stuntDir?: StuntDir;
  /** The rider's lean came from the player this frame (Easy controls leave it alone then). */
  leanByHand?: boolean;
}

export type StuntDir = 'none' | 'up' | 'down' | 'left' | 'right';

function toDir(forward: number, side: number): StuntDir {
  if (Math.abs(forward) < 0.4 && Math.abs(side) < 0.4) return 'none';
  if (Math.abs(forward) >= Math.abs(side)) return forward > 0 ? 'up' : 'down';
  return side > 0 ? 'right' : 'left';
}

export type Action = 'reset' | 'camera' | 'shiftUp' | 'shiftDown' | 'toggleAuto' | 'help' | 'mute' | 'pause';
const ONE_SHOT: Action[] = ['reset', 'camera', 'shiftUp', 'shiftDown', 'toggleAuto', 'help', 'mute'];

const deadzone = (v: number, dz = 0.15) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));

/** The first connected gamepad, if any. */
export function activePad() {
  return navigator.getGamepads?.().find((p) => p && p.connected) ?? null;
}

/** A gamepad input's value: buttons 0..1, axes -1..1 (deadzoned, inverted if asked). */
function padValue(pad: Gamepad, p: PadInput | null) {
  if (!p) return 0;
  if (p.kind === 'button') return pad.buttons[p.index]?.value ?? 0;
  const v = deadzone(pad.axes[p.index] ?? 0);
  return p.invert ? -v : v;
}

export class Input {
  private keys = new Set<string>();
  private pending: Action[] = [];
  private padPrev: boolean[] = [];
  private steerSmooth = 0;
  readonly bindings: Bindings;

  constructor(bindings: Bindings) {
    this.bindings = bindings;
    window.addEventListener('keydown', (e) => {
      // Typing in a text box (your multiplayer name, a room code) isn't riding.
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code.startsWith('Shift')) e.preventDefault();
      if (!e.repeat) {
        for (const a of ONE_SHOT) if (this.bindings.keys[a as KeyAction]?.includes(e.code)) this.pending.push(a);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private down(action: KeyAction) {
    return this.bindings.keys[action].some((c) => this.keys.has(c)) ? 1 : 0;
  }

  /** Read the current control state. `dt` smooths digital steering so keyboard play isn't twitchy. */
  read(dt: number): Controls {
    const keySteer = this.down('steerRight') - this.down('steerLeft');
    const rate = keySteer === 0 ? 6 : 3.5;
    this.steerSmooth += Math.max(-rate * dt, Math.min(rate * dt, keySteer - this.steerSmooth));

    const c: Controls = {
      throttle: this.down('throttle'),
      brake: this.down('brake'),
      steer: this.steerSmooth,
      leanForward: this.down('leanForward') - this.down('leanBack'),
      leanSide: this.down('leanRight') - this.down('leanLeft'),
    };

    const pad = activePad();
    if (pad) {
      const { analog, buttons } = this.bindings.pad;
      c.throttle = Math.max(c.throttle, Math.max(0, padValue(pad, analog.throttle)));
      c.brake = Math.max(c.brake, Math.max(0, padValue(pad, analog.brake)));
      const sx = padValue(pad, analog.steer);
      const fb = padValue(pad, analog.leanFB);
      const lr = padValue(pad, analog.leanLR);
      if (sx !== 0) c.steer = sx;
      if (fb !== 0) c.leanForward = fb;
      if (lr !== 0) c.leanSide = lr;
      pad.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i]) {
          for (const [action, index] of Object.entries(buttons)) {
            if (index === i && action !== 'stunt1' && action !== 'stunt2') this.pending.push(action as Action);
          }
        }
        this.padPrev[i] = b.pressed;
      });
      if (buttons.stunt1 !== null && pad.buttons[buttons.stunt1]?.pressed) c.stunt = 1;
      else if (buttons.stunt2 !== null && pad.buttons[buttons.stunt2]?.pressed) c.stunt = 2;
    }
    c.leanByHand = c.leanForward !== 0 || c.leanSide !== 0;

    // Holding a stunt button turns the lean controls into the trick selector, as in the original.
    if (!c.stunt) c.stunt = this.down('stunt1') ? 1 : this.down('stunt2') ? 2 : 0;
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

