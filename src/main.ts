import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Input } from './input.ts';
import { loadBindings, keysText, padButtonName, padInputName } from './bindings.ts';
import { CameraRig } from './camera.ts';
import { SoundSystem } from './audio/sound.ts';
import { Session, type SessionConfig } from './session.ts';
import { Menu } from './menu.ts';
import { type Settings, loadSettings, saveSettings } from './settings.ts';
import { clockText, ordinal } from './format.ts';
import type { ResultsTable } from './competition.ts';
import { BajaRace } from './bajaRace.ts';
import { Race } from './race.ts';
import { StuntChallenge } from './stuntChallenge.ts';
import type { Venue } from './venue.ts';
import { buildVenue } from './venues/index.ts';
import { PoseInterpolator } from './interpolation.ts';
import { setTerrainStyle } from './terrain.ts';
import { DirtParticles } from './particles.ts';
import { type EventPayout, SEASON, TIERS, eventConfig, loadCareer, money, recordEvent } from './career.ts';
import { TagGame } from './tag.ts';
import { recordFinish, recordLap, recordsFor } from './records.ts';
import { ReplayPlayer } from './replay.ts';
import { Lobby } from './net/lobby.ts';
import type { NetSetup, RosterEntry } from './net/protocol.ts';
import type { Racer } from './competition.ts';
import bikeUrl from '../assets/models/Bike/mid_poly_dirt_bike.glb?url';
import hondaUrl from '../assets/models/Bike/free_honda_crf_450_1k.glb?url';
import riderUrl from '../assets/models/Rider/mx_rider.glb?url';

const PHYSICS_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 6;

await RAPIER.init();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0xffffff, 100, 500);
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1200);

const hemi = new THREE.HemisphereLight();
scene.add(hemi);
const sun = new THREE.DirectionalLight();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -30;
sc.right = sc.top = 30;
sc.near = 1;
sc.far = 200;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = PHYSICS_DT;
const interp = new PoseInterpolator(world);
const dirt = new DirtParticles();
scene.add(dirt.group);

// The downloaded models, falling back to the box placeholders if either fails to load.
const loader = new GLTFLoader();
const [bikeGltf, riderGltf, hondaGltf] = await Promise.all(
  [bikeUrl, riderUrl, hondaUrl].map((url) => loader.loadAsync(url).catch((e) => (console.warn(`model ${url} failed`, e), null))),
);

const bindings = loadBindings();
const input = new Input(bindings);
const sound = new SoundSystem();
const settings = loadSettings();
const deps = { world, scene, bikeGltf, hondaGltf, riderGltf, sound, bikeStyle: () => settings.bikeModel };

const hud = {
  speed: document.getElementById('speed-val')!,
  speedUnit: document.querySelector<HTMLElement>('#speed small')!,
  gear: document.getElementById('gear')!,
  rpm: document.getElementById('rpm-fill')!,
  help: document.getElementById('help')!,
  banner: document.getElementById('banner')!,
  score: document.getElementById('score-val')!,
  trick: document.getElementById('trick')!,
  race: document.getElementById('race')!,
  loading: document.getElementById('loading')!,
  replay: document.getElementById('replay')!,
  stats: document.getElementById('stats')!,
  speedo: document.getElementById('hud')!,
};

// ---- Venues ---------------------------------------------------------------------------------------

const venues = new Map<string, Venue>();
let venue: Venue;
let rig: CameraRig;

/** Build a venue the first time it's needed (a second or so), behind the loading screen. */
async function getVenue(config: SessionConfig) {
  const id = config.venue;
  // Supercross can be any track in any stadium: one built at a time.
  const key = id === 'supercross' && config.sx ? `supercross|${config.sx.stadium}|${JSON.stringify(config.sx.track)}` : id;
  let v = venues.get(key);
  if (!v) {
    hud.loading.textContent = 'Loading…';
    hud.loading.hidden = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (id === 'supercross') {
      for (const [k, old] of venues) {
        if (!k.startsWith('supercross|')) continue;
        scene.remove(old.root);
        for (const c of old.colliders) world.removeCollider(c, false);
        venues.delete(k);
      }
    }
    v = buildVenue(id, world, id === 'supercross' && config.sx ? { track: config.sx.track ?? undefined, stadium: config.sx.stadium } : undefined);
    scene.add(v.root);
    venues.set(key, v);
  }
  hud.loading.hidden = true;
  return v;
}

/** Show one venue: its scenery and colliders on, every other venue's off, its sky and lighting. */
function useVenue(v: Venue) {
  venue = v;
  dirt.setVenue(v.hm, v.dirt);
  setTerrainStyle(v.root, settings.retro ? 'retro' : 'real');
  for (const other of venues.values()) {
    const on = other === v;
    other.root.visible = on;
    for (const c of other.colliders) c.setEnabled(on);
  }
  const a = v.atmosphere;
  (scene.background as THREE.Color).set(a.sky);
  const fog = scene.fog as THREE.Fog;
  fog.color.set(a.fog.color);
  fog.near = a.fog.near;
  fog.far = a.fog.far;
  hemi.color.set(a.hemi.sky);
  hemi.groundColor.set(a.hemi.ground);
  hemi.intensity = a.hemi.intensity;
  sun.color.set(a.sun.color);
  sun.intensity = a.sun.intensity;
  camera.far = a.far;
  camera.updateProjectionMatrix();
  sound.setCrowd(a.crowd);
  applyView();
  if (rig) rig.hm = v.hm;
  else rig = new CameraRig(camera, v.hm);
}

