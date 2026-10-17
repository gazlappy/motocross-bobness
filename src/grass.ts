import * as THREE from 'three';
import { type Heightmap, sampleHeight } from './heightmap.ts';

// Grass tufts for the realistic ground: one instanced mesh of three crossed blades-cards each,
// scattered where the ground's grass layer is strong, away from the racing line and steep slopes.

function bladesTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  let seed = 11;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 22; i++) {
    const x = 10 + rand() * (size - 20);
    const h = size * (0.45 + rand() * 0.55);
    const lean = (rand() - 0.5) * 34;
    const w = 3 + rand() * 4;
    const shade = 150 + rand() * 105;
    ctx.fillStyle = `rgb(${shade * 0.85},${shade},${shade * 0.6})`;
    ctx.beginPath();
    ctx.moveTo(x - w, size);
    ctx.quadraticCurveTo(x + lean * 0.3, size - h * 0.6, x + lean, size - h);
    ctx.quadraticCurveTo(x + lean * 0.3 + w * 0.4, size - h * 0.55, x + w, size);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** One tuft: three upright cards crossed at 60 degrees, lit as if facing up so they match the ground. */
function tuftGeometry(height: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const card = new THREE.PlaneGeometry(height * 1.3, height);
    card.translate(0, height / 2, 0);
    card.rotateY((i * Math.PI) / 3);
    parts.push(card);
  }
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.getAttribute('position').array);
    uv.push(...p.getAttribute('uv').array);
    idx.push(...Array.from(p.index!.array, (v) => v + base));
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return geo;
}

let blades: THREE.Texture | null = null;

/**
 * Scatter `count` tufts over the terrain mesh's grassy vertices (its `splat` attribute: x = grass,
 * z = racing line, w = rock).
 */
export function createGrass(hm: Heightmap, terrain: THREE.Mesh, opts: { count: number; colour: number; height: number }) {
  blades ??= bladesTexture();
  const splat = terrain.geometry.getAttribute('splat') as THREE.BufferAttribute;
  const n = hm.cells + 1;
  const half = hm.size / 2;
  const mat = new THREE.MeshLambertMaterial({ map: blades, alphaTest: 0.45, side: THREE.DoubleSide, color: opts.colour });
  const mesh = new THREE.InstancedMesh(tuftGeometry(opts.height), mat, opts.count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  let seed = 4242;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let placed = 0;
  for (let tries = 0; placed < opts.count && tries < opts.count * 30; tries++) {
    const ix = Math.floor(rand() * n), iz = Math.floor(rand() * n);
    const i = iz * n + ix;
    const grass = splat.getX(i), track = splat.getZ(i), rock = splat.getW(i);
    if (rand() > grass * (1 - track) * (1 - rock)) continue;
    const x = -half + (ix + rand() - 0.5) * hm.cellSize, z = -half + (iz + rand() - 0.5) * hm.cellSize;
    if (Math.abs(x) > half - 2 || Math.abs(z) > half - 2) continue;
    p.set(x, sampleHeight(hm, x, z) - 0.03, z);
    q.setFromAxisAngle(up, rand() * Math.PI);
    s.setScalar(0.6 + rand() * 0.8);
    mesh.setMatrixAt(placed, m.compose(p, q, s));
    const v = 0.62 + rand() * 0.38; // light and dry variation, neutral so the material colour leads
    mesh.setColorAt(placed, tint.setRGB(v * (0.95 + rand() * 0.12), v, v * 0.9));
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // spread over the whole map: one bounding box would be wrong anyway
  return mesh;
}
