import { BIKE_COLOURS, type BikeColour } from './gltfBikeModel.ts';
import { KIT_COLOURS, type SessionConfig } from './session.ts';
import { type Difficulty, type Settings, saveSettings } from './settings.ts';
import type { VenueId } from './venue.ts';

// The front end: main menu over the attract-mode race, game select, options, credits, pause and
// results. Plain DOM, driven by mouse, keyboard (arrows, Enter, Esc) or the gamepad's Start.

export interface MenuHandlers {
  start(config: SessionConfig): void;
  resume(): void;
  restart(): void;
  quit(): void;
  settingsChanged(s: Settings): void;
}

type Screen = 'main' | 'select' | 'options' | 'credits' | 'pause' | 'results';

interface Mode {
  id: string;
  mode: SessionConfig['mode'];
  venue: VenueId | null; // null: chosen in the setup (Free Ride)
  name: string;
  blurb: string;
}

const MODES: Mode[] = [
  { id: 'nationals', mode: 'race', venue: 'nationals', name: 'Nationals', blurb: 'Outdoor motocross: berms, doubles and whoops against the field.' },
  { id: 'supercross', mode: 'race', venue: 'supercross', name: 'Supercross', blurb: 'Indoor stadium racing: hairpins, rhythm sections, whoops and big tabletops.' },
  { id: 'baja', mode: 'baja', venue: 'baja', name: 'Baja', blurb: 'Open desert, waypoint to waypoint. Pick your own line.' },
  { id: 'quarry', mode: 'quarry', venue: 'quarry', name: 'Stunt Quarry', blurb: 'Huge ramps and banks. Score the most stunt points in time.' },
  { id: 'freeride', mode: 'freeride', venue: null, name: 'Free Ride', blurb: 'Any venue to yourself. Practise lines, stunts and the cannon.' },
];