// ---- HUD ------------------------------------------------------------------------------------------

let bannerTimer = 0;
function flashBanner(html: string, ms: number) {
  hud.banner.innerHTML = html;
  hud.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => hud.banner.classList.remove('show'), ms);
}

let trickHoldUntil = 0;
let trickShown = '';
function showTrick(html: string, banked: boolean, holdMs = 0) {
  if (html === trickShown && !holdMs) return;
  trickShown = html;
  hud.trick.innerHTML = html;
  hud.trick.classList.toggle('banked', banked);
  hud.trick.classList.toggle('show', html !== '');
  trickHoldUntil = holdMs ? performance.now() + holdMs : 0;
}

function tableHtml(t: ResultsTable) {
  const head = `<tr>${t.head.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  const rows = t.rows.map((r) => `<tr class="${r.me ? 'me' : ''}">${r.cells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
  return { title: t.title, html: `<table>${head}${rows.join('')}</table>` };
}

/**
 * A flat chevron over your bike, like the original's: Baja's points at the next waypoint, and a green
 * one points back to where you left the track.
 */
const chevron = new THREE.Shape();
chevron.moveTo(0, 1.1);
chevron.lineTo(0.75, -0.2);
chevron.lineTo(0.28, -0.2);
chevron.lineTo(0.28, -0.8);
chevron.lineTo(-0.28, -0.8);
chevron.lineTo(-0.28, -0.2);
chevron.lineTo(-0.75, -0.2);
chevron.closePath();
const arrow = new THREE.Mesh(
  new THREE.ExtrudeGeometry(chevron, { depth: 0.12, bevelEnabled: false }).rotateX(Math.PI / 2), // lie flat, point +Z
  new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.92, depthTest: false }),
);
arrow.renderOrder = 10;
arrow.visible = false;
scene.add(arrow);

/** Tag: a big arrow over whoever is it. */
const itMarker = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.9, depthTest: false });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4).rotateX(Math.PI), mat);
  cone.position.y = 3.3;
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 60, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  );
  column.position.y = 34;
  itMarker.add(cone, column);
  itMarker.renderOrder = 10;
  itMarker.visible = false;
  scene.add(itMarker);
}

const ATTRACT: SessionConfig = {
  mode: 'attract', venue: 'nationals', laps: 999, opponents: 7, difficulty: 'medium', colour: 'red', duration: 0,
};
let session: Session;
let lastConfig: SessionConfig = ATTRACT;
const career = loadCareer();
/** The game running is a career event: its result goes on the career. */
let careerRun = false;
let careerSummary = '';
/** Track records shown under the results. */
let recordSummary = '';
/** Under the countdown numbers: which career event this is. */
let countdownCaption = '';
let lastCount = -1;
let resultsTimer = 0;
/** Watching a replay (the game itself is frozen meanwhile), and which screen to go back to. */
let replay: ReplayPlayer | null = null;
/**
 * The original's in-game hot keys: F5 statistics, F6 visual cues (arrows and markers), F7
 * speedometer, F8 scenery (stands, dressing, rocks), F9 dust, F10 shadows, F11/F12 graphics quality
 * down/up, B rider names; PageUp/PageDown watch the other riders.
 */
const view = { stats: false, cues: true, speedo: true, scenery: true, particles: true, names: false };
/** Which rider the camera is watching (an index into the game's riders), or null for the usual one. */
let watching: number | null = null;
const nameTags = new Map<object, THREE.Sprite>();
const stats = { topSpeed: 0, air: 0, longestAir: 0, fps: 60 };
let replayFrom: 'results' | 'pause' = 'results';

/** Tear down whatever is running and start a game (or the menu's attract mode). */
async function begin(config: SessionConfig) {
  stopReplay(false);
  watching = null;
  for (const tag of nameTags.values()) scene.remove(tag);
  nameTags.clear();
  Object.assign(stats, { topSpeed: 0, air: 0, longestAir: 0 });
  session?.dispose();
  clearTimeout(resultsTimer);
  useVenue(await getVenue(config));
  interp.clear();
  session = new Session(deps, venue, config);
  dirt.clear();
  lastCount = -1;
  hud.banner.classList.remove('show');
  showTrick('', false);
  hud.score.textContent = '0';
  rig.setMode(config.mode === 'attract' ? 'thrill' : settings.camera);
  hud.help.hidden = config.mode === 'attract' || !settings.showHelp;
  attachHud();
}

