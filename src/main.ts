import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { generateHeightmap, sampleHeight } from './heightmap.ts';
import { createTerrainCollider, createTerrainMesh } from './terrain.ts';
import { createTrackDressing } from './trackDressing.ts';
import { Player } from './player.ts';
import { BikeModel } from './bikeModel.ts';
import { RiderModel } from './riderModel.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type BikeColour, GltfBikeModel } from './gltfBikeModel.ts';
import { Sim } from './sim.ts';
import { Race, type Racer } from './race.ts';
import { AIDriver } from './ai.ts';
import type { Controls } from './input.ts';
import { GltfRiderModel } from './gltfRiderModel.ts';
import bikeUrl from '../assets/models/Bike/mid_poly_dirt_bike.glb?url';
import riderUrl from '../assets/models/Rider/low-poly_motocross_character_rigged.glb?url';
import { Input } from './input.ts';
import { CameraRig } from './camera.ts';
import { SoundSystem } from './audio/sound.ts';

const PHYSICS_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 6;
const LAPS = 3;
const PLAYER_GRID_SLOT = 4;

/** The field: you on red, six AI riders on the other bike colours. */
const FIELD: { name: string; colour: BikeColour; kit: number; skill: number }[] = [
  { name: 'You', colour: 'red', kit: 0xd8261c, skill: 1 },
  { name: 'Holeshot Hal', colour: 'orange', kit: 0xf07a1a, skill: 0.97 },
  { name: 'Dirt Dan', colour: 'yellow', kit: 0xf2c418, skill: 0.95 },
  { name: 'Roost Ruby', colour: 'green', kit: 0x2f9e3a, skill: 0.93 },
  { name: 'Whip Wendy', colour: 'blue', kit: 0x1f5fd1, skill: 0.92 },
  { name: 'Skid Mark', colour: 'white', kit: 0xe8e8e8, skill: 0.9 },
  { name: 'Rex Rocket', colour: 'black', kit: 0x2a2a2e, skill: 0.88 },
];

await RAPIER.init();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = new THREE.Color(0x9cc4e4);
scene.background = SKY;
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

const sim = new Sim(world);
const race = new Race(hm.track, LAPS);

interface Entry {
  player: Player;
  racer: Racer;
  bikeModel: BikeModel | GltfBikeModel;
  riderModel: RiderModel | GltfRiderModel;
  ai: AIDriver | null;
}

const order = [PLAYER_GRID_SLOT, ...Array.from({ length: FIELD.length }, (_, i) => i).filter((i) => i !== PLAYER_GRID_SLOT)];
const entries: Entry[] = FIELD.map((f, i) => {
  const [pos, yaw] = Race.gridSlot(hm.track, order[i]);
  pos.y = sampleHeight(hm, pos.x, pos.z) + 1;
  const p = new Player(world, hm, pos, yaw);
  p.track = hm.track;
  sim.players.push(p);

  let bikeModel: BikeModel | GltfBikeModel = new BikeModel();
  let riderModel: RiderModel | GltfRiderModel = new RiderModel();
  try {
    if (bikeGltf) {
      const m = new GltfBikeModel(bikeGltf, f.colour);
      bikeModel = m;
      p.mounts = () => m.mounts();
    }
  } catch (e) {
    console.warn('bike model unusable, using placeholder', e);
  }
  try {
    if (riderGltf) {
      const m = new GltfRiderModel(i === 0 ? riderGltf.scene : cloneSkinned(riderGltf.scene), i === 0 ? undefined : f.kit);
      riderModel = m;
      p.proportions = m.proportions;
    }
  } catch (e) {
    console.warn('rider model unusable, using placeholder', e);
  }
  scene.add(bikeModel.root, riderModel.root);

  race.add(f.name, p, i === 0);
  const ai = i === 0 ? null : new AIDriver(p, hm.track, { skill: f.skill, lane: ((order[i] % 3) - 1) * 3.5 });
  return { player: p, racer: race.racers[i], bikeModel, riderModel, ai };
});

const me = entries[0];
const player = me.player;
const bike = player.bike;

const input = new Input();
const rig = new CameraRig(camera, hm);
const sound = new SoundSystem();
for (const e of entries.slice(1)) {
  const b = e.player.bike;
  sound.addEngine({ position: () => b.body.translation(), rpm: () => b.rpm, load: () => b.throttle });
}

const hud = {
  speed: document.getElementById('speed-val')!,
  gear: document.getElementById('gear')!,
  rpm: document.getElementById('rpm-fill')!,
  help: document.getElementById('help')!,
  banner: document.getElementById('banner')!,
  score: document.getElementById('score-val')!,
  trick: document.getElementById('trick')!,
  race: document.getElementById('race')!,
  results: document.getElementById('results')!,
};

