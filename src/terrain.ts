import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Noise2D } from './noise.ts';
import { type Heightmap, rapierHeights } from './heightmap.ts';

const SAND = new THREE.Color(0xc9a46c);
const DIRT = new THREE.Color(0x8a5f3a);
const TRACK = new THREE.Color(0x6e4a2c);
const GRASS = new THREE.Color(0x7b8a45);
const ROCK = new THREE.Color(0x9a5a3c);

function makeDetailTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const noise = new Noise2D(99);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable: sample noise on a torus-ish wrap by blending offsets.
      const u = x / size, v = y / size;
      const n =
        noise.fbm(u * 8, v * 8, 3) * (1 - u) * (1 - v) +
        noise.fbm((u - 1) * 8, v * 8, 3) * u * (1 - v) +
        noise.fbm(u * 8, (v - 1) * 8, 3) * (1 - u) * v +
        noise.fbm((u - 1) * 8, (v - 1) * 8, 3) * u * v;
      const grain = Math.random() * 0.25;
      const c = Math.max(0, Math.min(255, 200 + n * 60 + grain * 60));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createTerrainMesh(hm: Heightmap) {
  const n = hm.cells + 1;
  const half = hm.size / 2;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const colors = new Float32Array(n * n * 3);
  const patch = new Noise2D(31);
  const h = hm.heights;
  const c = new THREE.Color();

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = -half + ix * hm.cellSize;
      const z = -half + iz * hm.cellSize;
      positions.set([x, h[i], z], i * 3);
      uvs.set([x / 6, z / 6], i * 2);

      const hx = h[iz * n + Math.min(n - 1, ix + 1)] - h[iz * n + Math.max(0, ix - 1)];
      const hz = h[Math.min(n - 1, iz + 1) * n + ix] - h[Math.max(0, iz - 1) * n + ix];
      const slope = Math.hypot(hx, hz) / (2 * hm.cellSize);

      c.copy(SAND);
      const grassy = THREE.MathUtils.smoothstep(patch.fbm(x / 60, z / 60, 3), 0.05, 0.35);
      c.lerp(GRASS, grassy * 0.8);
      c.lerp(DIRT, THREE.MathUtils.smoothstep(patch.fbm(x / 25 + 5, z / 25, 2), 0.1, 0.5) * 0.6);
      if (Math.abs(x) < 9 && z < 34 && z > -264) c.lerp(TRACK, 0.85);
      c.lerp(ROCK, THREE.MathUtils.smoothstep(slope, 0.55, 1.1));
      colors.set([c.r, c.g, c.b], i * 3);
    }
  }

  const indices = new Uint32Array(hm.cells * hm.cells * 6);
  let k = 0;
  for (let iz = 0; iz < hm.cells; iz++) {
    for (let ix = 0; ix < hm.cells; ix++) {
      const a = iz * n + ix, b = a + 1, d = a + n, e = d + 1;
      indices.set([a, d, b, b, d, e], k);
      k += 6;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeDetailTexture() });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function createTerrainCollider(world: RAPIER.World, hm: Heightmap) {
  const desc = RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), {
    x: hm.size,
    y: 1,
    z: hm.size,
  }).setFriction(0.9);
  return world.createCollider(desc);
}