/** Hook the HUD, sounds and event callbacks to the human rider of the current game. */
function attachHud() {
  const me = session.human;
  if (!me) return;
  const p = me.player;
  p.bike.autoShift = settings.gearbox === 'auto' || settings.controlScheme === 'easy';
  p.bike.assist = settings.controlScheme === 'easy';
  p.bike.realistic = settings.handling === 'realistic';
  p.bike.setTuning(settings.tuning);
  p.stunts.onTrick = (name, points) => {
    if (performance.now() < trickHoldUntil) return;
    showTrick(name ? `${name}<b>${Math.round(points).toLocaleString()}</b>` : '', false);
  };
  p.stunts.onBank = (points, label) => {
    sound.score();
    sound.cheer(Math.min(1, points / 2500));
    showTrick(`${label}<b>+${points.toLocaleString()}</b>`, true, 2200);
    hud.score.textContent = p.stunts.total.toLocaleString();
  };
  p.onCrash = (cause) => {
    sound.impact(1);
    sound.cheer(0.5);
    clearTimeout(bannerTimer);
    hud.banner.innerHTML = `WIPEOUT!<small>${cause}</small>`;
    hud.banner.classList.add('show');
  };
  p.onRespawn = () => hud.banner.classList.remove('show');
  p.onCannon = () => {
    sound.cannon();
    flashBanner('KA-BOOM!<small>out of bounds</small>', 1800);
  };
  p.onImpact = (s) => sound.impact(s * 0.7);

  const event = session.event;
  if (!event) return;
  const track = recordKey(session.config);
  recordSummary = '';
  event.onLap = (r, lap, time) => {
    if (!r.human || !(event instanceof Race)) return;
    const record = recordLap(track, time);
    if (lap < event.laps) flashBanner(`${record ? 'LAP RECORD!' : `LAP ${lap + 1}`}<small>${clockText(time)}</small>`, 1500);
    else if (record) flashBanner(`LAP RECORD!<small>${clockText(time)}</small>`, 1500);
  };
  if (event instanceof TagGame) {
    event.onTag = (it, by) => {
      lobby.sendTag(event.ids.get(it)!, event.times());
      announceTag(it, by);
    };
  }
  if (event instanceof BajaRace) {
    event.onWaypoint = (r, i) => {
      if (!r.human || i === event.waypoints.length - 1) return;
      sound.score();
      flashBanner(`WAYPOINT ${i + 1}<small>${clockText(event.clock)}</small>`, 1300);
    };
  }
  event.onFinish = (r, place) => {
    // Multiplayer: our riders' finishes are ours to announce.
    const local = session.entries.find((e) => e.racer === r && e.netId);
    if (local && !(event instanceof TagGame)) lobby.sendFinish(local.netId!, r.finishTime);
    if (r.human && careerRun) {
      careerRun = false;
      const order = event instanceof StuntChallenge ? null : event.standings().map((x) => x.name);
      careerSummary = payoutHtml(recordEvent(career, order, p.stunts.total));
    }
    if (r.human && (event instanceof Race || event instanceof BajaRace)) {
      const record = recordFinish(track, r.finishTime, event instanceof Race ? event.laps : null);
      recordSummary = recordsHtml(track, event instanceof Race ? event.laps : null, record);
    }
    if (r.human) {
      const msg = event instanceof StuntChallenge
        ? `TIME UP!<small>${p.stunts.total.toLocaleString()} points${event.newBest ? ' · new best!' : ''}</small>`
        : event instanceof TagGame
          ? `TIME UP!<small>${ordinal(place)} · ${clockText(event.timeIt.get(r) ?? 0)} as it</small>`
          : `${ordinal(place).toUpperCase()}!<small>${clockText(r.finishTime)}</small>`;
      flashBanner(msg, 2500);
      sound.cheer(1);
      resultsTimer = window.setTimeout(() => {
        const t = tableHtml(event.results());
        menu.showResults(t.html + recordSummary + careerSummary, t.title, careerSummary !== '');
      }, 2700);
    } else if (menu.screenName === 'results') {
      const t = tableHtml(event.results());
      menu.showResults(t.html + recordSummary + careerSummary, t.title, careerSummary !== '');
    }
  };
}

/** Which track records a game counts towards: the venue (and its track, where there's a choice). */
function recordKey(config: SessionConfig) {
  return config.sx?.track ? `supercross:${config.sx.track.name}` : config.venue;
}

/** The records for a track, under the results. */
function recordsHtml(track: string, laps: number | null, newRecord: boolean) {
  const r = recordsFor(track);
  const lines: string[] = [];
  if (laps !== null && r.lap !== undefined) lines.push(`Lap record: <b>${clockText(r.lap)}</b>`);
  const best = laps === null ? r.baja : r.race?.[String(laps)];
  if (best !== undefined) lines.push(`${laps === null ? 'Course' : `${laps}-lap`} record: <b>${clockText(best)}</b>${newRecord ? ' · <b>NEW!</b>' : ''}`);
  return lines.length ? `<div class="career-payout">${lines.map((l) => `<p>${l}</p>`).join('')}</div>` : '';
}

