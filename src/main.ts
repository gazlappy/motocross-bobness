import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Input } from './input.ts';
import { CameraRig } from './camera.ts';
import { SoundSystem } from './audio/sound.ts';
import { Session, type SessionConfig } from './session.ts';
import { Menu } from './menu.ts';
import { type Settings, loadSettings } from './settings.ts';
import { clockText, ordinal } from './format.ts';
import type { ResultsTable } from './competition.ts';
import { BajaRace } from './bajaRace.ts';
import { Race } from './race.ts';
import { StuntChallenge } from './stuntChallenge.ts';
import type { Venue, VenueId } from './venue.ts';
import { buildVenue } from './venues/index.ts';
import bikeUrl from '../assets/models/Bike/mid_poly_dirt_bike.glb?url';
import riderUrl from '../assets/models/Rider/low-poly_motocross_character_rigged.glb?url';

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

// The downloaded models, falling back to the box placeholders if either fails to load.
const loader = new GLTFLoader();
const [bikeGltf, riderGltf] = await Promise.all(
  [bikeUrl, riderUrl].map((url) => loader.loadAsync(url).catch((e) => (console.warn(`model ${url} failed`, e), null))),
);

const input = new Input();
const sound = new SoundSystem();
const settings = loadSettings();
const deps = { world, scene, bikeGltf, riderGltf, sound };

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
};

// ---- Venues ---------------------------------------------------------------------------------------

const venues = new Map<VenueId, Venue>();
let venue: Venue;
let rig: CameraRig;

/** Build a venue the first time it's needed (a second or so), behind the loading screen. */
async function getVenue(id: VenueId) {
  let v = venues.get(id);
  if (!v) {
    hud.loading.textContent = 'Loading…';
    hud.loading.hidden = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    v = buildVenue(id, world);
    scene.add(v.root);
    venues.set(id, v);
  }
  hud.loading.hidden = true;
  return v;
}

/** Show one venue: its scenery and colliders on, every other venue's off, its sky and lighting. */
function useVenue(v: Venue) {
  venue = v;
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

/** Baja: a flat chevron over your bike pointing at the next waypoint (like the original's GPS arrow). */
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

const ATTRACT: SessionConfig = {
  mode: 'attract', venue: 'nationals', laps: 999, opponents: 7, difficulty: 'medium', colour: 'red', duration: 0,
};
let session: Session;
let lastConfig: SessionConfig = ATTRACT;
let lastCount = -1;
let resultsTimer = 0;

/** Tear down whatever is running and start a game (or the menu's attract mode). */
async function begin(config: SessionConfig) {
  session?.dispose();
  clearTimeout(resultsTimer);
  useVenue(await getVenue(config.venue));
  session = new Session(deps, venue, config);
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
  p.bike.autoShift = settings.gearbox === 'auto';
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
  event.onLap = (r, lap, time) => {
    if (r.human && event instanceof Race && lap < event.laps) {
      flashBanner(`LAP ${lap + 1}<small>${clockText(time)}</small>`, 1500);
    }
  };
  if (event instanceof BajaRace) {
    event.onWaypoint = (r, i) => {
      if (!r.human || i === event.waypoints.length - 1) return;
      sound.score();
      flashBanner(`WAYPOINT ${i + 1}<small>${clockText(event.clock)}</small>`, 1300);
    };
  }
  event.onFinish = (r, place) => {
    if (r.human) {
      const msg = event instanceof StuntChallenge
        ? `TIME UP!<small>${p.stunts.total.toLocaleString()} points${event.newBest ? ' · new best!' : ''}</small>`
        : `${ordinal(place).toUpperCase()}!<small>${clockText(r.finishTime)}</small>`;
      flashBanner(msg, 2500);
      sound.cheer(1);
      resultsTimer = window.setTimeout(() => {
        const t = tableHtml(event.results());
        menu.showResults(t.html, t.title);
      }, 2700);
    } else if (menu.screenName === 'results') {
      const t = tableHtml(event.results());
      menu.showResults(t.html, t.title);
    }
  };
}

function updateEventHud() {
  const me = session.human;
  const event = session.event;
  arrow.visible = false;
  if (!me) return;
  if (!event) {
    hud.race.innerHTML = `FREE RIDE · ${venue.name.toUpperCase()} &nbsp; <b>Esc</b> for the menu`;
    return;
  }
  const r = me.racer!;
  if (!event.started) {
    const n = Math.ceil(-event.clock);
    if (n !== lastCount && n <= 3 && n >= 1) {
      lastCount = n;
      flashBanner(`${n}`, 900);
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

function applySettings(s: Settings) {
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
  if (me) me.player.bike.autoShift = s.gearbox === 'auto';
  if (me && rig && rig.mode !== s.camera) rig.setMode(s.camera);
}

const menu = new Menu(document.getElementById('menu')!, settings, {
  start(config) {
    lastConfig = config;
    void begin(config);
  },
  resume() {},
  restart() {
    void begin(lastConfig);
  },
  quit() {
    void goToMenu();
  },
  settingsChanged: applySettings,
});

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
let accumulator = 0;
let last = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!hud.loading.hidden) return; // a venue is being built
  const me = session.human;
  // A game freezes while its pause menu is up; the attract mode and the results keep going.
  const running = !me || !menu.visible || menu.screenName === 'results';
  const playing = me !== null && !menu.visible;

  for (const a of input.takeActions()) {
    if (a === 'pause') {
      if (me) menu.togglePause();
      continue;
    }
    if (a === 'mute') {
      settings.muted = !settings.muted;
      applySettings(settings);
    }
    if (!playing || !me) continue;
    const bike = me.player.bike;
    if (a === 'reset') me.player.reset();
    else if (a === 'camera') rig.cycle();
    else if (a === 'shiftUp') { bike.autoShift = false; bike.shift(1); }
    else if (a === 'shiftDown') { bike.autoShift = false; bike.shift(-1); }
    else if (a === 'toggleAuto') bike.autoShift = !bike.autoShift;
    else if (a === 'help') hud.help.hidden = !hud.help.hidden;
  }

  const mine = input.read(dt);
  if (running) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
      session.step(playing ? mine : IDLE, PHYSICS_DT);
      accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    session.render(dt);
  }

  const star = session.star;
  const bike = star.player.bike;
  sound.update(me && running ? me.player.bike : null, camera);
  updateEventHud();
  const focus = star.player.focus;
  if (running) rig.update(bike, dt, focus);
  const t = focus ?? bike.body.translation();
  sun.position.set(t.x, t.y, t.z).add(venue.atmosphere.sun.offset);
  sun.target.position.set(t.x, t.y, t.z);

  const speed = Math.abs(bike.speed) * (settings.units === 'kmh' ? 3.6 : 2.237);
  hud.speed.textContent = String(Math.round(speed));
  hud.gear.textContent = (bike.autoShift ? '' : 'M') + (bike.gear + 1);
  hud.rpm.style.width = `${Math.max(0, Math.min(1, bike.rpmFraction)) * 100}%`;

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Handy for poking at the sim from the dev console.
Object.assign(window, { game: { get session() { return session; }, get venue() { return venue; }, world, rig: () => rig, sound, scene, menu, settings, venues } });
