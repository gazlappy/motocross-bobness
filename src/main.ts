import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { generateHeightmap, sampleHeight } from './heightmap.ts';
import { createTerrainCollider, createTerrainMesh } from './terrain.ts';
import { createTrackDressing } from './trackDressing.ts';
import { Input } from './input.ts';
import { CameraRig } from './camera.ts';
import { SoundSystem } from './audio/sound.ts';
import { Session, type SessionConfig } from './session.ts';
import { Menu } from './menu.ts';
import { type Settings, loadSettings } from './settings.ts';
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
scene.background = new THREE.Color(0x9cc4e4);
scene.fog = new THREE.Fog(0xc9d6dc, 120, 520);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1200);

scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a6a48, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -30;
sc.right = sc.top = 30;
sc.near = 1;
sc.far = 200;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(-60, 90, 40);

const hm = generateHeightmap();
scene.add(createTerrainMesh(hm));
scene.add(createTrackDressing(hm));
addRocks();

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = PHYSICS_DT;
createTerrainCollider(world, hm);

// The downloaded models, falling back to the box placeholders if either fails to load.
const loader = new GLTFLoader();
const [bikeGltf, riderGltf] = await Promise.all(
  [bikeUrl, riderUrl].map((url) => loader.loadAsync(url).catch((e) => (console.warn(`model ${url} failed`, e), null))),
);

const input = new Input();
const rig = new CameraRig(camera, hm);
const sound = new SoundSystem();
const settings = loadSettings();
const deps = { world, hm, scene, bikeGltf, riderGltf, sound };

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
};

const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
const clockText = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

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

const ATTRACT: SessionConfig = { mode: 'attract', laps: 999, opponents: 7, difficulty: 'medium', colour: 'red' };
let session: Session;
let lastConfig: SessionConfig = ATTRACT;
let lastCount = -1;
let resultsTimer = 0;

/** Tear down whatever is running and start a game (or the menu's attract mode). */
function begin(config: SessionConfig) {
  session?.dispose();
  clearTimeout(resultsTimer);
  session = new Session(deps, config);
  lastCount = -1;
  hud.banner.classList.remove('show');
  showTrick('', false);
  hud.score.textContent = '0';
  rig.setMode(config.mode === 'attract' ? 'thrill' : settings.camera);
  hud.help.hidden = config.mode === 'attract' || !settings.showHelp;
  attachHud();
}

/** Hook the HUD, sounds and race events to the human rider of the current game. */
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
    showTrick(`${label}<b>+${points.toLocaleString()}</b>`, true, 2200);
    hud.score.textContent = p.stunts.total.toLocaleString();
  };
  p.onCrash = (cause) => {
    sound.impact(1);
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

  const race = session.race;
  if (!race) return;
  race.onLap = (r, lap, time) => {
    if (r.human && lap < race.laps) flashBanner(`LAP ${lap + 1}<small>${clockText(time)}</small>`, 1500);
  };
  race.onFinish = (r, place) => {
    if (r.human) {
      flashBanner(`${ordinal(place).toUpperCase()}!<small>${clockText(r.finishTime)}</small>`, 2500);
      resultsTimer = window.setTimeout(() => menu.showResults(resultsTable()), 2700);
    } else if (menu.screenName === 'results') {
      menu.showResults(resultsTable());
    }
  };
}

function resultsTable() {
  const race = session.race!;
  const rows = race.standings().map((r, i) => {
    const time = r.finished ? clockText(r.finishTime) : 'racing';
    const best = Number.isFinite(r.bestLap) ? clockText(r.bestLap) : '-';
    return `<tr class="${r.human ? 'me' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${time}</td><td>${best}</td></tr>`;
  });
  return `<table><tr><th></th><th>Rider</th><th>Time</th><th>Best lap</th></tr>${rows.join('')}</table>`;
}

function updateRaceHud() {
  const me = session.human;
  const race = session.race;
  if (!me) return;
  if (!race) {
    hud.race.innerHTML = 'FREE RIDE &nbsp; <b>Esc</b> for the menu';
    return;
  }
  const r = me.racer!;
  if (!race.started) {
    const n = Math.ceil(-race.clock);
    if (n !== lastCount && n <= 3) {
      lastCount = n;
      flashBanner(`${n}`, 900);
      sound.impact(0.25);
    }
  } else if (lastCount !== 0) {
    lastCount = 0;
    flashBanner('GO!', 900);
    hud.help.hidden = true;
    sound.score();
  }
  const lap = Math.min(Math.max(r.lap, 1), race.laps);
  const time = r.finished ? r.finishTime : Math.max(0, race.clock);
  hud.race.innerHTML = `LAP <b>${lap}/${race.laps}</b> &nbsp; <b>${ordinal(race.position(r))}</b>/${race.racers.length} &nbsp; ${clockText(time)}`;
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
  if (me && rig.mode !== s.camera) rig.setMode(s.camera);
}

const menu = new Menu(document.getElementById('menu')!, settings, {
  start(config) {
    lastConfig = config;
    begin(config);
  },
  resume() {},
  restart() {
    begin(lastConfig);
  },
  quit() {
    goToMenu();
  },
  settingsChanged: applySettings,
});

function goToMenu() {
  begin(ATTRACT);
  menu.showMain();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

applySettings(settings);
goToMenu();
document.getElementById('loading')!.remove();

let accumulator = 0;
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
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
  updateRaceHud();
  const focus = star.player.focus;
  if (running) rig.update(bike, dt, focus);
  const t = focus ?? bike.body.translation();
  sun.position.set(t.x, t.y, t.z).add(SUN_OFFSET);
  sun.target.position.set(t.x, t.y, t.z);

  const speed = Math.abs(bike.speed) * (settings.units === 'kmh' ? 3.6 : 2.237);
  hud.speed.textContent = String(Math.round(speed));
  hud.gear.textContent = (bike.autoShift ? '' : 'M') + (bike.gear + 1);
  hud.rpm.style.width = `${Math.max(0, Math.min(1, bike.rpmFraction)) * 100}%`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const IDLE = { throttle: 0, brake: 0, steer: 0, leanForward: 0, leanSide: 0 };

function addRocks() {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x8b6248, flatShading: true });
  const count = 260;
  const rocks = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let placed = 0;
  for (let i = 0; placed < count && i < count * 4; i++) {
    const x = (rand() - 0.5) * hm.size * 0.9;
    const z = (rand() - 0.5) * hm.size * 0.9;
    const n = hm.cells + 1;
    const ix = Math.round((x + hm.size / 2) / hm.cellSize), iz = Math.round((z + hm.size / 2) / hm.cellSize);
    if (hm.trackDistance[iz * n + ix] < 20) continue;
    const s = 0.4 + rand() * rand() * 2.6;
    q.setFromEuler(new THREE.Euler(i, i * 1.7, i * 0.3));
    m.compose(new THREE.Vector3(x, sampleHeight(hm, x, z) + s * 0.3, z), q, new THREE.Vector3(s, s * 0.7, s));
    rocks.setMatrixAt(placed++, m);
  }
  rocks.count = placed;
  rocks.castShadow = rocks.receiveShadow = true;
  scene.add(rocks);
}

// Handy for poking at the sim from the dev console.
Object.assign(window, { game: { get session() { return session; }, world, hm, rig, sound, scene, menu, settings } });