function announceTag(it: Racer, by: Racer | null) {
  sound.score();
  if (it.human) flashBanner(`YOU'RE IT!<small>${by ? `tagged by ${by.name}` : 'get someone!'}</small>`, 1600);
  else flashBanner(`${it.name.toUpperCase()} IS IT!`, 1300);
}

/** What a career event paid, shown under its results. */
function payoutHtml(p: EventPayout) {
  const lines = [p.place ? `${ordinal(p.place)} place: <b>+${p.points} pts</b> · <b>${money(p.cash)}</b>` : `Stunt bonus: <b>${money(p.cash)}</b>`];
  if (p.final) {
    lines.push(`Championship: <b>${ordinal(p.final.position)}</b>${p.final.bonus ? ` · bonus <b>${money(p.final.bonus)}</b>` : ''}`);
    if (p.final.title) lines.push(`<b>${p.final.title.toUpperCase()}!</b>`);
    if (p.final.unlocked) lines.push(`Unlocked: <b>${p.final.unlocked}</b>`);
  }
  return `<div class="career-payout">${lines.map((l) => `<p>${l}</p>`).join('')}<p>Bank: <b>${money(career.cash)}</b></p></div>`;
}

let offCourseShown = -1;
/** Racing: count down while the rider is off the course, before they're put back on it. */
function updateOffCourse() {
  const left = session.human?.player.offCourseCountdown ?? null;
  const n = left === null ? -1 : Math.ceil(left);
  if (n === offCourseShown) return;
  offCourseShown = n;
  if (n > 0) flashBanner(`OFF COURSE<small>back on the track in ${n}</small>`, 1200);
}

function updateEventHud() {
  const me = session.human;
  const event = session.event;
  arrow.visible = false;
  itMarker.visible = false;
  if (!me) return;
  if (!event) {
    hud.race.innerHTML = `FREE RIDE · ${venue.name.toUpperCase()} &nbsp; <b>Esc</b> for the menu`;
    return;
  }
  const r = me.racer!;
  if (session.waiting) {
    hud.race.innerHTML = 'WAITING FOR THE OTHER RIDERS...';
    return;
  }
  if (event instanceof TagGame) {
    const it = event.it;
    itMarker.visible = it !== null && !it.finished;
    if (it) {
      const t = it.player.bike.body.translation();
      itMarker.position.set(t.x, t.y, t.z);
    }
  }
  if (!event.started) {
    const n = Math.ceil(-event.clock);
    if (n !== lastCount && n <= 3 && n >= 1) {
      lastCount = n;
      flashBanner(`${n}${countdownCaption}`, 900);
      sound.impact(0.25);
    }
  } else if (lastCount !== 0) {
    lastCount = 0;
    flashBanner('GO!', 900);
    hud.help.hidden = true;
    sound.score();
    sound.cheer(0.6);
  }
  hud.race.innerHTML = event.hud(r);

  const back = me.player.offCourseTarget;
  if (back && !r.finished) {
    const t = me.player.bike.body.translation();
    (arrow.material as THREE.MeshBasicMaterial).color.set(0x3dff5a);
    arrow.visible = true;
    arrow.position.set(t.x, t.y + 2.6, t.z);
    arrow.lookAt(back.x, t.y + 2.6, back.z);
    arrow.rotateX(0.35);
    return;
  }
  (arrow.material as THREE.MeshBasicMaterial).color.set(0xffb020);
  if (event instanceof BajaRace) {
    // Beacons: the next waypoint glows orange, ones already reached go green and faint.
    venue.markers?.forEach((m, i) => {
      const beacon = m.getObjectByName('beacon') as THREE.Mesh;
      const mat = beacon.material as THREE.MeshBasicMaterial;
      const next = i === r.nextCheckpoint;
      mat.color.set(i < r.nextCheckpoint ? 0x7dff6a : next ? 0xff8c1a : 0xffffff);
      mat.opacity = i < r.nextCheckpoint ? 0.06 : next ? 0.35 : 0.12;
    });
    if (!r.finished) {
      const t = me.player.bike.body.translation();
      const w = event.target(r);
      arrow.visible = true;
      arrow.position.set(t.x, t.y + 2.6, t.z);
      arrow.lookAt(w.x, t.y + 2.6, w.z);
      arrow.rotateX(0.35); // tilt the tail up towards the camera so it reads from behind
    }
  }
}

