import { SX_COLS, SX_PIECES, SX_ROWS, type SxDir, type SxPiece, type SxTrack, isTurn, problems, randomTrack, toTrackDef, walk } from './sxTrack.ts';
import { Track } from './track.ts';
import { deleteUserTrack, saveUserTrack, userTracks } from './sxLibrary.ts';

// The supercross track editor, like the original's: lay pieces one after another from the start
// line until the track comes back round, then ride it or race it. Your tracks are kept in the browser.

const DRAFT_KEY = 'motocross-bobness:track-draft';
const CELL = 40;

const SHORT: Record<SxPiece, string> = {
  finish: 'START', straight: '', jump: 'J', smallJump: 'j', mound: 'M', smallMound: 'm', table: 'T', whoops: 'W', left: '', right: '',
};
const FEATURE_CYCLE: SxPiece[] = ['straight', 'jump', 'smallJump', 'mound', 'smallMound', 'table', 'whoops'];

function blank(): SxTrack {
  return { name: 'My Track', start: { col: 5, row: 0, dir: 1 }, pieces: ['finish'] };
}

export function loadDraft(): SxTrack {
  try {
    const t = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as SxTrack | null;
    if (t && Array.isArray(t.pieces) && t.start) return t;
  } catch {
    // A fresh one.
  }
  return blank();
}

function saveDraft(t: SxTrack) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(t));
  } catch {
    // Kept for this visit.
  }
}

export interface EditorActions {
  ride(track: SxTrack): void;
  race(track: SxTrack): void;
  back(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class TrackEditor {
  track: SxTrack = loadDraft();
  private note = '';

  /** Fill `panel` with the editor. Call again after any change. */
  render(panel: HTMLElement, actions: EditorActions) {
    const rerender = () => {
      saveDraft(this.track);
      panel.innerHTML = '';
      this.render(panel, actions);
    };
    const t = this.track;
    panel.append(el('h2', 'menu-title', 'Track Editor'));

    const canvas = el('canvas', 'editor-grid') as HTMLCanvasElement;
    canvas.width = SX_COLS * CELL;
    canvas.height = SX_ROWS * CELL;
    this.draw(canvas);
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const col = Math.floor(((e.clientX - r.left) / r.width) * SX_COLS);
      const row = Math.floor(((e.clientY - r.top) / r.height) * SX_ROWS);
      this.clickTile(col, row);
      rerender();
    });
    panel.append(canvas);

    const status = problems(t);
    const ready = status.length === 0;
    const lap = ready ? new Track(toTrackDef(t)).length : 0;
    const features = t.pieces.filter((p) => FEATURE_CYCLE.includes(p) && p !== 'straight').length;
    const message = ready ? `Ready to ride: a ${Math.round(lap)} m lap with ${features} features. Click a straight to change its feature.` :
      `The track ${status.join(', ')}. ` +
      (t.pieces.length === 1 ? 'Click a tile to move the start line, then add pieces below.' : 'Keep adding pieces until it comes back round to the start.');
    panel.append(el('p', `menu-foot controls-blurb${ready ? '' : ' editor-problem'}`, message + (this.note ? ` <b>${this.note}</b>` : '')));
    this.note = '';

    // The palette: each adds a piece where the chain goes next.
    const palette = el('div', 'editor-palette');
    for (const p of SX_PIECES) {
      const b = el('button', 'menu-btn small', p.name);
      b.type = 'button';
      b.disabled = ready;
      b.addEventListener('click', () => {
        t.pieces.push(p.id);
        rerender();
      });
      palette.append(b);
    }
    panel.append(palette);

    const tools = el('div', 'menu-row');
    const tool = (label: string, fn: () => void, disabled = false) => {
      const b = el('button', 'menu-btn small', label);
      b.type = 'button';
      b.disabled = disabled;
      b.addEventListener('click', () => {
        fn();
        rerender();
      });
      tools.append(b);
    };
    tool('Undo', () => t.pieces.length > 1 && t.pieces.pop(), t.pieces.length <= 1);
    tool('Turn start', () => (t.start.dir = ((t.start.dir + 1) % 4) as SxDir), t.pieces.length > 1);
    tool('Clear', () => { this.track = { ...blank(), name: t.name }; });
    tool('Random', () => { this.track = randomTrack(Math.floor(Math.random() * 1e6), t.name); });
    panel.append(tools);

    // Name, save, and the saved tracks.
    const saveRow = el('div', 'setting', '<label>Name</label>');
    const name = el('input', 'code-input editor-name') as HTMLInputElement;
    name.value = t.name;
    name.maxLength = 24;
    name.addEventListener('input', () => { t.name = name.value; saveDraft(t); });
    const save = el('button', 'menu-btn small', 'Save');
    save.type = 'button';
    save.disabled = !ready;
    save.addEventListener('click', () => {
      t.name = name.value.trim() || 'My Track';
      saveUserTrack(structuredClone(t));
      this.note = `Saved "${t.name}".`;
      rerender();
    });
    saveRow.append(name, save);
    panel.append(saveRow);

    const saved = userTracks();
    if (saved.length) {
      const list = el('div', 'setting', '<label>Your tracks</label>');
      const select = el('select', 'track-select') as HTMLSelectElement;
      for (const s of saved) {
        const o = el('option', '', s.name) as HTMLOptionElement;
        o.value = s.name;
        select.append(o);
      }
      const load = el('button', 'menu-btn small', 'Load');
      load.type = 'button';
      load.addEventListener('click', () => {
        const found = saved.find((s) => s.name === select.value);
        if (found) this.track = structuredClone(found);
        rerender();
      });
      const del = el('button', 'menu-btn small', 'Delete');
      del.type = 'button';
      del.addEventListener('click', () => {
        deleteUserTrack(select.value);
        this.note = `Deleted "${select.value}".`;
        rerender();
      });
      list.append(select, load, del);
      panel.append(list);
    }

    const row = el('div', 'menu-row');
    const go = (label: string, fn: () => void, cls = 'menu-btn small') => {
      const b = el('button', cls, label);
      b.type = 'button';
      b.disabled = !ready && label !== 'Back';
      b.addEventListener('click', fn);
      row.append(b);
    };
    go('Ride it', () => actions.ride(structuredClone(t)), 'menu-btn go');
    go('Race it', () => actions.race(structuredClone(t)));
    go('Back', () => actions.back());
    panel.append(row);
  }

