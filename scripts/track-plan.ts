// Plan a track layout: lap length, footprint, tightest corner, and the closest any two separate parts
// of the track come to each other, plus a top-down picture (PPM) of the centreline coloured by height.
// Usage: node scripts/track-plan.ts [out.ppm]
import { writeFileSync } from 'node:fs';
import { Track } from '../src/track.ts';

const track = new Track();
const n = track.samples.length;
const xs = track.samples.map((s) => s.x), zs = track.samples.map((s) => s.z);
const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
const el = track.samples.map((_, i) => track.elevation(track.sAt(i)));
let climb = 0;
for (let i = 0; i < n; i++) climb += Math.max(0, el[(i + 1) % n] - el[i]);

// Closest approach between parts of the lap at least 80 m apart along it.
let closest = Infinity, where = '';
for (let i = 0; i < n; i += 2) {
  for (let j = i + 80; j < n; j += 2) {
    if (n - (j - i) < 80) continue;
    const d = Math.hypot(xs[i] - xs[j], zs[i] - zs[j]);
    if (d < closest) { closest = d; where = `${i} m and ${j} m`; }
  }
}
const tightest = Math.max(...track.samples.map((s) => Math.abs(s.curvature)));
console.log(`lap ${track.length.toFixed(0)} m, footprint ${(maxX - minX).toFixed(0)} x ${(maxZ - minZ).toFixed(0)} m, ` +
  `tightest radius ${(1 / tightest).toFixed(1)} m, closest separate parts ${closest.toFixed(1)} m (at ${where}), ` +
  `height ${Math.min(...el).toFixed(1)} to ${Math.max(...el).toFixed(1)} m, climb ${climb.toFixed(0)} m/lap, jumps ${track.jumps.length}`);

const out = process.argv[2];
if (out) {
  const S = 3, W = Math.ceil((maxX - minX + 40) * S), H = Math.ceil((maxZ - minZ + 40) * S);
  const img = new Uint8Array(W * H * 3).fill(30);
  const lo = Math.min(...el), hi = Math.max(...el) || 1;
  const put = (x: number, z: number, r: number, g: number, b: number, rad: number) => {
    const cx = (x - minX + 20) * S, cz = (z - minZ + 20) * S;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const px = Math.round(cx + dx), py = Math.round(cz + dy);
      if (px >= 0 && py >= 0 && px < W && py < H && dx * dx + dy * dy <= rad * rad) img.set([r, g, b], (py * W + px) * 3);
    }
  };
  track.samples.forEach((s, i) => {
    const t = (el[i] - lo) / (hi - lo || 1);
    const jump = track.jumpProfile(track.sAt(i)) > 0.05;
    put(s.x, s.z, jump ? 255 : 80 + 175 * t, jump ? 60 : 160, jump ? 60 : 255 - 175 * t, Math.round(track.halfWidth * S * 0.5));
  });
  for (let i = 0; i < n; i += 50) put(xs[i], zs[i], 255, 255, 255, 3); // every 50 m
  put(xs[0], zs[0], 0, 255, 0, 6); // start
  writeFileSync(out, `P6 ${W} ${H} 255\n`);
  writeFileSync(out, Buffer.from(img), { flag: 'a' });
}
