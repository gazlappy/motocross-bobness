import * as THREE from 'three';
import type { Bike } from './bike.ts';
import type { Controls, StuntDir } from './input.ts';

// Mid-air stunts, as in the original: hold a stunt button, pick the trick with a direction, and
// the longer it's held fully extended the more it scores. Points bank when you land back on the
// bike; land while still mid-trick and it's a wipeout.

/** A stunt's full-extension pose, in bike space (forward -Z, up +Y, right +X). */
export interface StuntDef {
  name: string;
  /** Points per second while fully extended. */
  points: number;
  hip: THREE.Vector3;
  shoulder: THREE.Vector3;
  footL: THREE.Vector3;
  footR: THREE.Vector3;
  /** Hand targets; leave out to keep hold of the grips. */
  handL?: THREE.Vector3;
  handR?: THREE.Vector3;
  /** Which way the knees bend (bike space); defaults to forward. */
  kneeHint?: THREE.Vector3;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Written for the right-hand side; the left versions are mirrored.
const SUPERMAN: StuntDef = {
  name: 'Superman', points: 900,
  hip: v(0, 0.8, 0.38), shoulder: v(0, 0.86, 0.02),
  footL: v(-0.1, 0.86, 1.22), footR: v(0.1, 0.86, 1.22), kneeHint: v(0, -1, 0),
};
const CLIFFHANGER: StuntDef = {
  name: 'Cliffhanger', points: 1100,
  hip: v(0, 1.3, -0.2), shoulder: v(0, 1.64, -0.14),
  footL: v(-0.12, 0.62, -0.3), footR: v(0.12, 0.62, -0.3),
  handL: v(-0.42, 2.0, -0.05), handR: v(0.42, 2.0, -0.05),
};
const HEEL_CLICKER: StuntDef = {
  name: 'Heel Clicker', points: 800,
  hip: v(0, 0.66, 0.08), shoulder: v(0, 0.98, -0.05),
  footL: v(-0.05, 0.86, -0.76), footR: v(0.05, 0.86, -0.76), kneeHint: v(0, 1, 0),
};
const NAC_NAC: StuntDef = {
  name: 'Nac Nac', points: 650,
  hip: v(0.18, 0.75, 0.15), shoulder: v(0.05, 1.08, -0.12),
  footL: v(0.5, 0.28, 0.3), footR: v(0.22, 0.04, 0.1),
};
const CAN_CAN: StuntDef = {
  name: 'Double Can Can', points: 700,
  hip: v(-0.05, 0.75, 0.1), shoulder: v(0.02, 1.06, -0.08),
  footL: v(-0.62, 0.3, -0.25), footR: v(-0.58, 0.22, -0.05),
};
const BAR_HOP: StuntDef = {
  name: 'Bar Hop', points: 750,
  hip: v(0, 0.8, -0.05), shoulder: v(0, 1.1, 0.08),
  footL: v(-0.12, 0.45, -0.85), footR: v(0.12, 0.45, -0.85), kneeHint: v(0, 1, 0),
};
const SPLITS: StuntDef = {
  name: 'Splits', points: 600,
  hip: v(0, 0.85, 0.12), shoulder: v(0, 1.18, 0),
  footL: v(-0.82, 0.62, 0.18), footR: v(0.82, 0.62, 0.18), kneeHint: v(0, 1, 0),
};
const SARAN_WRAP: StuntDef = {
  name: 'Saran Wrap', points: 750,
  hip: v(-0.05, 0.78, 0.05), shoulder: v(0, 1.06, -0.1),
  footL: v(-0.22, 0.04, 0.1), footR: v(0.15, 0.82, -0.62), kneeHint: v(0, 1, 0),
};

function mirror(def: StuntDef): StuntDef {
  const m = (p?: THREE.Vector3) => p && v(-p.x, p.y, p.z);
  return {
    ...def,
    hip: m(def.hip)!, shoulder: m(def.shoulder)!,
    footL: m(def.footR)!, footR: m(def.footL)!,
    handL: m(def.handR), handR: m(def.handL),
    kneeHint: m(def.kneeHint),
  };
}

const TABLE: Record<string, StuntDef> = {
  '1:none': SUPERMAN, '1:up': CLIFFHANGER, '1:down': HEEL_CLICKER,
  '1:right': NAC_NAC, '1:left': mirror(NAC_NAC),
  '2:none': CAN_CAN, '2:up': BAR_HOP, '2:down': SPLITS,
  '2:right': SARAN_WRAP, '2:left': mirror(SARAN_WRAP),
};

export function stuntFor(button: 1 | 2, dir: StuntDir) {
  return TABLE[`${button}:${dir}`];
}

const MIN_AIR_TO_START = 0.15; // s
const EXTEND_RATE = 3; // full extension in ~1/3 s
const RETRACT_RATE = 3.5;
const BOTCH_WEIGHT = 0.3; // landing this far into a trick is a crash
const JUMP_MIN_AIR = 0.4; // s of air before a landing counts as a jump
const AIR_BONUS = 250; // points per second of air beyond the first 0.8 s
const FLIP_POINTS = 2500;

export interface StuntState {
  def: StuntDef | null;
  /** 0 = riding pose, 1 = full stunt pose. */
  weight: number;
}

export class StuntSystem {
  readonly state: StuntState = { def: null, weight: 0 };
  total = 0;
  /** Points earned so far this jump (lost if it ends in a crash). */
  jumpPoints = 0;
  /** Live trick display: name and points while a trick is out. */
  onTrick?: (name: string | null, points: number) => void;
  /** Points banked on a clean landing, with a description of the jump. */
  onBank?: (points: number, label: string) => void;