const VENUE_NAMES: Record<VenueId, string> = { nationals: 'Nationals', supercross: 'Supercross', baja: 'Baja', quarry: 'Quarry' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Menu {
  private root: HTMLElement;
  private panel: HTMLElement;
  private settings: Settings;
  private h: MenuHandlers;
  private screen: Screen | null = null;
  private stack: Screen[] = [];
  private mode: Mode = MODES[0];
  private resultsHtml = '';
  private resultsTitle = 'Results';

  constructor(root: HTMLElement, settings: Settings, handlers: MenuHandlers) {
    this.root = root;
    this.settings = settings;
    this.h = handlers;
    this.panel = el('div', 'menu-panel');
    root.append(el('div', 'menu-logo', 'MOTOCROSS<span>BOBNESS</span>'), this.panel);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get visible() {
    return this.screen !== null;
  }

  get screenName() {
    return this.screen;
  }

  /** Esc during a game, or Start on a pad. */
  togglePause() {
    if (this.screen === 'pause') this.resume();
    else if (!this.visible) this.open('pause', true);
  }

  showMain() {
    this.open('main', true);
  }

  showResults(tableHtml: string, title = 'Results') {
    this.resultsHtml = tableHtml;
    this.resultsTitle = title;
    this.open('results', true);
  }

  hide() {
    // Let go of the focused button, or Space (a stunt button) would press it mid-game.
    (document.activeElement as HTMLElement | null)?.blur();
    this.screen = null;
    this.stack = [];
    this.root.hidden = true;
    document.body.classList.remove('menu-open', 'menu-main');
  }

  private resume() {
    this.hide();
    this.h.resume();
  }

  private open(screen: Screen, reset = false) {
    if (reset) this.stack = [];
    else if (this.screen) this.stack.push(this.screen);
    this.screen = screen;
    this.root.hidden = false;
    document.body.classList.add('menu-open');
    // Over the attract mode the logo is big; in-game menus are just a panel.
    document.body.classList.toggle('menu-main', ['main', 'select', 'options', 'credits'].includes(screen) && !this.inGame());
    this.render();
  }

  private inGame() {
    return this.stack.includes('pause') || this.stack.includes('results') || this.screen === 'pause' || this.screen === 'results';
  }

  private back() {
    const prev = this.stack.pop();
    if (prev) {
      this.screen = prev;
      document.body.classList.toggle('menu-main', !this.inGame());
      this.render();
    } else if (this.screen === 'pause') {
      this.resume();
    }
  }

  private render() {
    this.panel.innerHTML = '';
    this.panel.dataset.screen = this.screen ?? '';
    const s = this.screen;
    if (s === 'main') this.renderMain();
    else if (s === 'select') this.renderSelect();
    else if (s === 'options') this.renderOptions();
    else if (s === 'credits') this.renderCredits();
    else if (s === 'pause') this.renderPause();
    else if (s === 'results') this.renderResults();
    this.focusables()[0]?.focus();
  }

  private title(text: string) {
    this.panel.append(el('h2', 'menu-title', text));
  }

  private button(label: string, onClick: () => void, cls = 'menu-btn') {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    this.panel.append(b);
    return b;
  }

  private renderMain() {
    this.button('Select Game', () => this.open('select'));
    this.button('Options', () => this.open('options'));
    this.button('Credits', () => this.open('credits'));
    this.panel.append(el('p', 'menu-foot', 'A tribute to Motocross Madness (1998).<br>Arrows + Enter, or the mouse.'));
  }

  private renderSelect() {
    this.title('Select Game');
    const cards = el('div', 'mode-cards');
    for (const m of MODES) {
      const card = el('button', `mode-card${m === this.mode ? ' selected' : ''}`, `<b>${m.name}</b><span>${m.blurb}</span>`);
      card.type = 'button';
      card.addEventListener('click', () => {
        this.mode = m;
        this.render();
      });
      cards.append(card);
    }
    this.panel.append(cards);

    const st = this.settings;
    const setup = el('div', 'setup');
    const m = this.mode;
    if (m.mode === 'race') setup.append(this.segmented('Laps', [1, 3, 5], st.laps, (v) => this.set({ laps: v })));
    if (m.mode === 'race' || m.mode === 'baja') {
      setup.append(
        this.segmented('Opponents', [0, 1, 2, 3, 4, 5, 6], st.opponents, (v) => this.set({ opponents: v })),
        this.segmented<Difficulty>('Rivals', ['easy', 'medium', 'hard'], st.difficulty, (v) => this.set({ difficulty: v })),
      );
    }
    if (m.mode === 'quarry') {
      setup.append(this.segmented('Time', [60, 120, 180], st.duration, (v) => this.set({ duration: v }), (v) => `${v / 60} min`));
    }
    if (m.mode === 'freeride') {
      setup.append(this.segmented<VenueId>('Venue', ['nationals', 'supercross', 'baja', 'quarry'], st.freeVenue,
        (v) => this.set({ freeVenue: v }), (v) => VENUE_NAMES[v]));
    }
    setup.append(this.colourPicker());
    this.panel.append(setup);

    const row = el('div', 'menu-row');
    const go = el('button', 'menu-btn go', this.mode.mode === 'race' || this.mode.mode === 'baja' ? 'Race!' : 'Ride!');
    go.type = 'button';
    go.addEventListener('click', () => {
      this.hide();
      this.h.start({
        mode: this.mode.mode,
        venue: this.mode.venue ?? st.freeVenue,
        laps: st.laps, opponents: st.opponents, difficulty: st.difficulty, colour: st.colour, duration: st.duration,
      });
    });
    const back = el('button', 'menu-btn small', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => this.back());
    row.append(go, back);
    this.panel.append(row);
  }

  private colourPicker() {
    const wrap = el('div', 'setting', '<label>Your bike</label>');
    const swatches = el('div', 'swatches seg');
    for (const c of BIKE_COLOURS) {
      const b = el('button', `swatch${c === this.settings.colour ? ' selected' : ''}`);
      b.type = 'button';
      b.title = c;
      b.setAttribute('aria-label', `${c} bike`);
      b.style.setProperty('--swatch', `#${KIT_COLOURS[c].toString(16).padStart(6, '0')}`);
      b.addEventListener('click', () => this.set({ colour: c as BikeColour }));
      swatches.append(b);
    }
    wrap.append(swatches);
    return wrap;
  }

  private renderOptions() {
    this.title('Options');
    const st = this.settings;
    const list = el('div', 'setup');

    const vol = el('div', 'setting', '<label>Volume</label>');
    const range = el('input') as HTMLInputElement;
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = String(Math.round(st.volume * 100));
    range.addEventListener('input', () => this.set({ volume: Number(range.value) / 100 }, false));
    vol.append(range);
    list.append(
      vol,
      this.segmented('Sound', ['on', 'off'], st.muted ? 'off' : 'on', (v) => this.set({ muted: v === 'off' })),
      this.segmented('Speed in', ['mph', 'kmh'], st.units, (v) => this.set({ units: v as Settings['units'] }), (v) => (v === 'kmh' ? 'km/h' : 'mph')),
      this.segmented('Gearbox', ['auto', 'manual'], st.gearbox, (v) => this.set({ gearbox: v as Settings['gearbox'] })),
      this.segmented('Camera', ['chase', 'far', 'helmet', 'thrill'], st.camera, (v) => this.set({ camera: v as Settings['camera'] })),
      this.segmented('Shadows', ['on', 'off'], st.shadows ? 'on' : 'off', (v) => this.set({ shadows: v === 'on' })),
      this.segmented('Resolution', [1, 0.75, 0.5], st.resolution, (v) => this.set({ resolution: v }), (v) => `${v * 100}%`),
      this.segmented('Controls help', ['show', 'hide'], st.showHelp ? 'show' : 'hide', (v) => this.set({ showHelp: v === 'show' })),
    );
    this.panel.append(list);
    this.panel.append(el('div', 'controls-ref',
      '<b>W</b> throttle · <b>S</b> brake · <b>A/D</b> steer · <b>↑↓←→</b> lean · <b>Space/Shift + arrows</b> stunts · ' +
      '<b>Q/E</b> shift · <b>C</b> camera · <b>R</b> reset · <b>N</b> mute · <b>Esc</b> pause'));
    this.button('Back', () => this.back(), 'menu-btn small');
  }

  private renderCredits() {
    this.title('Credits');
    this.panel.append(el('div', 'credits',
      `<p><b>Motocross Bobness</b><br>A browser tribute to <i>Motocross Madness</i> (1998) by Rainbow Studios,
       published by Microsoft. Not affiliated with or endorsed by either.</p>
       <p><b>3D models</b> (CC BY 4.0)<br>
       "Mid poly dirt bike" by <a href="https://sketchfab.com/danilloribeiro" target="_blank" rel="noopener">danilloribeiro</a><br>
       "Low-poly Motocross Character (rigged)" by <a href="https://sketchfab.com/XHeheX" target="_blank" rel="noopener">XHeheX</a></p>
       <p><b>Built with</b><br>three.js · Rapier physics · Vite · TypeScript</p>
       <p><b>Sound</b><br>Engine, wind, tyres and crashes are synthesised live in the browser.</p>`));
    this.button('Back', () => this.back(), 'menu-btn small');
  }

  private renderPause() {
    this.title('Paused');
    this.button('Resume', () => this.resume());
    this.button('Restart', () => {
      this.hide();
      this.h.restart();
    });
    this.button('Options', () => this.open('options'));
    this.button('Quit to menu', () => this.h.quit());
  }

  private renderResults() {
    this.title(this.resultsTitle);
    this.panel.append(el('div', 'results-table', this.resultsHtml));
    this.button('Go again', () => {
      this.hide();
      this.h.restart();
    });
    this.button('Main menu', () => this.h.quit());
  }

  /** A row of options; Left/Right also step through them when focused. */
  private segmented<T extends string | number>(
    label: string, values: T[], current: T, onPick: (v: T) => void, text: (v: T) => string = (v) => String(v),
  ) {
    const wrap = el('div', 'setting', `<label>${label}</label>`);
    const seg = el('div', 'seg');
    for (const v of values) {
      const b = el('button', v === current ? 'selected' : '', text(v));
      b.type = 'button';
      b.addEventListener('click', () => onPick(v));
      seg.append(b);
    }
    wrap.append(seg);
    return wrap;
  }

  private set(patch: Partial<Settings>, rerender = true) {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    this.h.settingsChanged(this.settings);
    if (rerender) {
      const focused = document.activeElement as HTMLElement | null;
      const index = this.focusables().indexOf(focused as HTMLElement);
      this.render();
      if (index >= 0) this.focusables()[index]?.focus();
    }
  }

  private focusables() {
    return [...this.panel.querySelectorAll<HTMLElement>('button:not(:disabled), input')].filter(
      (b) => !b.closest('.seg') || b.classList.contains('selected'),
    );
  }

  private onKey(e: KeyboardEvent) {
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!this.visible) this.togglePause();
      else if (this.screen !== 'main' && this.screen !== 'results') this.back();
      return;
    }
    if (!this.visible) return;
    const items = this.focusables();
    const active = document.activeElement as HTMLElement | null;
    const i = items.indexOf(active as HTMLElement);
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      const next = i < 0 ? 0 : (i + (e.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && active?.closest('.seg')) {
      e.preventDefault();
      const options = [...active.closest('.seg')!.querySelectorAll<HTMLButtonElement>('button')];
      const j = options.indexOf(active as HTMLButtonElement);
      options[Math.max(0, Math.min(options.length - 1, j + (e.code === 'ArrowRight' ? 1 : -1)))]?.click();
    }
  }
}