/** The controls help, from the current key and pad bindings. */
function helpHtml() {
  const k = (a: Parameters<typeof keysText>[1]) => `<b>${keysText(bindings, a)}</b>`;
  const pad = bindings.pad;
  const lean = settings.controlScheme === 'easy'
    ? `${k('leanForward')}${k('leanBack')}${k('leanLeft')}${k('leanRight')} lean (optional: Easy controls lean for you)`
    : `${k('leanForward')}/${k('leanBack')} lean fwd/back &nbsp; ${k('leanLeft')}/${k('leanRight')} lean sideways`;
  return `${k('throttle')} throttle &nbsp; ${k('brake')} brake &nbsp; ${k('steerLeft')}/${k('steerRight')} steer &nbsp; ${lean} &nbsp; ` +
    `${k('stunt1')}/${k('stunt2')} + lean keys: 16 stunts (in the air; list in Options &gt; Controls) &nbsp; ${k('taunt')} taunt &nbsp; ${k('dumpster')} Big Kahuna Dumpster &nbsp; ${k('shiftDown')}/${k('shiftUp')} shift &nbsp; ${k('toggleAuto')} auto/manual &nbsp; ` +
    `${k('camera')} camera (PgUp/PgDn: watch others) &nbsp; ${k('reset')} reset / skip wipeout &nbsp; ${k('mute')} mute &nbsp; ${k('toggleRetro')} retro look &nbsp; ${k('help')} hide help &nbsp; ` +
    `F5 stats · F6 cues · F7 speedo · F8 scenery · F9 dust · F10 shadows · F11/F12 quality · B names` +
    `<br />Gamepad: ${padInputName(pad.analog.throttle)} gas, ${padInputName(pad.analog.brake)} brake, ${padInputName(pad.analog.steer)} steer, ` +
    `${padInputName(pad.analog.leanFB)} / ${padInputName(pad.analog.leanLR)} lean, ${padButtonName(pad.buttons.stunt1)}/${padButtonName(pad.buttons.stunt2)} + lean: stunts, ` +
    `${padButtonName(pad.buttons.reset)} reset, ${padButtonName(pad.buttons.camera)} camera &nbsp; Rebind in Options &gt; Controls`;
}

function applySettings(s: Settings) {
  if (venue) setTerrainStyle(venue.root, s.retro ? 'retro' : 'real');
  sound.setVolume(s.volume);
  if (sound.isMuted !== s.muted) sound.toggleMute();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * s.resolution);
  if (renderer.shadowMap.enabled !== s.shadows) {
    renderer.shadowMap.enabled = s.shadows;
    sun.castShadow = s.shadows;
    // Materials compile with or without shadow code, so they need rebuilding.
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mat) => (mat.needsUpdate = true));
    });
  }
  hud.speedUnit.textContent = s.units === 'kmh' ? 'KM/H' : 'MPH';
  const me = session?.human;
  if (me) me.player.bike.autoShift = s.gearbox === 'auto' || s.controlScheme === 'easy';
  if (me) me.player.bike.assist = s.controlScheme === 'easy';
  if (me) me.player.bike.realistic = s.handling === 'realistic';
  if (me) me.player.bike.setTuning(s.tuning);
  hud.help.innerHTML = helpHtml();
  if (me && rig && rig.mode !== s.camera) rig.setMode(s.camera);
}

const lobby = new Lobby();

const menu = new Menu(document.getElementById('menu')!, settings, career, lobby, bindings, {
  start(config) {
    careerRun = false;
    careerSummary = '';
    countdownCaption = '';
    lastConfig = config;
    void begin(config);
  },
  careerEvent() {
    careerSummary = '';
    lastConfig = eventConfig(career);
    const s = career.season!;
    countdownCaption = `<small>${TIERS[s.tier].name} · ${SEASON[s.next].name} (${s.next + 1}/${SEASON.length})</small>`;
    void begin(lastConfig).then(() => {
      careerRun = true;
    });
  },
  async toCareer() {
    await begin(ATTRACT);
    menu.showCareer();
  },
  resume() {},
  restart() {
    // A career event restarted from the pause menu still counts; one already banked doesn't run again.
    const wasCareer = careerRun;
    void begin(lastConfig).then(() => {
      careerRun = wasCareer;
    });
  },
  quit() {
    careerRun = false;
    void goToMenu();
  },
  leaveRoom() {
    lobby.leave();
    void goToMenu();
  },
  settingsChanged: applySettings,
  replay() {
    if (session.recorder.length < 20) {
      flashBanner('NO REPLAY<small>nothing recorded yet</small>', 1200);
      return;
    }
    replayFrom = menu.screenName === 'pause' ? 'pause' : 'results';
    replay = new ReplayPlayer(session.recorder.recording(), session.replayFocus);
    menu.hide();
    rig.setMode('thrill');
    hud.replay.hidden = false;
  },
});

/** Leave a replay, back to the screen it was started from. */
function stopReplay(reopen = true) {
  if (!replay) return;
  replay = null;
  hud.replay.hidden = true;
  rig.setMode(session?.config.mode === 'attract' ? 'thrill' : settings.camera);
  if (reopen) menu.reopen(replayFrom);
}

