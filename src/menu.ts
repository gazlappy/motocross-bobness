import { BIKE_COLOURS, type BikeColour } from './gltfBikeModel.ts';
import { KIT_COLOURS, type SessionConfig, rivalsFor } from './session.ts';
import { type Difficulty, type Settings, saveSettings } from './settings.ts';
import type { VenueId } from './venue.ts';
import { clockText, ordinal } from './format.ts';
import { BIKES, BIKE_IDS, type BikeId, type BikeSpec } from './bikes.ts';
import {
  type Career, SEASON, TIERS, YOU, buyBike, canEnter, currentEvent, money, newCareer, rideBike, saveCareer, standings, startSeason,
} from './career.ts';
import { type Lobby, MAX_RIDERS } from './net/lobby.ts';
import type { NetSetup } from './net/protocol.ts';
import {
  type Bindings, KEY_ACTIONS, type KeyAction, PAD_ANALOG, PAD_BUTTONS, type PadAnalog, type PadButton,
  bindKey, bindPadButton, defaultBindings, keyName, padButtonName, padInputName, saveBindings, unbindKey,
} from './bindings.ts';
import { type StuntDir, activePad } from './input.ts';
import { STUNT_LIST } from './stunts.ts';
import { recordsFor } from './records.ts';
import { CAMERA_MODES, CAMERA_NAMES } from './camera.ts';
import { DEFAULT_TUNING, ENGINES, type EngineChoice, type Tuning, torqueCurve } from './tuning.ts';

// The front end: main menu over the attract-mode race, game select, options, credits, pause and
// results. Plain DOM, driven by mouse, keyboard (arrows, Enter, Esc) or the gamepad's Start.

export interface MenuHandlers {
  start(config: SessionConfig): void;
  resume(): void;
  restart(): void;
  quit(): void;
  settingsChanged(s: Settings): void;
  /** Start the career season's next event. */
  careerEvent(): void;
  /** Leave a finished career event for the career screen. */
  toCareer(): void;
  /** Leave the multiplayer room (from a game or the lobby). */
  leaveRoom(): void;
  /** Watch a replay of the game so far. */
  replay(): void;
}

type Screen = 'main' | 'select' | 'options' | 'credits' | 'pause' | 'results' | 'career' | 'garage' | 'tuning' | 'multiplayer' | 'lobby' | 'controls';

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

