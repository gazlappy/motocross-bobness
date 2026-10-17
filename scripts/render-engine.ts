// Renders engine-sound previews to audio-preview/*.wav and prints level/pitch checks.
// The full-throttle clip is driven by the real bike sim, so shifts and air rev-outs are authentic.
import { mkdirSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { EngineDSP } from '../src/audio/engineDsp.ts';
import { generateHeightmap, rapierHeights, sampleHeight } from '../src/heightmap.ts';
import { Bike } from '../src/bike.ts';

const SR = 44100;
const OUT = 'audio-preview';
mkdirSync(OUT, { recursive: true });

function writeWav(path: string, samples: Float32Array) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/** Render with rpm/load supplied per 1/120 s control step. */
function render(control: { rpm: number; load: number }[], seed = 7) {
  const dsp = new EngineDSP(SR, seed);
  const per = SR / 120;
  const out = new Float32Array(Math.floor(control.length * per));
  const chunk = new Float32Array(Math.round(per));
  for (let k = 0; k < control.length; k++) {
    dsp.rpm = control[k].rpm;
    dsp.load = control[k].load;
    const n = Math.min(chunk.length, out.length - Math.round(k * per));
    const view = chunk.subarray(0, n);
    dsp.process(view);
    out.set(view, Math.round(k * per));
  }
  return out;
}

function stats(name: string, s: Float32Array, control: { rpm: number }[]) {
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const lines: string[] = [];
  for (let sec = 0; sec + 1 <= s.length / SR; sec++) {
    const seg = s.subarray(sec * SR, (sec + 1) * SR);
    let sum = 0;
    for (const v of seg) sum += v * v;
    // Autocorrelation pitch over a 50 ms window mid-second.
    const w = seg.subarray(SR / 2, SR / 2 + SR / 20);
    let best = 0, bestLag = 0;
    for (let lag = Math.floor(SR / 400); lag < SR / 20; lag++) {
      let c = 0;
      for (let i = 0; i + lag < w.length; i++) c += w[i] * w[i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    const rpm = control[Math.min(control.length - 1, Math.floor((sec + 0.5) * 120))].rpm;
    lines.push(`  ${sec}s rms ${Math.sqrt(sum / seg.length).toFixed(3)}  pitch ~${(SR / bestLag).toFixed(0)} Hz  (firing ${(rpm / 60).toFixed(0)} Hz @ ${rpm.toFixed(0)} rpm)`);
  }
  console.log(`${name}: peak ${peak.toFixed(2)}${peak >= 1 ? '  CLIPPING' : ''}\n${lines.join('\n')}`);
}

// 1. Idle, then free-revving blips in neutral.
{
  const control: { rpm: number; load: number }[] = [];
  let rpm = 1600;
  for (let k = 0; k < 6 * 120; k++) {
    const t = k / 120;
    const throttle = (t > 1.5 && t < 1.8) || (t > 2.8 && t < 3.3) || (t > 4.2 && t < 5.0) ? 1 : 0;
    const target = 1600 + throttle * 10200;
    rpm += (target - rpm) * (throttle ? 0.06 : 0.025);
    control.push({ rpm, load: throttle });
  }
  const s = render(control);
  writeWav(`${OUT}/idle-and-blips.wav`, s);
  stats('idle-and-blips', s, control);
}

// 2. Full throttle down the practice straight, using the bike sim's rpm and gear changes.
{
  await RAPIER.init();
  const hm = generateHeightmap();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  world.createCollider(RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), { x: hm.size, y: 1, z: hm.size }));
  const bike = new Bike(world, new THREE.Vector3(0, sampleHeight(hm, 0, 20) + 1, 20), 0);
  const control: { rpm: number; load: number }[] = [];
  for (let k = 0; k < 9 * 120; k++) {
    const t = k / 120;
    const throttle = t < 1 ? 0 : t < 7.5 ? 1 : 0;
    bike.step({ throttle, brake: t > 7.5 ? 0.6 : 0, steer: 0, leanForward: 0, leanSide: 0 }, 1 / 120);
    world.step();
    control.push({ rpm: bike.rpm, load: throttle });
  }
  const s = render(control);
  writeWav(`${OUT}/full-throttle-run.wav`, s);
  stats('full-throttle-run', s, control);
}
console.log(`\nWrote ${OUT}/idle-and-blips.wav and ${OUT}/full-throttle-run.wav`);
