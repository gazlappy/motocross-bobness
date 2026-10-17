import * as THREE from 'three';

// The realistic ground: photo-scanned materials from Poly Haven (CC0) blended per vertex by the same
// rules as the retro colours (base, grass patches, dirt patches, racing line, rock on steep slopes).
// Colour and surface normals both blend; each layer is sampled at two scales to hide the tiling.

// Vite bundles these; under Node (the headless tests) it's just a file URL that's never loaded.
const url = (name: string) => new URL(`../assets/textures/terrain/${name}.jpg`, import.meta.url).href;

export type GroundMaterial =
  | 'sparse_grass' | 'aerial_mud_1' | 'brown_mud_dry' | 'rocky_terrain_02' | 'aerial_sand' | 'red_dirt_mud_01' | 'gravelly_sand';

export interface Layer {
  material: GroundMaterial;
  /** Metres per texture repeat. */
  scale: number;
  /** Multiplies the photo's colour, to suit the venue's light. */
  tint?: number;
  /** Brightness multiplier on top of the tint. */
  gain?: number;
  /** Colour saturation, 0 (grey) to 1 (the photo's own). */
  sat?: number;
}

/** The five layers, in blend order: base, then grass, dirt, the racing line and rock over it. */
export interface GroundLook {
  base: Layer;
  grass: Layer;
  dirt: Layer;
  track: Layer;
  rock: Layer;
  /** Grass tufts scattered over the grassy ground (realistic look only). */
  tufts?: { count: number; colour: number; height: number };
}

const LAYERS = ['base', 'grass', 'dirt', 'track', 'rock'] as const;

const loader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();

function texture(name: string, colour: boolean) {
  let tex = textures.get(name);
  if (!tex) {
    tex = loader.load(url(name));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = 8;
    textures.set(name, tex);
  }
  return tex;
}

/** A standard material whose colour and normals come from the splat-blended ground layers. */
export function createGroundMaterial(look: GroundLook) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
  const uniforms: Record<string, THREE.IUniform> = {};
  LAYERS.forEach((layer, i) => {
    const l = look[layer];
    uniforms[`gAlbedo${i}`] = { value: texture(`${l.material}_diff`, true) };
    uniforms[`gNormal${i}`] = { value: texture(`${l.material}_nor`, false) };
    uniforms[`gScale${i}`] = { value: 1 / l.scale };
    uniforms[`gSat${i}`] = { value: l.sat ?? 1 };
    uniforms[`gTint${i}`] = { value: new THREE.Color(l.tint ?? 0xffffff).multiplyScalar(l.gain ?? 1) };
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 splat;
varying vec4 vSplat;
varying vec3 vGroundPos;
varying vec3 vGroundNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSplat = splat;
vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);`);

    const decl = LAYERS.map((_, i) => `uniform sampler2D gAlbedo${i}; uniform sampler2D gNormal${i}; uniform float gScale${i}; uniform vec3 gTint${i}; uniform float gSat${i};`).join('\n');
    // Sample a layer at its scale and at a rotated, larger scale, averaged: no visible repeats.
    const sampleRock = (i: number) => `
  {
    // Steep ground: project from the side as well as from above, so cliffs don't smear.
    vec3 bw = pow(abs(normalize(vGroundNormal)), vec3(4.0));
    bw /= bw.x + bw.y + bw.z;
    vec2 uvX = vGroundPos.zy * gScale${i}, uvY = vGroundPos.xz * gScale${i}, uvZ = vGroundPos.xy * gScale${i};
    vec3 a = texture2D(gAlbedo${i}, uvX).rgb * bw.x + texture2D(gAlbedo${i}, uvY).rgb * bw.y + texture2D(gAlbedo${i}, uvZ).rgb * bw.z;
    a = mix(vec3(dot(a, vec3(0.299, 0.587, 0.114))), a, gSat${i}) * gTint${i};
    vec3 n = texture2D(gNormal${i}, uvY).xyz * 2.0 - 1.0;
    n = normalize(mix(vec3(0.0, 0.0, 1.0), n, bw.y));
    float w = vSplat.w;
    gColour = mix(gColour, a, w);
    gBump = mix(gBump, n, w);
  }`;
    const sampleLayer = (i: number) => i === 4 ? sampleRock(i) : `
  {
    vec2 uvA = vGroundPos.xz * gScale${i};
    vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vGroundPos.xz * gScale${i} * 0.31 + 0.37;
    vec3 a = mix(texture2D(gAlbedo${i}, uvA).rgb, texture2D(gAlbedo${i}, uvB).rgb, 0.45);
    a = mix(vec3(dot(a, vec3(0.299, 0.587, 0.114))), a, gSat${i}) * gTint${i};
    vec3 nA = texture2D(gNormal${i}, uvA).xyz * 2.0 - 1.0;
    vec3 nB = texture2D(gNormal${i}, uvB).xyz * 2.0 - 1.0;
    nB.xy = mat2(0.8, 0.6, -0.6, 0.8) * nB.xy;
    vec3 n = normalize(vec3(nA.xy + nB.xy, nA.z * nB.z));
    float w = ${i === 0 ? '1.0' : `vSplat.${'xyzw'[i - 1]}`};
    gColour = mix(gColour, a, w);
    gBump = mix(gBump, n, w);
  }`;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vSplat;
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
${decl}
vec3 gColour;
vec3 gBump;`)
      .replace('#include <map_fragment>', `
gColour = vec3(0.0);
gBump = vec3(0.0, 0.0, 1.0);
${LAYERS.map((_, i) => sampleLayer(i)).join('\n')}
// Broad light and dark patches so big areas don't read as one flat material.
float macro = 0.85 + 0.3 * texture2D(gAlbedo0, vGroundPos.xz * 0.013).g;
diffuseColor.rgb *= gColour * macro;`)
      .replace('#include <normal_fragment_maps>', `
{
  // Ground UVs run along world X and Z: build the surface frame from the ground's normal.
  vec3 N = normalize(vGroundNormal);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = normalize(cross(T, N));
  vec3 bumped = normalize(T * gBump.x - B * gBump.y + N * gBump.z);
  normal = normalize((viewMatrix * vec4(bumped, 0.0)).xyz);
}`);
  };
  return mat;
}