const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
const clockText = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

let lastCount = -1;
function updateRaceHud() {
  const r = me.racer;
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

function showResults() {
  const rows = race.standings().map((r, i) => {
    const time = r.finished ? clockText(r.finishTime) : 'still racing';
    const best = Number.isFinite(r.bestLap) ? clockText(r.bestLap) : '-';
    return `<tr class="${r.human ? 'me' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${time}</td><td>${best}</td></tr>`;
  });
  hud.results.innerHTML = `<h2>RACE RESULTS</h2><table><tr><th></th><th>Rider</th><th>Time</th><th>Best lap</th></tr>${rows.join('')}</table><p>Press <b>Enter</b> to race again</p>`;
  hud.results.hidden = false;
}

race.onLap = (r, lap, time) => {
  if (r.human && lap < race.laps) flashBanner(`LAP ${lap + 1}<small>${clockText(time)}</small>`, 1500);
};
race.onFinish = (r, place) => {
  if (r.human) {
    flashBanner(`${ordinal(place).toUpperCase()}!<small>${clockText(r.finishTime)}</small>`, 2500);
    window.setTimeout(showResults, 2700);
  } else if (!hud.results.hidden) {
    showResults();
  }
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && me.racer.finished) location.reload();
});

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
player.stunts.onTrick = (name, points) => {
  if (performance.now() < trickHoldUntil) return;
  showTrick(name ? `${name}<b>${Math.round(points).toLocaleString()}</b>` : '', false);
};
player.stunts.onBank = (points, label) => {
  sound.score();
  showTrick(`${label}<b>+${points.toLocaleString()}</b>`, true, 2200);
  hud.score.textContent = player.stunts.total.toLocaleString();
};

let bannerTimer = 0;
function flashBanner(html: string, ms: number) {
  hud.banner.innerHTML = html;
  hud.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => hud.banner.classList.remove('show'), ms);
}
document.getElementById('loading')!.remove();

player.onCrash = (cause) => {
  sound.impact(1);
  clearTimeout(bannerTimer);
  hud.banner.innerHTML = `WIPEOUT!<small>${cause}</small>`;
  hud.banner.classList.add('show');
};
player.onRespawn = () => hud.banner.classList.remove('show');
player.onCannon = () => {
  sound.cannon();
  flashBanner('KA-BOOM!<small>out of bounds</small>', 1800);
};
player.onImpact = (s) => sound.impact(s * 0.7);

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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/** Held on the line until GO. */
const HELD: Controls = { throttle: 0, brake: 1, steer: 0, leanForward: 0, leanSide: 0 };

let accumulator = 0;
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  for (const a of input.takeActions()) {
    if (a === 'reset') player.reset();
    else if (a === 'camera') rig.cycle();
    else if (a === 'shiftUp') { bike.autoShift = false; bike.shift(1); }
    else if (a === 'shiftDown') { bike.autoShift = false; bike.shift(-1); }
    else if (a === 'toggleAuto') bike.autoShift = !bike.autoShift;
    else if (a === 'help') hud.help.hidden = !hud.help.hidden;
    else if (a === 'mute') sound.toggleMute();
  }

  const mine = input.read(dt);
  accumulator += dt;
  let steps = 0;
  while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
    const controls: Controls[] = entries.map((e) =>
      e.ai ? e.ai.controls(PHYSICS_DT, sim.players, race.started) : race.started ? mine : HELD,
    );
    sim.step(controls, PHYSICS_DT);
    race.update(PHYSICS_DT);
    accumulator -= PHYSICS_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

  for (const e of entries) {
    e.bikeModel.update(e.player.bike);
    e.riderModel.setPose(e.player.update(dt));
  }
  sound.update(bike, camera);
  updateRaceHud();
  const focus = player.focus;
  rig.update(bike, dt, focus);
  const t = focus ?? bike.body.translation();
  sun.position.set(t.x, t.y, t.z).add(SUN_OFFSET);
  sun.target.position.set(t.x, t.y, t.z);

  hud.speed.textContent = String(Math.round(Math.abs(bike.speed) * 2.237));
  hud.gear.textContent = (bike.autoShift ? '' : 'M') + (bike.gear + 1);
  hud.rpm.style.width = `${Math.max(0, Math.min(1, bike.rpmFraction)) * 100}%`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the sim from the dev console.
Object.assign(window, { game: { player, bike, world, hm, rig, sound, scene, race, entries } });
