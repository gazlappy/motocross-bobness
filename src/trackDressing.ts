import * as THREE from 'three';
import { type Heightmap, sampleHeight } from './heightmap.ts';
import { TRACK_HALF_WIDTH } from './track.ts';

// Visual dressing for the track: marker stakes along both edges, hay bales round the outside of the
// tight turns, and the start/finish arch. Nothing here has physics.

const STAKE_SPACING = 9;
const BALE_SPACING = 2.6;

export function createTrackDressing(hm: Heightmap) {
  const group = new THREE.Group();
  const track = hm.track;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);

  // Stakes: alternating red and white, just off each edge.
  const stakeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5).translate(0, 0.55, 0);
  const stakes = new THREE.InstancedMesh(stakeGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.ceil(track.length / STAKE_SPACING) * 2);
  const red = new THREE.Color(0xd8261c), white = new THREE.Color(0xf4f1ea);
  let count = 0;
  for (let s = 0; s < track.length; s += STAKE_SPACING) {
    const p = track.sample(s);
    for (const side of [-1, 1]) {
      const lat = TRACK_HALF_WIDTH + 1.3;
      const x = p.x + p.tz * lat * side, z = p.z - p.tx * lat * side;
      m.compose(new THREE.Vector3(x, sampleHeight(hm, x, z) - 0.05, z), q, one);
      stakes.setMatrixAt(count, m);
      stakes.setColorAt(count, (count >> 1) % 2 ? red : white);
      count++;
    }
  }
  stakes.count = count;
  stakes.castShadow = true;
  group.add(stakes);

  // Hay bales round the outside of the tighter turns.
  const baleGeo = new THREE.BoxGeometry(1.15, 0.55, 0.6).translate(0, 0.27, 0);
  const balePositions: THREE.Matrix4[] = [];
  for (let s = 0; s < track.length; s += BALE_SPACING) {
    const p = track.sample(s);
    if (Math.abs(p.curvature) < 1 / 45) continue;
    const outside = -Math.sign(p.curvature); // +1 = left of travel
    const lat = TRACK_HALF_WIDTH + 3.2;
    const x = p.x + p.tz * lat * outside, z = p.z - p.tx * lat * outside;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-p.tz, p.tx)); // long side along the track
    balePositions.push(new THREE.Matrix4().compose(new THREE.Vector3(x, sampleHeight(hm, x, z) - 0.05, z), q.clone(), one));
  }
  const bales = new THREE.InstancedMesh(baleGeo, new THREE.MeshLambertMaterial({ color: 0xd9b44a }), Math.max(1, balePositions.length));
  balePositions.forEach((bm, i) => bales.setMatrixAt(i, bm));
  bales.count = balePositions.length;
  bales.castShadow = bales.receiveShadow = true;
  group.add(bales);

  group.add(createStartArch(hm));
  return group;
}

function chequeredBanner() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const sq = 16;
  for (let y = 0; y < 96; y += sq) {
    for (let x = 0; x < 512; x += sq) {
      ctx.fillStyle = ((x + y) / sq) % 2 ? '#111' : '#f4f1ea';
      ctx.fillRect(x, y, sq, sq);
    }
  }
  ctx.fillStyle = '#d8261c';
  ctx.fillRect(96, 14, 320, 68);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold italic 52px Trebuchet MS, Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('START / FINISH', 256, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createStartArch(hm: Heightmap) {
  const p = hm.track.sample(0);
  const arch = new THREE.Group();
  const width = TRACK_HALF_WIDTH * 2 + 3;
  const height = 4.6;
  const postMat = new THREE.MeshLambertMaterial({ color: 0x333338 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, height, 0.35), postMat);
    post.position.set((side * width) / 2, height / 2, 0);
    post.castShadow = true;
    arch.add(post);
  }
  const bannerMat = new THREE.MeshLambertMaterial({ map: chequeredBanner() });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(width + 0.35, 1.1, 0.2), bannerMat);
  banner.position.set(0, height - 0.2, 0);
  banner.castShadow = true;
  arch.add(banner);
  arch.position.set(p.x, sampleHeight(hm, p.x, p.z) - 0.1, p.z);
  // Face along the track (the banner spans across it).
  arch.rotation.y = Math.atan2(p.tx, p.tz);
  return arch;
}
