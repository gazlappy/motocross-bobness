import workletUrl from './engineWorklet.ts?worker&url';
import type { Bike } from '../bike.ts';
import type { EngineParams } from './engineWorklet.ts';

// Game audio: the procedural engine plus wind, tyre roll, skid and landing thuds built from noise.
// Browsers only allow audio after a user gesture, so the graph is built on the first key/click.

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

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  update(bike: Bike) {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
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
