// A frame-time graph for spotting judder: the last few seconds of frames as bars, so a screenshot
// shows the history rather than one frame. Toggle with the ` key (or start it with ?perf).
// Each bar is split by where the time went: physics (blue), game logic (purple), drawing (orange),
// and everything outside the game's own code (green when the frame was on time, red when late:
// the browser, the GPU or garbage collection).

const W = 360, H = 104, FRAMES = 360;
const MAX_MS = 70;
const LATE_MS = 22;
const BASE = H - 28;

export class PerfGraph {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  /** Per frame: total, physics, logic, draw (ms). */
  private rows = new Float32Array(FRAMES * 4);
  private at = new Float64Array(FRAMES);
  private head = 0;
  private shown = false;
  private pending = [0, 0, 0];

  constructor(show: boolean) {
    this.canvas.width = W;
    this.canvas.height = H;
    Object.assign(this.canvas.style, {
      position: 'fixed', right: '8px', top: '8px', width: `${W}px`, height: `${H}px`, zIndex: '50', pointerEvents: 'none',
      background: 'rgba(0,0,0,0.6)', borderRadius: '4px', display: 'none',
    });
    document.body.append(this.canvas);
    addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.toggle(!this.shown);
    });
    this.toggle(show);
  }

  toggle(show: boolean) {
    this.shown = show;
    this.canvas.style.display = show ? 'block' : 'none';
  }

  /** Call at the end of each frame with the time its parts took, in ms. */
  work(physics: number, logic: number, draw: number) {
    this.pending = [physics, logic, draw];
  }

  /** Call at the start of each frame with the time since the last one, in ms. */
  frame(ms: number, now: number) {
    const r = this.head * 4;
    this.rows[r] = ms;
    this.rows[r + 1] = this.pending[0];
    this.rows[r + 2] = this.pending[1];
    this.rows[r + 3] = this.pending[2];
    this.pending = [0, 0, 0];
    this.at[this.head] = now;
    this.head = (this.head + 1) % FRAMES;
    if (this.shown) this.draw(now);
  }

  private draw(now: number) {
    const { ctx, rows } = this;
    const h = (ms: number) => (Math.min(ms, MAX_MS) / MAX_MS) * (BASE - 4);
    ctx.clearRect(0, 0, W, H);
    let drops = 0, worst = -1;
    for (let i = 0; i < FRAMES; i++) {
      const k = (this.head + i) % FRAMES;
      const total = rows[k * 4];
      if (!total) continue;
      if (now - this.at[k] < 10_000) {
        if (total > LATE_MS) drops++;
        if (worst < 0 || total > rows[worst * 4]) worst = k;
      }
      let below = 0;
      const part = (ms: number, colour: string) => {
        const top = BASE - h(below + ms), bottom = BASE - h(below);
        ctx.fillStyle = colour;
        ctx.fillRect(i, top, 1, bottom - top);
        below += ms;
      };
      part(rows[k * 4 + 1], '#4d9dff');
      part(rows[k * 4 + 2], '#b67dff');
      part(rows[k * 4 + 3], '#ff9d3d');
      const outside = Math.max(0, total - rows[k * 4 + 1] - rows[k * 4 + 2] - rows[k * 4 + 3]);
      part(outside, total > LATE_MS ? '#ff3d3d' : '#4fbf4f');
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    for (const ms of [16.7, 33.3]) {
      ctx.moveTo(0, Math.round(BASE - h(ms)) + 0.5);
      ctx.lineTo(W, Math.round(BASE - h(ms)) + 0.5);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.fillText(`late frames (>${LATE_MS} ms) in last 10 s: ${drops}`, 4, H - 15);
    if (worst >= 0) {
      const [t, p, l, d] = rows.subarray(worst * 4, worst * 4 + 4);
      const other = Math.max(0, t - p - l - d);
      ctx.fillText(`worst ${t.toFixed(0)}: phys ${p.toFixed(0)} logic ${l.toFixed(0)} draw ${d.toFixed(0)} other ${other.toFixed(0)}`, 4, H - 3);
    }
  }
}
