// Prints a .glb's node tree, mesh bounds, materials, skins and animations (reads the JSON chunk only).
// Usage: node scripts/inspect-glb.ts path/to/model.glb
import { readFileSync } from 'node:fs';

type Json = Record<string, any>;
const path = process.argv[2];
const buf = readFileSync(path);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
const jsonLen = buf.readUInt32LE(12);
const gltf: Json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

const meshBounds = (mi: number) => {
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (const prim of gltf.meshes[mi].primitives) {
    const acc = gltf.accessors[prim.attributes.POSITION];
    acc.min.forEach((v: number, i: number) => (mins[i] = Math.min(mins[i], v)));
    acc.max.forEach((v: number, i: number) => (maxs[i] = Math.max(maxs[i], v)));
  }
  return `min(${mins.map((v) => v.toFixed(2))}) max(${maxs.map((v) => v.toFixed(2))})`;
};
const fmt = (a?: number[]) => (a ? `[${a.map((v) => +v.toFixed(3)).join(', ')}]` : '');

function walk(ni: number, depth: number) {
  const n = gltf.nodes[ni];
  const bits = [n.name ?? `node${ni}`];
  if (n.translation) bits.push(`t${fmt(n.translation)}`);
  if (n.rotation) bits.push(`r${fmt(n.rotation)}`);
  if (n.scale) bits.push(`s${fmt(n.scale)}`);
  if (n.matrix) bits.push(`m${fmt(n.matrix)}`);
  if (n.mesh !== undefined) {
    const m = gltf.meshes[n.mesh];
    bits.push(`MESH "${m.name}" ${m.primitives.length} prim, mats [${m.primitives.map((p: Json) => gltf.materials?.[p.material]?.name).join(', ')}] ${meshBounds(n.mesh)}`);
  }
  if (n.skin !== undefined) bits.push(`SKIN ${n.skin}`);
  console.log('  '.repeat(depth) + bits.join('  '));
  for (const c of n.children ?? []) walk(c, depth + 1);
}

console.log(`== ${path}`);
console.log(`generator: ${gltf.asset?.generator}`);
for (const s of gltf.scenes ?? []) for (const r of s.nodes) walk(r, 0);
console.log(`\nmaterials: ${(gltf.materials ?? []).map((m: Json) => `${m.name}${m.pbrMetallicRoughness?.baseColorTexture ? '(tex)' : ''}`).join(', ')}`);
console.log(`textures: ${(gltf.images ?? []).length} images`);
for (const [i, s] of (gltf.skins ?? []).entries()) {
  console.log(`skin ${i}: ${s.joints.length} joints: ${s.joints.map((j: number) => gltf.nodes[j].name).join(', ')}`);
}
for (const a of gltf.animations ?? []) console.log(`animation "${a.name}": ${a.channels.length} channels`);