addEventListener('keydown', (e) => {
  const toggle = (k: 'stats' | 'cues' | 'speedo' | 'scenery' | 'particles' | 'names', label: string) => {
    view[k] = !view[k];
    flashBanner(`${label}<small>${view[k] ? 'on' : 'off'}</small>`, 900);
    applyView();
  };
  if (e.code === 'F5') toggle('stats', 'STATISTICS');
  else if (e.code === 'F6') toggle('cues', 'VISUAL CUES');
  else if (e.code === 'F7') toggle('speedo', 'SPEEDOMETER');
  else if (e.code === 'F8') toggle('scenery', 'SCENERY');
  else if (e.code === 'F9') toggle('particles', 'PARTICLES');
  else if (e.code === 'KeyB' && !menu.visible) toggle('names', 'RIDER NAMES');
  else if (e.code === 'F10') {
    settings.shadows = !settings.shadows;
    saveSettings(settings);
    applySettings(settings);
    flashBanner(`SHADOWS<small>${settings.shadows ? 'on' : 'off'}</small>`, 900);
  } else if (e.code === 'F11' || e.code === 'F12') {
    const steps = [0.5, 0.75, 1];
    const i = steps.indexOf(settings.resolution);
    settings.resolution = steps[THREE.MathUtils.clamp((i < 0 ? 2 : i) + (e.code === 'F12' ? 1 : -1), 0, 2)];
    saveSettings(settings);
    applySettings(settings);
    flashBanner(`GRAPHICS<small>${settings.resolution * 100}% resolution</small>`, 900);
  } else if (e.code.startsWith('Numpad') && rig) {
    // The original's camera keys: +/- distance, 4/6 orbit, 8/2 height, 5 next view, 0 Bird's-Eye.
    const u = rig.user;
    if (e.code === 'NumpadAdd') u.zoom = Math.max(0.5, u.zoom - 0.1);
    else if (e.code === 'NumpadSubtract') u.zoom = Math.min(2.5, u.zoom + 0.1);
    else if (e.code === 'Numpad4') u.orbit += 0.15;
    else if (e.code === 'Numpad6') u.orbit -= 0.15;
    else if (e.code === 'Numpad8') u.raise = Math.min(8, u.raise + 0.4);
    else if (e.code === 'Numpad2') u.raise = Math.max(-1.5, u.raise - 0.4);
    else if (e.code === 'Numpad5') rig.cycle();
    else if (e.code === 'Numpad0') rig.setMode('birdseye');
    else return;
  } else if ((e.code === 'PageUp' || e.code === 'PageDown') && session && !menu.visible && !replay) {
    const n = session.entries.length;
    const from = watching ?? session.entries.indexOf(session.star);
    watching = (from + (e.code === 'PageDown' ? 1 : n - 1)) % n;
    if (session.human && watching === session.entries.indexOf(session.human)) watching = null;
    rig.setMode(rig.mode);
    flashBanner(`WATCHING<small>${(watching === null ? session.human ?? session.star : session.entries[watching]).name}</small>`, 900);
  } else return;
  e.preventDefault();
});

/** Apply the hot-key toggles to the scene and HUD. */
function applyView() {
  hud.stats.hidden = !view.stats;
  hud.speedo.hidden = !view.speedo;
  dirt.group.visible = view.particles;
  for (const v of venues.values()) {
    for (const c of v.root.children) if (!c.userData.terrain) c.visible = view.scenery;
  }
}

/** A floating name over a rider, drawn on a little canvas. */
function nameTag(name: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 8, 256, 48);
  g.fillStyle = '#ffb020';
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.fillText(name.toUpperCase(), 128, 43);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }));
  sprite.scale.set(1.9, 0.48, 1);
  sprite.renderOrder = 9;
  return sprite;
}

/** Keep the name tags over the riders (everyone but you). */
function updateNameTags() {
  const riders = [
    ...session.entries.filter((e) => e !== session.human).map((e) => ({ key: e as object, name: e.name, at: e.player.focus ?? e.player.bike.body.translation() })),
    ...session.remotes.map((r) => ({ key: r as object, name: r.roster.name, at: r.rider.bike.body.translation() })),
  ];
  for (const r of riders) {
    let tag = nameTags.get(r.key);
    if (!tag) {
      tag = nameTag(r.name);
      nameTags.set(r.key, tag);
      scene.add(tag);
    }
    tag.visible = view.names;
    tag.position.set(r.at.x, r.at.y + 2.4, r.at.z);
  }
}

function updateStats(dt: number, bike: { speed: number; grounded: boolean }) {
  stats.fps += ((dt > 0 ? 1 / dt : 60) - stats.fps) * 0.05;
  const mph = Math.abs(bike.speed) * 2.237;
  stats.topSpeed = Math.max(stats.topSpeed, mph);
  stats.air = bike.grounded ? 0 : stats.air + dt;
  stats.longestAir = Math.max(stats.longestAir, stats.air);
  if (!view.stats) return;
  hud.stats.textContent =
    `FPS        ${stats.fps.toFixed(0)}\n` +
    `Top speed  ${stats.topSpeed.toFixed(0)} mph\n` +
    `Air time   ${stats.air.toFixed(1)} s\n` +
    `Longest    ${stats.longestAir.toFixed(1)} s`;
}

