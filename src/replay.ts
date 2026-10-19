import * as THREE from 'three';
import { SNAPSHOT_LENGTH, type SnapshotState, readSnapshot } from './net/remoteRider.ts';
import { createPose } from './riderPose.ts';

// Replays, as in the original: every rider is recorded 20 times a second while a game runs (the
// same snapshots multiplayer sends), and played back by moving the riders' models along the recording.

const RECORD_EVERY = 0.05; // s
const MAX_FRAMES = 20 * 60 * 6; // the last six minutes

export class ReplayRecorder {
  private times: number[] = [];
  private frames: Float32Array[] = [];
  private clock = 0;
  private next = 0;
  /** How many riders each frame holds (fixed by the first frame). */
  riders = 0;

  /** Advance the recording clock; returns true when it's time to take a frame. */
  due(dt: number) {
    this.clock += dt;
    if (this.clock < this.next) return false;
    this.next = this.clock + RECORD_EVERY;
    return true;
  }

  /** One frame: a snapshot per rider, always in the same order. */
  add(snapshots: ArrayLike<number>[]) {
    if (!this.riders) this.riders = snapshots.length;
    if (snapshots.length !== this.riders) return;
    const frame = new Float32Array(this.riders * SNAPSHOT_LENGTH);
    snapshots.forEach((s, i) => frame.set(s as ArrayLike<number>, i * SNAPSHOT_LENGTH));
    this.times.push(this.clock);
    this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) {
      this.times.shift();
      this.frames.shift();
    }
  }

  get length() {
    return this.frames.length;
  }

  recording() {
    return { times: this.times.slice(), frames: this.frames.slice(), riders: this.riders };
  }
}

export type Recording = ReturnType<ReplayRecorder['recording']>;

/** A rider being played back: looks enough like a bike for the models and the camera. */
export interface ReplayRider extends SnapshotState {
  view: {
    body: {
      translation(): THREE.Vector3;
      rotation(): THREE.Quaternion;
      linvel(): THREE.Vector3;
      angvel(): { x: number; y: number; z: number };
    };
    wheels: { attach: THREE.Vector3; rayLength: number; spin: number }[];
    steerAngle: number;
    speed: number;
    yaw: number;
    grounded: boolean;
    airTime: number;
    rpm: number;
    throttle: number;
  };
}

export class ReplayPlayer {
  readonly riders: ReplayRider[];
  /** Seconds into the recording. */
  time: number;
  paused = false;
  /** Whose replay the camera follows. */
  focus = 0;
  readonly start: number;
  readonly end: number;
  private rec: Recording;

  constructor(rec: Recording, focus = 0) {
    this.rec = rec;
    this.start = rec.times[0] ?? 0;
    this.end = rec.times.at(-1) ?? 0;
    this.time = this.start;
    this.focus = focus;
    this.riders = Array.from({ length: rec.riders }, () => {
      const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), vel = new THREE.Vector3();
      const wheels = [-0.82, 0.66].map((z) => ({ attach: new THREE.Vector3(0, 0.12, z), rayLength: 0.6, spin: 0 }));
      const r: ReplayRider = {
        pos, rot, vel, wheels, pose: createPose(), steer: 0, rpm: 0, throttle: 0, crashed: false, score: 0,
        view: {
          body: { translation: () => pos, rotation: () => rot, linvel: () => vel, angvel: () => ({ x: 0, y: 0, z: 0 }) },
          wheels, steerAngle: 0, speed: 0, yaw: 0, grounded: true, airTime: 0, rpm: 0, throttle: 0,
        },
      };
      return r;
    });
    this.seek(this.start);
  }

  get duration() {
    return this.end - this.start;
  }

  get finished() {
    return this.time >= this.end;
  }

  /** Move the clock on (unless paused) and update every rider. */
  advance(dt: number) {
    if (!this.paused) this.seek(this.time + dt);
  }

  seek(t: number) {
    const { times, frames } = this.rec;
    if (!frames.length) return;
    this.time = THREE.MathUtils.clamp(t, this.start, this.end);
    // Binary search for the frames either side of the time.
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= this.time) lo = mid;
      else hi = mid;
    }
    const k = hi === lo ? 0 : THREE.MathUtils.clamp((this.time - times[lo]) / (times[hi] - times[lo]), 0, 1);
    const L = SNAPSHOT_LENGTH;
    const fwd = new THREE.Vector3();
    this.riders.forEach((r, i) => {
      const a = frames[lo].subarray(i * L, (i + 1) * L), b = frames[hi].subarray(i * L, (i + 1) * L);
      readSnapshot(a, b, k, r);
      const v = r.view;
      v.steerAngle = r.steer;
      v.rpm = r.rpm;
      v.throttle = r.throttle;
      fwd.set(0, 0, -1).applyQuaternion(r.rot);
      v.speed = r.vel.dot(fwd);
      v.yaw = Math.atan2(-fwd.x, -fwd.z);
      // Close enough for the camera: on the ground unless the wheels are hanging out.
      v.grounded = r.wheels[0].rayLength < 0.74 || r.wheels[1].rayLength < 0.74;
    });
  }
}
