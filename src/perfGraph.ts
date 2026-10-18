// A frame-time graph for spotting judder: the last few seconds of frames as bars, so a screenshot
// shows the history rather than one frame. Toggle with the ` key (or start it with ?perf).

const W = 360, H = 90, FRAMES = 360;
const MAX_MS = 70;

export class PerfGraph {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private times = new Float32Array(FRAMES);
  private at = new Float64Array(FRAMES);
  private head = 0;
  private shown = false;

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

  /** Call once per frame with the time since the last one, in ms. */
  frame(ms: number, now: number) {
    this.times[this.head] = ms;
    this.at[this.head] = now;
    this.head = (this.head + 1) % FRAMES;
    if (this.shown) this.draw(now);
  }

  private draw(now: number) {
    const { ctx } = this;
    const y = (ms: number) => H - 14 - (Math.min(ms, MAX_MS) / MAX_MS) * (H - 18);
    ctx.clearRect(0, 0, W, H);
    let drops = 0, worst = 0;
    for (let i = 0; i < FRAMES; i++) {
      const k = (this.head + i) % FRAMES;
      const ms = this.times[k];
      if (!ms) continue;
      if (now - this.at[k] < 10_000) {
        if (ms > 22) drops++;
        worst = Math.max(worst, ms);
      }
      ctx.fillStyle = ms > 22 ? '#ff4d3d' : ms > 18 ? '#ffc23d' : '#5fd35f';
      const top = y(ms);
      ctx.fillRect(i, top, 1, H - 14 - top);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    for (const ms of [16.7, 33.3]) {
      ctx.moveTo(0, Math.round(y(ms)) + 0.5);
      ctx.lineTo(W, Math.round(y(ms)) + 0.5);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.fillText(`frames >22 ms in last 10 s: ${drops}   worst ${worst.toFixed(0)} ms`, 4, H - 3);
  }
}
