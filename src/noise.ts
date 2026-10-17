// Seeded 2D gradient noise + fBm. Output is roughly in [-1, 1].

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise2D {
  private perm = new Uint8Array(512);
  private grads: Float32Array;

  constructor(seed = 1) {
    const rand = mulberry32(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.grads = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const a = rand() * Math.PI * 2;
      this.grads[i * 2] = Math.cos(a);
      this.grads[i * 2 + 1] = Math.sin(a);
    }
  }

  private dot(hash: number, x: number, y: number) {
    return this.grads[hash * 2] * x + this.grads[hash * 2 + 1] * y;
  }

  noise(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const p = this.perm;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = this.dot(aa, xf, yf) + u * (this.dot(ba, xf - 1, yf) - this.dot(aa, xf, yf));
    const x2 = this.dot(ab, xf, yf - 1) + u * (this.dot(bb, xf - 1, yf - 1) - this.dot(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.41;
  }

  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