  /** Before any pieces are laid, a click moves the start; on a laid straight it changes the feature. */
  private clickTile(col: number, row: number) {
    const t = this.track;
    if (t.pieces.length === 1) {
      t.start.col = col;
      t.start.row = row;
      return;
    }
    const { cells } = walk(t);
    const i = cells.findIndex((c) => c.col === col && c.row === row);
    if (i <= 0) return;
    const p = t.pieces[i];
    if (isTurn(p)) return;
    t.pieces[i] = FEATURE_CYCLE[(FEATURE_CYCLE.indexOf(p) + 1) % FEATURE_CYCLE.length];
  }

  private draw(canvas: HTMLCanvasElement) {
    const g = canvas.getContext('2d')!;
    const t = this.track;
    g.fillStyle = '#3a2717';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let c = 0; c <= SX_COLS; c++) { g.beginPath(); g.moveTo(c * CELL + 0.5, 0); g.lineTo(c * CELL + 0.5, canvas.height); g.stroke(); }
    for (let r = 0; r <= SX_ROWS; r++) { g.beginPath(); g.moveTo(0, r * CELL + 0.5); g.lineTo(canvas.width, r * CELL + 0.5); g.stroke(); }
    const { cells, next } = walk(t);
    const centre = (c: { col: number; row: number }) => [c.col * CELL + CELL / 2, c.row * CELL + CELL / 2];
    const step: Record<SxDir, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };
    // The track as a thick line through the tile centres (and the edge between them).
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#8a5f3c';
    g.lineWidth = CELL * 0.62;
    g.beginPath();
    cells.forEach((c, i) => {
      const [x, y] = centre(c);
      const [ix, iy] = step[c.dirIn];
      if (i === 0) g.moveTo(x - (ix * CELL) / 2, y - (iy * CELL) / 2);
      g.lineTo(x, y);
      const [ox, oy] = step[c.dirOut];
      g.lineTo(x + (ox * CELL) / 2, y + (oy * CELL) / 2);
    });
    g.stroke();
    // Labels for the features and the start.
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const c of cells) {
      const label = SHORT[c.piece];
      if (!label) continue;
      const [x, y] = centre(c);
      g.fillStyle = c.piece === 'finish' ? '#fff' : '#ffb020';
      g.fillText(label, x, y);
    }
    // Where the next piece goes.
    if (problems(t).some((p) => p.includes('closed'))) {
      const [x, y] = centre(next);
      const inside = next.col >= 0 && next.row >= 0 && next.col < SX_COLS && next.row < SX_ROWS;
      g.strokeStyle = inside ? '#3dff5a' : '#ff4d3d';
      g.lineWidth = 2;
      g.strokeRect(next.col * CELL + 3, next.row * CELL + 3, CELL - 6, CELL - 6);
      const [dx, dy] = step[next.dir];
      g.beginPath();
      g.moveTo(x - dx * 8, y - dy * 8);
      g.lineTo(x + dx * 10, y + dy * 10);
      g.stroke();
    }
  }
}
