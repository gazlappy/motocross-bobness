import { EngineDSP } from './engineDsp.ts';

// AudioWorklet globals (not in the DOM lib).
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export interface EngineParams {
  rpm: number;
  load: number;
  redline?: number;
  idle?: number;
  fourStroke?: boolean;
  gain?: number;
}

class EngineProcessor extends AudioWorkletProcessor {
  private dsp = new EngineDSP(sampleRate, (Math.random() * 1e9) | 0);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<EngineParams>) => {
      const p = e.data;
      this.dsp.rpm = p.rpm;
      this.dsp.load = p.load;
      if (p.redline !== undefined) this.dsp.redline = p.redline;
      if (p.idle !== undefined) this.dsp.idle = p.idle;
      if (p.fourStroke !== undefined) this.dsp.fourStroke = p.fourStroke;
      if (p.gain !== undefined) this.dsp.gain = p.gain;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    this.dsp.process(out[0]);
    for (let ch = 1; ch < out.length; ch++) out[ch].set(out[0]);
    return true;
  }
}

registerProcessor('engine', EngineProcessor);
