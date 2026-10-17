// Procedural single-cylinder two-stroke engine. Pure DSP with no Web Audio dependency, so the same
// code runs in the AudioWorklet and in Node (scripts/render-engine.ts) for offline previews.
//
// Model: the cylinder fires once per revolution; each firing is a short noisy pressure pulse that
// rings an exhaust expansion chamber (a lossy tuned delay line) and a short muffler resonance. The
// result is soft-clipped and low-passed, opening up with load and revs: the two-stroke "braap".

export class EngineDSP {
  rpm = 1600;
  /** Throttle opening / engine load, 0..1. */
  load = 0;
  redline = 11500;
  gain = 0.5;

  private readonly sr: number;
  private rpmS = 1600;
  private loadS = 0;
  private phase = 0;
  private tFire = 1;
  private amp = 0;
  private limiterCut = 0;
  private seed: number;

  private pipe: Float32Array;
  private pipeIdx = 0;
  private pipeLp = 0;
  private muff: Float32Array;
  private muffIdx = 0;
  private lp1 = 0;
  private lp2 = 0;
  private intake = 0;
  private dcX = 0;
  private dcY = 0;

  constructor(sampleRate: number, seed = 1) {
    this.sr = sampleRate;
    this.seed = seed >>> 0 || 1;
    this.pipe = new Float32Array(Math.ceil(sampleRate / 80) + 2);
    this.muff = new Float32Array(Math.ceil(sampleRate / 500) + 2);
  }

  private rand() {
    // xorshift32, 0..1
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  private fire(rpm: number, load: number) {
    // Rev limiter: ignition cut in short bursts, the classic bouncing-off-the-limiter stutter.
    if (this.limiterCut > 0) {
      this.limiterCut--;
      this.amp = 0.04;
      this.tFire = 0;
      return;
    }
    if (rpm >= this.redline && this.rand() < 0.5) this.limiterCut = 2 + Math.floor(this.rand() * 4);

    let a = 0.35 + 0.65 * load;
    a *= 0.82 + 0.36 * this.rand(); // cycle-to-cycle combustion variation
    if (rpm < 2600 && this.rand() < 0.12) a *= 0.35; // lumpy idle
    if (load < 0.05 && rpm > 4000 && this.rand() < 0.035) a = 1.5; // off-throttle pop
    this.amp = a;
    this.tFire = 0;
  }

  /** Fill `out` with mono samples. */
  process(out: Float32Array) {
    const sr = this.sr;
    const pipe = this.pipe, muff = this.muff;
    const pipeSize = pipe.length, muffSize = muff.length;

    for (let i = 0; i < out.length; i++) {
      // ~10 ms parameter smoothing so control-rate updates don't click.
      this.rpmS += (this.rpm - this.rpmS) * 0.003;
      this.loadS += (this.load - this.loadS) * 0.003;
      const rpm = this.rpmS, load = this.loadS;
      const rev = Math.min(1, Math.max(0, (rpm - 1600) / (this.redline - 1600)));

      this.phase += rpm / 60 / sr;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.fire(rpm, load);
      }
      this.tFire += 1 / sr;

      // Combustion pulse: instant attack, ~1 ms decay, part noise.
      const env = this.amp * Math.exp(-this.tFire * (900 + 400 * rev));
      const exc = env * (0.5 + 0.5 * (this.rand() * 2 - 1));

      // Expansion chamber: tuned so it resonates hardest near peak power.
      const pipeLen = Math.min(pipeSize - 1, Math.floor(sr / (105 + rpm * 0.005)));
      const delayed = pipe[(this.pipeIdx - pipeLen + pipeSize) % pipeSize];
      this.pipeLp += (delayed - this.pipeLp) * 0.4;
      const y = exc + 0.6 * this.pipeLp;
      pipe[this.pipeIdx] = y;
      this.pipeIdx = (this.pipeIdx + 1) % pipeSize;

      // Short muffler/silencer resonance adds the buzzy upper body.
      const muffLen = Math.min(muffSize - 1, Math.floor(sr / 820));
      const m = muff[(this.muffIdx - muffLen + muffSize) % muffSize];
      const z = y + 0.35 * m;
      muff[this.muffIdx] = z;
      this.muffIdx = (this.muffIdx + 1) % muffSize;

      // Drive harder with load, then a two-pole low-pass that opens with load and revs.
      let s = Math.tanh(z * (1.4 + 2.2 * load));
      const fc = 900 + 1600 * rev + 4200 * load * (0.35 + 0.65 * rev);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      this.lp1 += a * (s - this.lp1);
      this.lp2 += a * (this.lp1 - this.lp2);
      s = this.lp2;

      // Intake/airbox hiss, breathing with each stroke when the throttle is open.
      const breath = 0.5 + 0.5 * Math.cos(this.phase * 2 * Math.PI);
      this.intake += ((this.rand() * 2 - 1) - this.intake) * 0.25;
      s += this.intake * breath * load * 0.06;

      // DC blocker.
      const dc = s - this.dcX + 0.995 * this.dcY;
      this.dcX = s;
      this.dcY = dc;

      out[i] = dc * this.gain;
    }
  }
}
