import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Noise2D } from './noise.ts';
import { type Heightmap, rapierHeights } from './heightmap.ts';
import { type GroundLook, NATIONALS_LOOK, createGroundMaterial } from './terrainLook.ts';
import { createGrass } from './grass.ts';

/** Ground colours for a venue. */
export interface TerrainPalette {
  base: number;
  grass: number;
  dirt: number;
  track: number;
  rock: number;
  /** How much of the ground gets grass and dirt patches, 0..1. */
  grassAmount: number;
  dirtAmount: number;
}

export const DESERT: TerrainPalette = {
  base: 0xc9a46c, grass: 0x7b8a45, dirt: 0x8a5f3a, track: 0x6e4a2c, rock: 0x9a5a3c, grassAmount: 0.8, dirtAmount: 0.6,
};

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

/** Retro: the original flat colours. Otherwise: blended photo materials (see terrainLook.ts). */
export type TerrainStyle = 'retro' | 'real';

export function createTerrainMesh(hm: Heightmap, palette: TerrainPalette = DESERT, uvScale = 6, look: GroundLook = NATIONALS_LOOK) {
  const SAND = new THREE.Color(palette.base), GRASS = new THREE.Color(palette.grass);
  const DIRT = new THREE.Color(palette.dirt), TRACK = new THREE.Color(palette.track), ROCK = new THREE.Color(palette.rock);
  const n = hm.cells + 1;
  const half = hm.size / 2;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const colors = new Float32Array(n * n * 3);
  /** How much grass, dirt, racing line and rock cover each vertex (realistic style). */
  const splat = new Float32Array(n * n * 4);
  const patch = new Noise2D(31);
  const h = hm.heights;
  const c = new THREE.Color();

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = -half + ix * hm.cellSize;
      const z = -half + iz * hm.cellSize;
      positions.set([x, h[i], z], i * 3);
      uvs.set([x / uvScale, z / uvScale], i * 2);

      const hx = h[iz * n + Math.min(n - 1, ix + 1)] - h[iz * n + Math.max(0, ix - 1)];
      const hz = h[Math.min(n - 1, iz + 1) * n + ix] - h[Math.max(0, iz - 1) * n + ix];
      const slope = Math.hypot(hx, hz) / (2 * hm.cellSize);

      c.copy(SAND);
      const grass = THREE.MathUtils.smoothstep(patch.fbm(x / 60, z / 60, 3), 0.05, 0.35) * palette.grassAmount;
      c.lerp(GRASS, grass);
      const dirt = THREE.MathUtils.smoothstep(patch.fbm(x / 25 + 5, z / 25, 2), 0.1, 0.5) * palette.dirtAmount;
      c.lerp(DIRT, dirt);
      // Worked dirt on the racing surface, fading out over the shoulders.
      let track = 0;
      if (hm.track) {
        const W = hm.track.halfWidth;
        track = 1 - THREE.MathUtils.smoothstep(hm.trackDistance[i], W, W + 3);
        c.lerp(TRACK, 0.85 * track);
      }
      const rock = THREE.MathUtils.smoothstep(slope, 0.55, 1.1);
      c.lerp(ROCK, rock);
      colors.set([c.r, c.g, c.b], i * 3);
      splat.set([grass, dirt, track, rock], i * 4);
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
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  const retro = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeDetailTexture() });
  const mesh = new THREE.Mesh(geo, retro);
  mesh.receiveShadow = true;
  // The realistic material is made on first use (it loads textures); tufts only show with it.
  mesh.userData.terrain = { retro, real: null as THREE.Material | null, look };
  if (look.tufts) {
    const grass = createGrass(hm, mesh, look.tufts);
    grass.visible = false;
    grass.userData.realOnly = true;
    mesh.add(grass);
  }
  return mesh;
}

/** Switch every terrain under `root` between the retro and realistic looks. */
export function setTerrainStyle(root: THREE.Object3D, style: TerrainStyle) {
  root.traverse((o) => {
    const t = o.userData.terrain as { retro: THREE.Material; real: THREE.Material | null; look: GroundLook } | undefined;
    if (!t) return;
    if (style === 'real' && !t.real) t.real = createGroundMaterial(t.look);
    (o as THREE.Mesh).material = style === 'real' ? t.real! : t.retro;
    for (const child of o.children) if (child.userData.realOnly) child.visible = style === 'real';
  });
}

export function createTerrainCollider(world: RAPIER.World, hm: Heightmap) {
  const desc = RAPIER.ColliderDesc.heightfield(hm.cells, hm.cells, rapierHeights(hm), {
    x: hm.size,
    y: 1,
    z: hm.size,
  }).setFriction(0.9);
  return world.createCollider(desc);
}
