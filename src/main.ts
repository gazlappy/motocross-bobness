import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { generateHeightmap, sampleHeight } from './heightmap.ts';
import { createTerrainCollider, createTerrainMesh } from './terrain.ts';
import { Bike } from './bike.ts';
import { BikeModel } from './bikeModel.ts';
import { Input } from './input.ts';
import { CameraRig } from './camera.ts';

const PHYSICS_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 6;
const SPAWN = new THREE.Vector3(0, 0, 20);

await RAPIER.init();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
addRocks();

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = PHYSICS_DT;
createTerrainCollider(world, hm);

SPAWN.y = sampleHeight(hm, SPAWN.x, SPAWN.z) + 1.0;
const bike = new Bike(world, SPAWN, 0);
const model = new BikeModel();
scene.add(model.root);

const input = new Input();
const rig = new CameraRig(camera, hm);

const hud = {
  speed: document.getElementById('speed-val')!,
  gear: document.getElementById('gear')!,
  rpm: document.getElementById('rpm-fill')!,
  help: document.getElementById('help')!,
};
document.getElementById('loading')!.remove();

function resetBike(toSpawn = false) {
  const t = bike.body.translation();
  const p = toSpawn ? SPAWN.clone() : new THREE.Vector3(t.x, 0, t.z);
  p.y = sampleHeight(hm, p.x, p.z) + 1.0;
  bike.reset(p, toSpawn ? 0 : bike.yaw);
}

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
    if (Math.abs(x) < 25 && z < 60 && z > -280) continue;
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

let accumulator = 0;
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  for (const a of input.takeActions()) {
    if (a === 'reset') resetBike();
    else if (a === 'camera') rig.cycle();
    else if (a === 'shiftUp') { bike.autoShift = false; bike.shift(1); }
    else if (a === 'shiftDown') { bike.autoShift = false; bike.shift(-1); }
    else if (a === 'toggleAuto') bike.autoShift = !bike.autoShift;
    else if (a === 'help') hud.help.hidden = !hud.help.hidden;
  }

  const controls = input.read(dt);
  accumulator += dt;
  let steps = 0;
  while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
    bike.step(controls, PHYSICS_DT);
    world.step();
    accumulator -= PHYSICS_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

  const t = bike.body.translation();
  if (bike.isUpsideDownLong || t.y < -50) resetBike(t.y < -50);

  model.update(bike);
  rig.update(bike, dt);
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
Object.assign(window, { game: { bike, world, hm, rig } });