  private airTime = 0;
  private wasAirborne = false;
  private tricks: string[] = [];
  private pitchTurned = 0;

  step(c: Controls, bike: Bike, dt: number) {
    const s = this.state;
    if (bike.crashed) {
      this.endJump();
      s.weight = Math.max(0, s.weight - RETRACT_RATE * dt);
      return;
    }

    const airborne = !bike.grounded;
    if (airborne) {
      this.airTime += dt;
      const w = bike.body.angvel(), r = bike.body.rotation();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      this.pitchTurned += (w.x * right.x + w.y * right.y + w.z * right.z) * dt;
    }

    // Which trick the controls ask for; switching tricks means tucking back in first.
    const wanted = airborne && this.airTime > MIN_AIR_TO_START && c.stunt ? stuntFor(c.stunt, c.stuntDir ?? 'none') : null;
    if (wanted && !s.def) s.def = wanted;
    const extending = wanted !== null && wanted === s.def;
    s.weight = extending ? Math.min(1, s.weight + EXTEND_RATE * dt) : Math.max(0, s.weight - RETRACT_RATE * dt);
    if (s.weight === 0 && !extending) s.def = wanted;

    if (s.def && s.weight >= 0.98) {
      this.jumpPoints += s.def.points * dt;
      if (!this.tricks.includes(s.def.name)) this.tricks.push(s.def.name);
    }
    this.onTrick?.(s.def && s.weight > 0.5 ? s.def.name : null, this.jumpPoints);

    if (this.wasAirborne && !airborne) this.land(bike);
    this.wasAirborne = airborne;
  }

  private land(bike: Bike) {
    const s = this.state;
    if (this.airTime >= JUMP_MIN_AIR) {
      if (s.def && s.weight > BOTCH_WEIGHT) {
        bike.crash(`botched the ${s.def.name}`);
        this.endJump();
        return;
      }
      const flips = Math.floor(Math.abs(this.pitchTurned) / (Math.PI * 2) + 0.15);
      let points = this.jumpPoints + Math.max(0, this.airTime - 0.8) * AIR_BONUS + flips * FLIP_POINTS;
      points = Math.round(points / 10) * 10;
      const parts = [...this.tricks];
      if (bike.cannonLanding) parts.unshift('Human Cannonball');
      if (flips > 0) parts.push(`${flips > 1 ? `${flips}x ` : ''}${this.pitchTurned > 0 ? 'Backflip' : 'Frontflip'}`);
      if (points > 0) {
        this.total += points;
        this.onBank?.(points, parts.length ? parts.join(' + ') : 'Big air');
      }
    }
    this.endJump();
  }

  private endJump() {
    this.airTime = 0;
    this.jumpPoints = 0;
    this.tricks = [];
    this.pitchTurned = 0;
    this.wasAirborne = false;
    this.onTrick?.(null, 0);
  }

  reset() {
    this.endJump();
    this.state.def = null;
    this.state.weight = 0;
  }
}