// Replay controls: Space pauses, Left/Right skip 5 s, N follows the next rider (C and Esc as in a game).
addEventListener('keydown', (e) => {
  if (!replay) return;
  if (e.code === 'Space') replay.paused = !replay.paused;
  else if (e.code === 'ArrowLeft') replay.seek(replay.time - 5);
  else if (e.code === 'ArrowRight') replay.seek(replay.time + 5);
  else if (e.code === 'KeyN') {
    replay.focus = (replay.focus + 1) % replay.riders.length;
    rig.setMode(rig.mode);
  } else return;
  e.preventDefault();
});

function updateReplayHud(r: ReplayPlayer) {
  const t = r.time - r.start;
  hud.replay.innerHTML = `REPLAY <b>${clockText(t)}</b> / ${clockText(r.duration)}${r.paused ? ' &nbsp; PAUSED' : ''}` +
    ` &nbsp; <small>Space pause · ←/→ skip · C camera · N next rider · Esc back</small>`;
}

// ---- Multiplayer ----------------------------------------------------------------------------------

function netConfig(setup: NetSetup, roster: RosterEntry[]): SessionConfig {
  const mine = roster.find((r) => r.owner === lobby.selfId && !r.ai);
  return {
    mode: setup.mode, venue: setup.venue, laps: setup.laps, opponents: 0, difficulty: setup.difficulty,
    colour: mine?.colour ?? settings.colour, duration: setup.duration, bike: mine?.bike,
    net: { self: lobby.selfId, host: lobby.isHost, roster },
  };
}

lobby.onChange = () => menu.lobbyChanged();
lobby.onStart = (setup, roster) => {
  // Joined just as it started: sit this one out in the lobby.
  if (!roster.some((r) => r.owner === lobby.selfId)) return;
  menu.hide();
  careerRun = false;
  careerSummary = '';
  countdownCaption = '';
  lastConfig = netConfig(setup, roster);
  void begin(lastConfig).then(() => lobby.markReady());
};
lobby.onGo = () => {
  if (session.config.net) session.waiting = false;
};
lobby.onSnap = (id, s) => session.receive(id, s, performance.now());
lobby.onFinish = (id, time) => {
  const racer = session.remotes.find((r) => r.rider.id === id)?.racer;
  if (racer) session.event?.finishRacer?.(racer, time);
};
lobby.onTag = (itId, times) => {
  const event = session.event;
  if (!(event instanceof TagGame)) return;
  const before = event.it;
  event.applyTag(itId, times);
  if (event.it && event.it !== before) announceTag(event.it, before);
};
lobby.onLeft = (id) => {
  const gone = session.remotes.find((r) => r.roster.owner === id);
  session.dropOwner(id);
  if (gone && session.human) flashBanner(`${gone.roster.name.toUpperCase()} LEFT`, 1500);
};
lobby.onEnd = () => {
  void begin(ATTRACT).then(() => menu.showLobby());
};
lobby.onClosed = (reason) => {
  void begin(ATTRACT).then(() => menu.showLobby(reason));
};

async function goToMenu() {
  await begin(ATTRACT);
  menu.showMain();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

applySettings(settings);
await goToMenu();

// ---- Main loop ------------------------------------------------------------------------------------

const IDLE = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };

