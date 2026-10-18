import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { EDGE_PLATEAU, buildHeightmap, sampleHeight } from '../heightmap.ts';
import { DESERT, createTerrainMesh } from '../terrain.ts';
import { BAJA_LOOK } from '../terrainLook.ts';
import { type Atmosphere, type Ground, SUNNY, type Venue, onGround, rockColliders, scatterRocks, venueColliders } from '../venue.ts';

// Baja: open desert, 1.28 km across, with dunes, mesas and washes. No track: a chain of waypoints
// across the map, each marked by a flag and a tall beacon you can see from far away.

const WAYPOINTS: [number, number][] = [
  [-250, -390], [-30, -440], [210, -300], [400, -90], [260, 150], [40, 300], [-220, 230], [-430, 420],
];
const START: [number, number] = [-470, -470];

const DESERT_FAR: Atmosphere = {
  ...SUNNY,
  sky: 0xa9cbe6,
  fog: { color: 0xd8d2c4, near: 250, far: 1100 },
  far: 1800,
};

function numberTexture(n: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#d8261c';
  ctx.font = 'bold italic 96px Trebuchet MS, Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A waypoint: a pole with a numbered flag, and a beacon column. Its beacon material is recoloured by the HUD. */
function marker(n: number, finish: boolean) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 9, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  pole.position.y = 4.5;
  pole.castShadow = true;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshLambertMaterial({ map: numberTexture(n), side: THREE.DoubleSide }));
  flag.position.set(1.6, 7.4, 0);
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 160, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: finish ? 0xffffff : 0xffb020, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  beacon.position.y = 80;
  beacon.name = 'beacon';
  g.add(pole, flag, beacon);
  return g;
}

export function bajaGround(): Ground {
  const flats = [...WAYPOINTS, START].map(([x, z]) => ({ x, z, r: 30 }));
  flats[flats.length - 1].r = 45;
  const hm = buildHeightmap({
    size: 1280 + 2 * EDGE_PLATEAU,
    cells: (1280 + 2 * EDGE_PLATEAU) / 2.5,
    seed: 21,
    natural: (noise, x, z) => {
      let h = noise.fbm(x / 420, z / 420, 4) * 40; // broad rolling country
      const ridge = noise.fbm(x / 80 + 3, z / 120 - 7, 3);
      h += Math.sqrt(ridge * ridge + 0.004) * 6; // dune ridges, rounded off at the crest
      const mesa = noise.fbm(x / 170 - 11, z / 170 + 5, 3);
      h += Math.min(1, Math.max(0, (mesa - 0.25) * 3)) * 14; // mesas with rideable sides
      const wash = noise.fbm(x / 260 + 9, z / 260, 3);
      h -= Math.max(0, 0.12 - Math.abs(wash)) * 30; // shallow dry washes
      h += noise.fbm(x / 15, z / 15, 2) * 0.5;
      return h;
    },
    edgeWall: { height: 56, width: 80, plateau: EDGE_PLATEAU },
    track: null,
    trackBlend: 0,
    flats,
  });

  const waypoints = WAYPOINTS.map(([x, z]) => onGround(hm, x, z, 0));

  // Start line: riders spread across, facing the first waypoint.
  const [sx, sz] = START;
  const first = waypoints[0];
  const yaw = Math.atan2(-(first.x - sx), -(first.z - sz));
  const across = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  return {
    hm,
    waypoints,
    grid: (i) => {
      const row = Math.floor(i / 4), col = (i % 4) - 1.5;
      const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(row * 7);
      const x = sx + across.x * col * 5 + back.x, z = sz + across.z * col * 5 + back.z;
      return [new THREE.Vector3(x, sampleHeight(hm, x, z) + 1, z), yaw];
    },
  };
}

export function buildBaja(world: RAPIER.World): Venue {
  const ground = bajaGround();
  const hm = ground.hm;
  const markers = ground.waypoints!.map((w, i, all) => {
    const m = marker(i + 1, i === all.length - 1);
    m.position.copy(w);
    return m;
  });
  const keepClear = [...WAYPOINTS, START].map(([x, z]) => ({ x, z, r: 50 }));
  const root = new THREE.Group();
  const rocks = scatterRocks(hm, 700, 0x8b6248, keepClear, 777);
  root.add(createTerrainMesh(hm, DESERT, 8, BAJA_LOOK), rocks, ...markers);
  return {
    ...ground,
    id: 'baja',
    name: 'Baja',
    root,
    colliders: venueColliders(world, hm, rockColliders(rocks)),
    atmosphere: DESERT_FAR,
    cannon: true,
    dirt: { dust: 0xd8bc8e, clod: 0xa8834f, dustAmount: 1.6, clodAmount: 0.6 },
    markers,
  };
}