/** The games a multiplayer host can set up. */
const NET_GAMES: { label: string; mode: NetSetup['mode']; venue: VenueId | null }[] = [
  { label: 'Nationals', mode: 'race', venue: 'nationals' },
  { label: 'Supercross', mode: 'race', venue: 'supercross' },
  { label: 'Baja', mode: 'baja', venue: 'baja' },
  { label: 'Tag', mode: 'tag', venue: null },
  { label: 'Free Ride', mode: 'freeride', venue: null },
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
  private resultsCareer = false;
  private career: Career;
  private tier = 0;
  private confirming = '';
  private lobby: Lobby;
  private netStatus = '';
  private netBusy = false;
  private joinCode = '';
  private bindings: Bindings;
  private controlsTab: 'keyboard' | 'gamepad' = 'keyboard';
  /** What's waiting for a key or pad input, and how to stop waiting. */
  private capture: { label: string; stop: () => void } | null = null;
  private controlsNote = '';

  constructor(root: HTMLElement, settings: Settings, career: Career, lobby: Lobby, bindings: Bindings, handlers: MenuHandlers) {
    this.root = root;
    this.settings = settings;
    this.career = career;
    this.lobby = lobby;
    this.bindings = bindings;
    this.tier = career.unlocked;
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

  showResults(tableHtml: string, title = 'Results', career = false) {
    this.resultsHtml = tableHtml;
    this.resultsTitle = title;
    this.resultsCareer = career;
    this.open('results', true);
  }

  /** Back to a screen after a replay. */
  reopen(screen: 'results' | 'pause') {
    this.open(screen, true);
  }

  showCareer() {
    this.open('main', true);
    this.open('career');
  }

  /** The multiplayer lobby (or the join screen with a message, if the room has gone). */
  showLobby(message = '') {
    this.netStatus = message;
    this.open('main', true);
    this.open(this.lobby.room ? 'lobby' : 'multiplayer');
  }

  /** Settings changed outside the menu (a hotkey): redraw if a screen showing them is open. */
  refresh() {
    if (this.screen === 'options' || this.screen === 'controls') this.render();
  }

  /** Something changed in the room: redraw if it's on screen. */
  lobbyChanged() {
    if (this.screen === 'lobby' || this.screen === 'multiplayer') this.render();
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
    if (this.capture && this.screen !== 'controls') this.stopCapture();
    this.panel.innerHTML = '';
    this.panel.dataset.screen = this.screen ?? '';
    const s = this.screen;
    if (s === 'main') this.renderMain();
    else if (s === 'select') this.renderSelect();
    else if (s === 'options') this.renderOptions();
    else if (s === 'credits') this.renderCredits();
    else if (s === 'pause') this.renderPause();
    else if (s === 'results') this.renderResults();
    else if (s === 'career') this.renderCareer();
    else if (s === 'multiplayer') this.renderMultiplayer();
    else if (s === 'lobby') this.renderLobby();
    else if (s === 'controls') this.renderControls();
    else if (s === 'garage') this.renderGarage();
    else if (s === 'tuning') this.renderTuning();
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
    this.button('Career', () => this.open('career'));
    this.button('Single Event', () => this.open('select'));
    this.button('Multiplayer', () => this.open(this.lobby.room ? 'lobby' : 'multiplayer'));
    this.button('Options', () => this.open('options'));
    this.button('Credits', () => this.open('credits'));
    this.panel.append(el('p', 'menu-foot', 'A tribute to Motocross Madness (1998).<br>Arrows + Enter, or the mouse.'));
  }

  private renderSelect() {
    this.title('Single Event');
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
    setup.append(
      this.bikePicker(),
      this.colourPicker(),
    );
    const records = m.venue && (m.mode === 'race' || m.mode === 'baja') ? recordsLine(m.venue, m.mode === 'race' ? st.laps : null) : '';
    if (records) setup.append(el('p', 'menu-foot controls-blurb', records));
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
        bike: st.bike,
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
      this.segmented('Camera', CAMERA_MODES, st.camera, (v) => this.set({ camera: v }), (v) => CAMERA_NAMES[v]),
      this.segmented('Ground', ['realistic', 'retro'], st.retro ? 'retro' : 'realistic', (v) => this.set({ retro: v === 'retro' })),
      this.segmented('Bike model', ['crf450', 'classic'], st.bikeModel, (v) => this.set({ bikeModel: v as Settings['bikeModel'] }), (v) => (v === 'crf450' ? 'CRF 450' : 'Classic')),
      this.segmented('Shadows', ['on', 'off'], st.shadows ? 'on' : 'off', (v) => this.set({ shadows: v === 'on' })),
      this.segmented('Resolution', [1, 0.75, 0.5], st.resolution, (v) => this.set({ resolution: v }), (v) => `${v * 100}%`),
      this.segmented('Controls help', ['show', 'hide'], st.showHelp ? 'show' : 'hide', (v) => this.set({ showHelp: v === 'show' })),
    );
    this.panel.append(list);
    const row = el('div', 'menu-row');
    for (const [label, fn] of [['Controls', () => this.open('controls')], ['Garage', () => this.open('tuning')], ['Back', () => this.back()]] as const) {
      const b = el('button', 'menu-btn small', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      row.append(b);
    }
    this.panel.append(row);
  }

  private renderCredits() {
    this.title('Credits');
    this.panel.append(el('div', 'credits',
      `<p><b>Motocross Bobness</b><br>A browser tribute to <i>Motocross Madness</i> (1998) by Rainbow Studios,
       published by Microsoft. Not affiliated with or endorsed by either.</p>
       <p><b>Bikes</b> (CC BY 4.0)<br>
       "Mid poly dirt bike" by <a href="https://sketchfab.com/danilloribeiro" target="_blank" rel="noopener">danilloribeiro</a><br>
       "(FREE) Honda CRF 450" by <a href="https://skfb.ly/oFqPG" target="_blank" rel="noopener">Jacobdesigns</a></p>
       <p><b>Rider</b><br>Built for the game in Blender, rigged with Adobe Mixamo</p>
       <p><b>Ground textures</b><br><a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a> (CC0)</p>
       <p><b>Built with</b><br>three.js · Rapier physics · Vite · TypeScript</p>
       <p><b>Sound</b><br>Engine, wind, tyres and crashes are synthesised live in the browser.</p>`));
    this.button('Back', () => this.back(), 'menu-btn small');
  }

  private renderPause() {
    const net = this.lobby.room !== null;
    this.title(net ? 'Menu' : 'Paused');
    if (net) this.panel.append(el('p', 'career-note', 'The game carries on while this menu is open.'));
    this.button('Resume', () => this.resume());
    if (!net) {
      this.button('Restart', () => {
        this.hide();
        this.h.restart();
      });
    }
    this.button('Watch replay', () => this.h.replay());
    this.button('Options', () => this.open('options'));
    if (net && this.lobby.isHost) this.button('End game for everyone', () => this.lobby.end());
    this.button(net ? 'Leave the room' : 'Quit to menu', () => (net ? this.h.leaveRoom() : this.h.quit()));
  }

  private renderResults() {
    this.title(this.resultsTitle);
    this.panel.append(el('div', 'results-table', this.resultsHtml));
    if (this.resultsCareer) {
      this.button('Continue', () => this.h.toCareer(), 'menu-btn go');
      this.button('Watch replay', () => this.h.replay());
      return;
    }
    if (this.lobby.room) {
      if (this.lobby.isHost) this.button('Back to the lobby', () => this.lobby.end(), 'menu-btn go');
      else this.panel.append(el('p', 'career-note', 'Waiting for the host to start the next game.'));
      this.button('Leave the room', () => this.h.leaveRoom());
      return;
    }
    this.button('Go again', () => {
      this.hide();
      this.h.restart();
    });
    this.button('Watch replay', () => this.h.replay());
    this.button('Main menu', () => this.h.quit());
  }

  private renderCareer() {
    const c = this.career;
    const season = c.season;
    const event = currentEvent(c);
    this.title('Career');
    this.panel.append(el('div', 'career-bar',
      `<span>Cash <b>${money(c.cash)}</b></span><span>Bike <b>${BIKES[c.bike].name}</b></span>` +
      (c.titles.length ? `<span>Titles <b>${c.titles.length}</b></span>` : '')));

    if (season) {
      const tier = TIERS[season.tier];
      const over = !event;
      this.panel.append(el('h3', 'career-head', `${tier.name}${over ? ': final standings' : ` · event ${season.next + 1} of ${SEASON.length}`}`));
      const list = el('ol', 'career-events');
      SEASON.forEach((e, i) => {
        const done = season.log[i];
        const what = done
          ? done.place ? `${ordinal(done.place)} · +${done.points} pts · ${money(done.cash)}` : `bonus · ${money(done.cash)}`
          : i === season.next ? 'next' : '';
        list.append(el('li', i === season.next ? 'next' : done ? 'done' : '', `<span>${e.name}</span><em>${what}</em>`));
      });
      this.panel.append(list);
      const rows = standings(c).map((name, i) =>
        `<tr class="${name === YOU ? 'me' : ''}"><td>${i + 1}</td><td>${name}</td><td>${season.points[name]}</td></tr>`);
      this.panel.append(el('div', 'results-table', `<table><tr><th></th><th>Championship</th><th>Pts</th></tr>${rows.join('')}</table>`));

      if (event) {
        if (tier.eligible.includes(c.bike)) {
          this.button(`Ride: ${event.name}`, () => {
            this.hide();
            this.h.careerEvent();
          }, 'menu-btn go');
        } else {
          this.panel.append(el('p', 'career-note', `The ${tier.name} needs a ${tier.eligible.map((b) => BIKES[b].name).join(' or ')}. Visit the garage.`));
        }
      }
      if (!over) {
        this.button(this.confirming === 'abandon' ? 'Really abandon the season?' : 'Abandon season', () => {
          if (this.confirming !== 'abandon') {
            this.confirming = 'abandon';
            this.render();
            return;
          }
          this.confirming = '';
          c.season = null;
          saveCareer(c);
          this.render();
        }, 'menu-btn small');
      }
    }

    if (!season || !event) {
      // Pick a series and start a season.
      this.panel.append(el('h3', 'career-head', 'New season'));
      const cards = el('div', 'mode-cards');
      TIERS.forEach((t, i) => {
        const locked = i > c.unlocked;
        const card = el('button', `mode-card${i === this.tier ? ' selected' : ''}`,
          `<b>${t.name}</b><span>${locked ? 'Locked: finish top 3 in the series before.' : `Rivals on ${BIKES[t.rivalBike].name}s, ${t.difficulty}. Prize money ×${t.purse}.`}</span>`);
        card.type = 'button';
        card.disabled = locked;
        card.addEventListener('click', () => {
          this.tier = i;
          this.render();
        });
        cards.append(card);
      });
      this.panel.append(cards);
      const setup = el('div', 'setup');
      setup.append(this.colourPicker());
      this.panel.append(setup);
      if (canEnter(c, this.tier)) {
        this.button('Start season', () => {
          startSeason(c, this.tier, rivalsFor(this.settings.colour), this.settings.colour);
          saveCareer(c);
          this.render();
        }, 'menu-btn go');
      } else {
        const t = TIERS[this.tier];
        this.panel.append(el('p', 'career-note', `The ${t.name} needs a ${t.eligible.map((b) => BIKES[b].name).join(' or ')}. Visit the garage.`));
      }
    }

    const row = el('div', 'menu-row');
    for (const [label, fn] of [['Garage', () => this.open('garage')], ['Back', () => this.back()]] as const) {
      const b = el('button', 'menu-btn small', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      row.append(b);
    }
    if (!season) {
      const reset = el('button', 'menu-btn small', this.confirming === 'reset' ? 'Really wipe the career?' : 'Reset career');
      reset.type = 'button';
      reset.addEventListener('click', () => {
        if (this.confirming !== 'reset') {
          this.confirming = 'reset';
          this.render();
          return;
        }
        this.confirming = '';
        Object.assign(c, newCareer());
        saveCareer(c);
        this.tier = 0;
        this.render();
      });
      row.append(reset);
    }
    this.panel.append(row);
  }

  private renderGarage() {
    const c = this.career;
    this.title('Garage');
    this.panel.append(el('div', 'career-bar', `<span>Cash <b>${money(c.cash)}</b></span>`));
    const peak = Math.max(...BIKE_IDS.map((id) => BIKES[id].peakTorque));
    for (const id of BIKE_IDS) {
      const b = BIKES[id];
      const owned = c.owned.includes(id);
      const card = el('div', `bike-card${c.bike === id ? ' selected' : ''}`,
        `<b>${b.name}</b><span>${b.blurb}</span>` +
        `<div class="bike-stat"><label>Torque</label><i style="width:${Math.round((b.peakTorque / peak) * 100)}%"></i></div>` +
        `<div class="bike-stat"><label>Revs</label><i style="width:${Math.round((b.redline / 14000) * 100)}%"></i></div>`);
      const action = el('button', 'menu-btn small',
        c.bike === id ? 'Riding' : owned ? 'Ride this' : `Buy ${money(b.price)}`);
      action.type = 'button';
      action.disabled = c.bike === id || (!owned && c.cash < b.price);
      action.addEventListener('click', () => {
        if (owned) rideBike(c, id);
        else buyBike(c, id);
        this.render();
      });
      card.append(action);
      this.panel.append(card);
    }
    const row = el('div', 'menu-row');
    for (const [label, fn] of [['Tune the bike', () => this.open('tuning')], ['Back', () => this.back()]] as const) {
      const b = el('button', 'menu-btn small', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      row.append(b);
    }
    this.panel.append(row);
  }

  /** The original's garage: engine curve, springs and damping front and rear, and traction. */
  private renderTuning() {
    this.title('Garage');
    const t = this.settings.tuning;
    const bike = BIKES[this.stack.includes('career') ? this.career.bike : this.settings.bike];
    const set = (patch: Partial<Tuning>) => this.set({ tuning: { ...t, ...patch } });
    const step = (v: number) => ['soft', '-', 'factory', '+', 'stiff'][v + 2];
    const setup = el('div', 'setup');
    setup.append(this.segmented<EngineChoice>('Engine', ENGINES.map((e) => e.id), t.engine, (v) => set({ engine: v }),
      (v) => ENGINES.find((e) => e.id === v)!.name));
    setup.append(el('p', 'menu-foot controls-blurb', ENGINES.find((e) => e.id === t.engine)!.blurb));
    setup.append(powerGraph(bike, t.engine));
    const steps = [-2, -1, 0, 1, 2];
    setup.append(
      this.segmented('Front springs', steps, t.frontSpring, (v) => set({ frontSpring: v }), step),
      this.segmented('Front damping', steps, t.frontDamping, (v) => set({ frontDamping: v }), step),
      this.segmented('Rear springs', steps, t.rearSpring, (v) => set({ rearSpring: v }), step),
      this.segmented('Rear damping', steps, t.rearDamping, (v) => set({ rearDamping: v }), step),
      this.segmented('Traction', steps, t.traction, (v) => set({ traction: v }), (v) => ['hard pack', '-', 'factory', '+', 'soft dirt'][v + 2]),
    );
    setup.append(el('p', 'menu-foot controls-blurb',
      'Soft springs soak up whoops and ruts but bottom out on big landings; stiff ones take the big hits and bounce in the rough. ' +
      'More damping settles the bike sooner but makes it harsher. More traction grips better but the softer tyres drag a little.'));
    this.panel.append(setup);
    const row = el('div', 'menu-row');
    for (const [label, fn] of [['Factory settings', () => this.set({ tuning: { ...DEFAULT_TUNING } })], ['Back', () => this.back()]] as const) {
      const b = el('button', 'menu-btn small', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      row.append(b);
    }
    this.panel.append(row);
  }


  /** You, as the room sees you. */
  me() {
    const st = this.settings;
    return { name: st.playerName.trim().slice(0, 16) || 'Rider', colour: st.colour, bike: st.bike };
  }

  private bikePicker() {
    return this.segmented<BikeId>('Bike', BIKE_IDS, this.settings.bike, (v) => this.set({ bike: v }), shortBike);
  }

  private renderMultiplayer() {
    this.title('Multiplayer');
    const setup = el('div', 'setup');
    const nameRow = el('div', 'setting', '<label>Your name</label>');
    const name = el('input', 'text-input') as HTMLInputElement;
    name.type = 'text';
    name.maxLength = 16;
    name.value = this.settings.playerName;
    name.addEventListener('input', () => this.set({ playerName: name.value }, false));
    nameRow.append(name);
    setup.append(nameRow, this.bikePicker(), this.colourPicker());
    this.panel.append(setup);

    const host = this.button(this.netBusy ? 'Connecting...' : 'Host a game', () => void this.connect(() => this.lobby.host({ id: '', ...this.me() })), 'menu-btn go');
    host.disabled = this.netBusy;

    const joinRow = el('div', 'menu-row');
    const code = el('input', 'text-input code-input') as HTMLInputElement;
    code.type = 'text';
    code.maxLength = 5;
    code.placeholder = 'CODE';
    code.value = this.joinCode;
    code.addEventListener('input', () => (this.joinCode = code.value.toUpperCase()));
    code.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') join.click();
    });
    const join = el('button', 'menu-btn', 'Join') as HTMLButtonElement;
    join.type = 'button';
    join.disabled = this.netBusy;
    join.addEventListener('click', () => {
      if (this.joinCode.trim().length < 5) {
        this.netStatus = 'Type the 5-letter room code from the host.';
        this.render();
        return;
      }
      void this.connect(() => this.lobby.join(this.joinCode, { id: '', ...this.me() }));
    });
    joinRow.append(code, join);
    this.panel.append(joinRow);
    if (this.netStatus) this.panel.append(el('p', 'career-note', this.netStatus));
    this.panel.append(el('p', 'menu-foot', 'Up to 8 riders. The host shares a room code; friends type it in to join. Browsers connect directly (WebRTC).'));
    this.button('Back', () => this.back(), 'menu-btn small');
  }

  private async connect(how: () => Promise<void>) {
    this.netBusy = true;
    this.netStatus = '';
    this.render();
    try {
      await how();
      this.netBusy = false;
      this.screen = 'lobby';
      this.render();
    } catch (e) {
      this.netBusy = false;
      this.netStatus = e instanceof Error ? e.message : String(e);
      this.render();
    }
  }

  private renderLobby() {
    const lobby = this.lobby;
    const host = lobby.isHost;
    this.title(`Room ${lobby.code}`);
    this.panel.append(el('p', 'menu-foot lobby-share', host ? 'Share this code with friends so they can join.' : 'Connected.'));

    const list = el('ul', 'lobby-players');
    for (const p of lobby.players) {
      const tags = [p.id === lobby.hostId ? 'host' : '', p.id === lobby.selfId ? 'you' : ''].filter(Boolean).join(', ');
      const li = el('li', p.id === lobby.selfId ? 'me' : '',
        `<i class="dot" style="--swatch:#${KIT_COLOURS[p.colour].toString(16).padStart(6, '0')}"></i><b>${escapeHtml(p.name)}</b><span>${shortBike(p.bike)}${tags ? ` · ${tags}` : ''}</span>`);
      list.append(li);
    }
    this.panel.append(list);

    const st = lobby.setup;
    const game = NET_GAMES.find((g) => g.mode === st.mode && (g.venue === null || g.venue === st.venue)) ?? NET_GAMES[0];
    const setup = el('div', 'setup');
    if (host) {
      setup.append(this.segmented('Game', NET_GAMES.map((g) => g.label), game.label, (label) => {
        const g = NET_GAMES.find((x) => x.label === label)!;
        const venue = g.venue ?? (g.mode === 'tag' ? (st.venue === 'quarry' ? 'quarry' : 'baja') : st.venue);
        lobby.configure({ mode: g.mode, venue });
      }));
      if (st.mode === 'race') setup.append(this.segmented('Laps', [1, 3, 5], st.laps, (v) => lobby.configure({ laps: v })));
      if (st.mode === 'race' || st.mode === 'baja') {
        setup.append(this.segmented('AI riders', [0, 1, 2, 3, 4, 5, 6], st.ai, (v) => lobby.configure({ ai: v })));
        if (st.ai > 0) setup.append(this.segmented<Difficulty>('AI skill', ['easy', 'medium', 'hard'], st.difficulty, (v) => lobby.configure({ difficulty: v })));
      }
      if (st.mode === 'tag') {
        setup.append(
          this.segmented<VenueId>('Where', ['baja', 'quarry'], st.venue, (v) => lobby.configure({ venue: v }), (v) => VENUE_NAMES[v]),
          this.segmented('Time', [120, 180, 300], st.duration, (v) => lobby.configure({ duration: v }), (v) => `${v / 60} min`),
        );
      }
      if (st.mode === 'freeride') {
        setup.append(this.segmented<VenueId>('Where', ['nationals', 'supercross', 'baja', 'quarry'], st.venue, (v) => lobby.configure({ venue: v }), (v) => VENUE_NAMES[v]));
      }
    } else {
      const bits = [game.label];
      if (st.mode === 'race') bits.push(`${st.laps} lap${st.laps > 1 ? 's' : ''}`);
      if ((st.mode === 'race' || st.mode === 'baja') && st.ai > 0) bits.push(`${st.ai} AI rider${st.ai > 1 ? 's' : ''} (${st.difficulty})`);
      if (st.mode === 'tag' || st.mode === 'freeride') bits.push(VENUE_NAMES[st.venue]);
      if (st.mode === 'tag') bits.push(`${st.duration / 60} min`);
      setup.append(el('div', 'setting', `<label>Game</label><span>${bits.join(' · ')}</span>`));
    }
    setup.append(this.bikePicker(), this.colourPicker());
    this.panel.append(setup);

    if (lobby.inGame) {
      this.panel.append(el('p', 'career-note', 'A game is on. You will join the next one.'));
    } else if (host) {
      const tooFew = st.mode === 'tag' && lobby.players.length < 2;
      if (tooFew) this.panel.append(el('p', 'career-note', 'Tag needs at least two players.'));
      const go = this.button('Start', () => lobby.start(), 'menu-btn go');
      go.disabled = tooFew;
    } else {
      this.panel.append(el('p', 'career-note', 'Waiting for the host to start.'));
    }
    this.button('Leave the room', () => this.h.leaveRoom(), 'menu-btn small');
    if (lobby.players.length >= MAX_RIDERS) this.panel.append(el('p', 'menu-foot', 'The room is full.'));
  }


  private renderControls() {
    this.title('Controls');
    const st = this.settings;
    const setup = el('div', 'setup');
    setup.append(this.segmented('Riding', ['easy', 'advanced'], st.controlScheme, (v) => this.set({ controlScheme: v as Settings['controlScheme'] })));
    setup.append(el('p', 'menu-foot controls-blurb', st.controlScheme === 'easy'
      ? 'Easy: the lean is automatic. Just steer, gas and brake; your rider shifts their weight, the bike lands itself level, stays upright, straightens up for jumps, has traction control, forgives hard landings and shifts for you. Brake hard in a turn to slide the back end out.'
      : 'Advanced: the original controls. You shift the rider\'s weight: forward and back to control wheelies and set up landings, sideways in turns and in the air.'));
    setup.append(this.segmented('Handling', ['classic', 'realistic'], st.handling, (v) => this.set({ handling: v as Settings['handling'] })));
    setup.append(el('p', 'menu-foot controls-blurb', st.handling === 'classic'
      ? 'Classic: the arcade bike. Grippy tyres and a bike that flies itself steady.'
      : 'Realistic: loose dirt. The tyres break away and slide; gas it in a turn and the back end steps out (the rider countersteers to hold it), close the throttle and the engine brakes. In the air, rev the engine to lift the nose and tap the brake to drop it.' +
        (st.controlScheme === 'advanced' ? ' Overdo it and you\'ll wash out the front or spin.' : '')));
    setup.append(this.segmented('Device', ['keyboard', 'gamepad'], this.controlsTab, (v) => {
      this.stopCapture();
      this.controlsTab = v as 'keyboard' | 'gamepad';
      this.controlsNote = '';
      this.render();
    }));
    this.panel.append(setup);
    this.panel.append(stuntTable(this.bindings));

    const table = el('div', 'bind-table');
    const b = this.bindings;
    if (this.controlsTab === 'keyboard') {
      for (const a of KEY_ACTIONS) {
        const row = el('div', 'bind-row', `<label>${a.label}</label>`);
        for (const slot of [0, 1]) {
          const code = b.keys[a.id][slot];
          const waiting = this.capture?.label === `key:${a.id}:${slot}`;
          const btn = el('button', `bind-btn${waiting ? ' waiting' : ''}${slot ? ' alt' : ''}`,
            waiting ? 'Press a key...' : code ? keyName(code) : slot ? '+' : '-');
          btn.type = 'button';
          btn.title = slot ? 'Alternate key' : 'Main key';
          btn.addEventListener('click', () => this.captureKey(a.id, slot));
          row.append(btn);
        }
        table.append(row);
      }
      this.panel.append(table);
      this.panel.append(el('p', 'menu-foot', 'Click a key to change it, then press the new one. Esc cancels; Backspace clears it.'));
    } else {
      const pad = activePad();
      this.panel.append(el('p', 'menu-foot', pad ? `Controller: ${escapeHtml(pad.id.slice(0, 60))}` : 'No controller found: connect one and press any button on it.'));
      for (const a of PAD_ANALOG) {
        const p = b.pad.analog[a.id];
        const waiting = this.capture?.label === `analog:${a.id}`;
        const row = el('div', 'bind-row', `<label>${a.label}</label>`);
        const btn = el('button', `bind-btn wide${waiting ? ' waiting' : ''}`,
          waiting ? (a.twoWay ? `Push the stick ${a.id === 'leanFB' ? 'forward' : 'right'}...` : 'Press a trigger or button...') : padInputName(p));
        btn.type = 'button';
        btn.addEventListener('click', () => this.capturePadAnalog(a.id, a.twoWay));
        row.append(btn);
        if (p?.kind === 'axis') {
          const inv = el('button', `bind-btn${p.invert ? ' on' : ''}`, 'Invert');
          inv.type = 'button';
          inv.addEventListener('click', () => {
            p.invert = !p.invert;
            this.bindingsChanged();
          });
          row.append(inv);
        }
        table.append(row);
      }
      for (const a of PAD_BUTTONS) {
        const waiting = this.capture?.label === `button:${a.id}`;
        const row = el('div', 'bind-row', `<label>${a.label}</label>`);
        const btn = el('button', `bind-btn wide${waiting ? ' waiting' : ''}`, waiting ? 'Press a button...' : padButtonName(b.pad.buttons[a.id]));
        btn.type = 'button';
        btn.addEventListener('click', () => this.capturePadButton(a.id));
        row.append(btn);
        table.append(row);
      }
      this.panel.append(table);
    }
    if (this.controlsNote) this.panel.append(el('p', 'career-note', this.controlsNote));

    const row = el('div', 'menu-row');
    const reset = el('button', 'menu-btn small', `Reset ${this.controlsTab}`);
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.stopCapture();
      const d = defaultBindings();
      if (this.controlsTab === 'keyboard') this.bindings.keys = d.keys;
      else this.bindings.pad = d.pad;
      this.controlsNote = '';
      this.bindingsChanged();
    });
    const back = el('button', 'menu-btn small', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => {
      this.stopCapture();
      this.back();
    });
    row.append(reset, back);
    this.panel.append(row);
  }

  private bindingsChanged() {
    saveBindings(this.bindings);
    this.h.settingsChanged(this.settings);
    this.render();
  }

  private stopCapture() {
    this.capture?.stop();
    this.capture = null;
  }

  /** Wait for a key for `action` (in the capture phase, so nothing else sees it). */
  private captureKey(action: KeyAction, slot: number) {
    this.stopCapture();
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      this.stopCapture();
      if (e.code === 'Escape') {
        this.controlsNote = '';
      } else if (e.code === 'Backspace' || e.code === 'Delete') {
        unbindKey(this.bindings, action, slot);
        this.controlsNote = '';
      } else {
        const taken = bindKey(this.bindings, action, slot, e.code);
        const label = (id: KeyAction) => KEY_ACTIONS.find((a) => a.id === id)!.label;
        this.controlsNote = taken
          ? `${keyName(e.code)} was on ${label(taken)}; it's moved to ${label(action)}.` +
            (this.bindings.keys[taken].length ? '' : ` ${label(taken)} has no key now.`)
          : '';
      }
      this.bindingsChanged();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    this.capture = { label: `key:${action}:${slot}`, stop: () => window.removeEventListener('keydown', onKey, { capture: true }) };
    this.render();
  }

  /** Poll the controller until something new is pressed or pushed; Esc on the keyboard cancels. */
  private capturePad(label: string, found: (pad: Gamepad, base: { buttons: number[]; axes: number[] }) => boolean) {
    this.stopCapture();
    let raf = 0;
    let base: { buttons: number[]; axes: number[] } | null = null;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pad = activePad();
      if (!pad) return;
      // Whatever is held when we start doesn't count.
      if (!base) {
        base = { buttons: pad.buttons.map((x) => x.value), axes: [...pad.axes] };
        return;
      }
      if (found(pad, base)) {
        this.stopCapture();
        this.controlsNote = '';
        this.bindingsChanged();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.stopCapture();
      this.render();
    };
    raf = requestAnimationFrame(poll);
    window.addEventListener('keydown', onKey, { capture: true });
    this.capture = {
      label,
      stop: () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey, { capture: true });
      },
    };
    this.render();
  }

  private capturePadButton(action: PadButton) {
    this.capturePad(`button:${action}`, (pad, base) => {
      const i = pad.buttons.findIndex((x, n) => x.value > 0.6 && base.buttons[n] < 0.3);
      if (i < 0) return false;
      bindPadButton(this.bindings, action, i);
      return true;
    });
  }

  private capturePadAnalog(action: PadAnalog, twoWay: boolean) {
    this.capturePad(`analog:${action}`, (pad, base) => {
      const axis = pad.axes.findIndex((v, n) => Math.abs(v) > 0.6 && Math.abs(v - base.axes[n]) > 0.5);
      if (axis >= 0) {
        // The direction they pushed is the positive one (forward, right, more throttle).
        this.bindings.pad.analog[action] = { kind: 'axis', index: axis, invert: pad.axes[axis] < 0 };
        return true;
      }
      if (twoWay) return false;
      const i = pad.buttons.findIndex((x, n) => x.value > 0.6 && base.buttons[n] < 0.3);
      if (i < 0) return false;
      this.bindings.pad.analog[action] = { kind: 'button', index: i };
      return true;
    });
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
    if (this.lobby.room && ('colour' in patch || 'bike' in patch || 'playerName' in patch)) this.lobby.updateMe(this.me());
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

/** Power against revs for a bike with an engine choice, the stock curve faint behind it. */
function powerGraph(bike: BikeSpec, engine: EngineChoice) {
  const W = 300, H = 110, top = bike.redline * 1.1;
  const canvas = el('canvas', 'power-graph') as HTMLCanvasElement;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const power = (curve: [number, number][], rpm: number) => {
    for (let i = 1; i < curve.length; i++) {
      if (rpm <= curve[i][0]) {
        const [r0, t0] = curve[i - 1], [r1, t1] = curve[i];
        return (t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0)) * rpm;
      }
    }
    return 0;
  };
  const curves = [torqueCurve(bike, 'stock'), torqueCurve(bike, engine)];
  let peak = 0;
  for (const c of curves) for (let r = 0; r <= top; r += 100) peak = Math.max(peak, power(c, r));
  curves.forEach((c, i) => {
    g.strokeStyle = i === 0 ? 'rgba(255,255,255,0.25)' : '#ffb020';
    g.lineWidth = i === 0 ? 1.5 : 2.5;
    g.beginPath();
    for (let r = 0; r <= top; r += 100) {
      const x = (r / top) * (W - 8) + 4, y = H - 16 - (power(c, r) / peak) * (H - 24);
      if (r === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  });
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.font = '11px sans-serif';
  g.fillText(`power vs revs, 0-${Math.round(top / 1000)}k rpm (${bike.name}; faint: stock)`, 4, H - 3);
  return canvas;
}

const DIR_ARROW: Record<StuntDir, string> = {
  none: '', up: '↑', upRight: '↗', right: '→', downRight: '↘', down: '↓', downLeft: '↙', left: '←', upLeft: '↖',
};

/** The sixteen stunts: hold a stunt button in the air and lean one of eight ways (forward = up). */
function stuntTable(b: Bindings) {
  const key = (a: 'stunt1' | 'stunt2') => b.keys[a].map(keyName).join('/') || 'unbound';
  const rows = STUNT_LIST.filter((s) => s.button === 1).map((s) => {
    const other = STUNT_LIST.find((t) => t.button === 2 && t.dir === s.dir)!;
    return `<tr><td class="stunt-dir">${DIR_ARROW[s.dir]}</td><td>${s.name}</td><td>${other.name}</td></tr>`;
  });
  return el('div', 'stunt-table',
    `<table><tr><th>Lean</th><th>${key('stunt1')} +</th><th>${key('stunt2')} +</th></tr>${rows.join('')}</table>` +
    `<p class="menu-foot controls-blurb">In the air, hold a stunt button and lean to pick a stunt; hold it longer for more points, ` +
    `and tuck back in before you land. ${b.keys.dumpster.map(keyName).join('/')}: Big Kahuna Dumpster (a Skurfer, then you leap off the bike: save it for after the finish). ` +
    `${b.keys.taunt.map(keyName).join('/')}: taunt.</p>`);
}

/** Your records at a track, for the event screen. */
function recordsLine(track: string, laps: number | null) {
  const r = recordsFor(track);
  const parts: string[] = [];
  if (laps !== null && r.lap !== undefined) parts.push(`lap ${clockText(r.lap)}`);
  const best = laps === null ? r.baja : r.race?.[String(laps)];
  if (best !== undefined) parts.push(`${laps === null ? 'course' : `${laps}-lap race`} ${clockText(best)}`);
  return parts.length ? `Your records here: ${parts.join(' · ')}` : '';
}

function shortBike(id: BikeId) {
  return BIKES[id].name.replace('cc ', ' ').replace('two-stroke', '2T').replace('four-stroke', '4T');
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