// ?perf in the address: record where each frame's time goes (window.perf), for hunting dropped frames.
// GPU time comes from a timer query when the browser offers one.
const PERF = new URLSearchParams(location.search).has('perf');
interface FrameTiming { at: number; dt: number; steps: number; physics: number; logic: number; draw: number; gpu: number | null }
const perfLog: FrameTiming[] = [];
const gl = renderer.getContext() as WebGL2RenderingContext;
const timerExt = PERF ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
const pendingQueries: { query: WebGLQuery; entry: FrameTiming }[] = [];
if (PERF) Object.assign(window, { perf: perfLog });
let accumulator = 0;
let last = performance.now();
let lastSnap = 0;
let lastTagSync = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const t0 = PERF ? performance.now() : 0;
  let t1 = 0, t2 = 0, perfSteps = 0;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!hud.loading.hidden) return; // a venue is being built
  const me = session.human;
  // A game freezes while its pause menu is up; the attract mode, the results and network games keep going.
  const net = !!session.config.net;
  const running = !me || !menu.visible || menu.screenName === 'results' || net;
  const playing = me !== null && !menu.visible;

  if (replay) {
    frameReplay(replay, dt);
    return;
  }
  for (const a of input.takeActions()) {
    if (a === 'pause') {
      if (me) menu.togglePause();
      continue;
    }
    if (a === 'mute') {
      settings.muted = !settings.muted;
      applySettings(settings);
    }
    if (a === 'toggleRetro') {
      settings.retro = !settings.retro;
      saveSettings(settings);
      applySettings(settings);
      menu.refresh();
      flashBanner(settings.retro ? 'RETRO<small>original look</small>' : 'REALISTIC<small>ground</small>', 1100);
    }
    if (!playing || !me) continue;
    const bike = me.player.bike;
    if (a === 'reset') me.player.reset();
    else if (a === 'camera') rig.cycle();
    else if (a === 'shiftUp') { bike.autoShift = false; bike.shift(1); }
    else if (a === 'shiftDown') { bike.autoShift = false; bike.shift(-1); }
    else if (a === 'toggleAuto') bike.autoShift = !bike.autoShift;
    else if (a === 'help') hud.help.hidden = !hud.help.hidden;
    else if (a === 'taunt') me.player.stunts.taunt();
    else if (a === 'dumpster' && !me.player.crashed) me.player.stunts.dumpster();
  }

  const mine = input.read(dt);
  if (running) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
      interp.record();
      session.step(playing ? mine : IDLE, PHYSICS_DT);
      accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    if (PERF) {
      t1 = performance.now();
      perfSteps = steps;
    }
    session.tick(dt);
    dirt.update(dt, [...session.entries.map((e) => e.player.bike), ...session.remotes.map((r) => r.rider.bike)]);
    // Draw part way between the last two physics steps so motion is smooth at any refresh rate.
    interp.apply(accumulator / PHYSICS_DT);
    session.render();
  }
  if (net && now - lastSnap > 50) {
    lastSnap = now;
    lobby.sendSnaps(session.snapshots(now));
  }
  if (net && lobby.isHost && session.event instanceof TagGame && session.event.it && now - lastTagSync > 1000) {
    lastTagSync = now;
    lobby.sendTag(session.event.ids.get(session.event.it)!, session.event.times());
  }

  const star = watching !== null && session.entries[watching] ? session.entries[watching] : session.star;
  const bike = star.player.bike;
  sound.update(me && running ? me.player.bike : null, camera);
  updateEventHud();
  updateOffCourse();
  if (!view.cues) {
    arrow.visible = false;
    itMarker.visible = false;
  }
  updateNameTags();
  updateStats(dt, bike);
  const focus = star.player.focus;
  if (running) rig.update(bike, dt, focus);
  const t = focus ?? bike.body.translation();
  sun.position.set(t.x, t.y, t.z).add(venue.atmosphere.sun.offset);
  sun.target.position.set(t.x, t.y, t.z);

  const speed = Math.abs(bike.speed) * (settings.units === 'kmh' ? 3.6 : 2.237);
  hud.speed.textContent = String(Math.round(speed));
  hud.gear.textContent = (bike.autoShift ? '' : 'M') + (bike.gear + 1);
  hud.rpm.style.width = `${Math.max(0, Math.min(1, bike.rpmFraction)) * 100}%`;

  interp.restore();
  dirt.setView(camera, renderer.domElement.height);
  if (!PERF) {
    renderer.render(scene, camera);
    return;
  }
  t2 = performance.now();
  const query = timerExt ? gl.createQuery() : null;
  if (query) gl.beginQuery(timerExt!.TIME_ELAPSED_EXT, query);
  renderer.render(scene, camera);
  if (query) gl.endQuery(timerExt!.TIME_ELAPSED_EXT);
  const t3 = performance.now();
  const entry: FrameTiming = {
    at: now, dt: dt * 1000, steps: perfSteps,
    physics: t1 ? t1 - t0 : 0, logic: t2 - (t1 || t0), draw: t3 - t2, gpu: null,
  };
  perfLog.push(entry);
  if (perfLog.length > 3000) perfLog.shift();
  if (query) pendingQueries.push({ query, entry });
  // Collect GPU times that have arrived.
  while (pendingQueries.length && gl.getQueryParameter(pendingQueries[0].query, gl.QUERY_RESULT_AVAILABLE)) {
    const { query: q, entry: e } = pendingQueries.shift()!;
    if (!gl.getParameter(timerExt!.GPU_DISJOINT_EXT)) e.gpu = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(q);
  }
}
requestAnimationFrame(frame);

/** A frame of replay: the game stays frozen; the models follow the recording. */
function frameReplay(r: ReplayPlayer, dt: number) {
  for (const a of input.takeActions()) {
    if (a === 'pause') stopReplay();
    else if (a === 'camera') rig.cycle();
  }
  if (!replay) return;
  arrow.visible = false;
  itMarker.visible = false;
  r.advance(dt);
  if (r.finished && !r.paused) r.paused = true;
  session.showReplay(r);
  const view = r.riders[r.focus].view;
  // The camera takes the replay rider for a bike: it only reads its position, heading and speed.
  rig.update(view as unknown as Parameters<CameraRig['update']>[0], dt, null);
  const t = view.body.translation();
  sun.position.set(t.x, t.y, t.z).add(venue.atmosphere.sun.offset);
  sun.target.position.set(t.x, t.y, t.z);
  sound.update(null, camera);
  hud.speed.textContent = String(Math.round(Math.abs(view.speed) * (settings.units === 'kmh' ? 3.6 : 2.237)));
  updateReplayHud(r);
  dirt.setView(camera, renderer.domElement.height);
  renderer.render(scene, camera);
}

// Handy for poking at the sim from the dev console.
Object.assign(window, { game: { get session() { return session; }, get venue() { return venue; }, world, interp, lobby, rig: () => rig, sound, scene, menu, settings, venues, renderer } });