/** Outdoor motocross: dry dirt, sparse grass, red-brown patches, tyre-tracked mud on the line. */
export const NATIONALS_LOOK: GroundLook = {
  base: { material: 'brown_mud_dry', scale: 5 },
  grass: { material: 'sparse_grass', scale: 4 },
  dirt: { material: 'red_dirt_mud_01', scale: 5 },
  track: { material: 'aerial_mud_1', scale: 7, tint: 0xf0b888, gain: 1.45 },
  rock: { material: 'rocky_terrain_02', scale: 6 },
  tufts: { count: 30000, colour: 0x6c7a3c, height: 0.38 },
};

/** Open desert: sand, desert scrub, red dirt, rocky slopes. */
export const BAJA_LOOK: GroundLook = {
  base: { material: 'aerial_sand', scale: 6, tint: 0xffd29a, gain: 1.15 },
  grass: { material: 'sparse_grass', scale: 4, tint: 0xd8c890 },
  dirt: { material: 'red_dirt_mud_01', scale: 6 },
  track: { material: 'aerial_mud_1', scale: 7, tint: 0xf0b888, gain: 1.45 },
  rock: { material: 'rocky_terrain_02', scale: 7, tint: 0xe09a70, gain: 1.1 },
  tufts: { count: 9000, colour: 0xb0a060, height: 0.32 },
};

/** Indoor loam under the lights. */
export const SUPERCROSS_LOOK: GroundLook = {
  base: { material: 'brown_mud_dry', scale: 4, tint: 0xc09070, gain: 1.4 },
  grass: { material: 'brown_mud_dry', scale: 4, tint: 0xc09070, gain: 1.4 },
  dirt: { material: 'aerial_mud_1', scale: 5, tint: 0xe0a880, gain: 1.6 },
  track: { material: 'aerial_mud_1', scale: 5, tint: 0xe0a880, gain: 1.7 },
  rock: { material: 'brown_mud_dry', scale: 4, tint: 0xb08060, gain: 1.3 },
};

/** The quarry floor: gravel, dust and rock faces. */
export const QUARRY_LOOK: GroundLook = {
  base: { material: 'gravelly_sand', scale: 5, sat: 0.35, tint: 0xf2e4cc, gain: 1.3 },
  grass: { material: 'sparse_grass', scale: 4, tint: 0xc8c0a0, sat: 0.6 },
  dirt: { material: 'brown_mud_dry', scale: 5, sat: 0.35, gain: 1.15 },
  track: { material: 'aerial_mud_1', scale: 7, sat: 0.3 },
  rock: { material: 'rocky_terrain_02', scale: 6, sat: 0.25, gain: 1.2 },
  tufts: { count: 1500, colour: 0x8c8c58, height: 0.3 },
};
