import * as THREE from 'three';
import workletUrl from './engineWorklet.ts?worker&url';
import type { Bike } from '../bike.ts';
import type { EngineParams } from './engineWorklet.ts';

// Game audio: the procedural engine plus wind, tyre roll, skid and landing thuds built from noise.
// Browsers only allow audio after a user gesture, so the graph is built on the first key/click.

/** Another bike whose engine should be heard, placed by distance and direction from the camera. */
export interface EngineSource {
  position(): { x: number; y: number; z: number };
  rpm(): number;
  load(): number;
}

interface RemoteEngine {
  src: EngineSource;
  node?: AudioWorkletNode;
  gain?: GainNode;
  pan?: StereoPannerNode;
}

const _camPos = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _rel = new THREE.Vector3();

export class SoundSystem {
  private ctx?: AudioContext;
  private master?: GainNode;
  private engine?: AudioWorkletNode;
  private noise?: AudioBuffer;
  private wind?: { gain: GainNode; filter: BiquadFilterNode };
  private tyre?: { gain: GainNode; filter: BiquadFilterNode };
  private skid?: { gain: GainNode; filter: BiquadFilterNode };
  private starting = false;
  private muted = false;
  private remotes: RemoteEngine[] = [];

  constructor() {
    const start = () => void this.start();
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
  }

  get ready() {
    return !!this.engine;
  }

  private async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    if (this.starting) return;
    this.starting = true;
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(workletUrl);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp);

    this.engine = new AudioWorkletNode(ctx, 'engine', { outputChannelCount: [1] });
    this.engine.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.wind = this.noiseLayer(ctx, 'lowpass', 400, 0.7);
    this.tyre = this.noiseLayer(ctx, 'bandpass', 220, 0.8);
    this.skid = this.noiseLayer(ctx, 'bandpass', 1700, 1.4);
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
  }

  private noiseLayer(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    return { gain, filter };
  }

  /** Hear another bike's engine (the AI riders). */
  addEngine(src: EngineSource) {
    this.remotes.push({ src });
  }

  private updateRemotes(listener: THREE.Camera) {
    const ctx = this.ctx!;
    listener.getWorldPosition(_camPos);
    _camRight.set(1, 0, 0).applyQuaternion(listener.quaternion);
    for (const r of this.remotes) {
      if (!r.node) {
        r.node = new AudioWorkletNode(ctx, 'engine', { outputChannelCount: [1] });
        r.gain = ctx.createGain();
        r.gain.gain.value = 0;
        r.pan = ctx.createStereoPanner();
        r.node.connect(r.gain).connect(r.pan).connect(this.master!);
      }
      const params: EngineParams = { rpm: r.src.rpm(), load: r.src.load() };
      r.node.port.postMessage(params);
      const p = r.src.position();
      _rel.set(p.x - _camPos.x, p.y - _camPos.y, p.z - _camPos.z);
      const dist = _rel.length();
      const t = ctx.currentTime;
      r.gain!.gain.setTargetAtTime(0.6 / (1 + (dist / 9) ** 2), t, 0.05);
      r.pan!.pan.setTargetAtTime(dist > 0.1 ? THREE.MathUtils.clamp(_rel.dot(_camRight) / dist, -1, 1) * 0.85 : 0, t, 0.05);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  update(bike: Bike, listener?: THREE.Camera) {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    if (listener) this.updateRemotes(listener);
    const now = ctx.currentTime;
    const params: EngineParams = { rpm: bike.rpm, load: bike.throttle };
    this.engine.port.postMessage(params);

    const v = bike.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    const ramp = 0.06;

    const windAmt = Math.min(1, (speed / 35) ** 2);
    this.wind!.gain.gain.setTargetAtTime(0.35 * windAmt, now, ramp);
    this.wind!.filter.frequency.setTargetAtTime(250 + speed * 30, now, ramp);

    const rolling = bike.grounded ? Math.min(1, speed / 22) : 0;
    this.tyre!.gain.gain.setTargetAtTime(0.18 * rolling, now, 0.03);
    this.tyre!.filter.frequency.setTargetAtTime(140 + speed * 9, now, ramp);

    const slip = Math.max(...bike.wheels.map((w) => (w.grounded ? w.slip : 0)));
    const skidAmt = slip > 0.97 && speed > 3 ? Math.min(1, speed / 15) : 0;
    this.skid!.gain.gain.setTargetAtTime(0.12 * skidAmt, now, 0.04);

    if (bike.landingImpact > 1.2) this.impact(Math.min(1, (bike.landingImpact - 1.2) / 6));
    bike.landingImpact = 0;
  }

  /** The out-of-bounds cannon: a boom, then a cartoon slide whistle as you sail off. */
  cannon() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.impact(1);
    const t = ctx.currentTime;
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(90, t);
    boom.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(1, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    boom.connect(bg).connect(this.master);
    boom.start(t);
    boom.stop(t + 0.65);

    const whistle = ctx.createOscillator();
    whistle.type = 'triangle';
    whistle.frequency.setValueAtTime(420, t + 0.15);
    whistle.frequency.exponentialRampToValueAtTime(1900, t + 1.4);
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 25;
    vib.connect(vibDepth).connect(whistle.frequency);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0, t + 0.15);
    wg.gain.linearRampToValueAtTime(0.25, t + 0.3);
    wg.gain.setValueAtTime(0.25, t + 1.2);
    wg.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    whistle.connect(wg).connect(this.master);
    whistle.start(t + 0.15);
    vib.start(t + 0.15);
    whistle.stop(t + 1.65);
    vib.stop(t + 1.65);
  }

  /** A short bright chime when stunt points bank. */
  score() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.08, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.18);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.2);
    }
  }

  /** A short low thump for landings and crashes, 0..1. */
  impact(strength: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || strength <= 0.02) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180 + 300 * strength;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + 0.2 * strength);
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + 0.6);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7 * strength, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(og).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.35);
  }
}
