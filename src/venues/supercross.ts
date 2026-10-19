import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildHeightmap } from '../heightmap.ts';
import { type TerrainPalette, createTerrainMesh } from '../terrain.ts';
import { createTrackDressing } from '../trackDressing.ts';
import { SUPERCROSS_LOOK } from '../terrainLook.ts';
import { Race } from '../race.ts';
import { type Jump, Track, type TrackDef } from '../track.ts';
import { type Atmosphere, type Ground, SUNNY, type Venue, onGround, venueColliders } from '../venue.ts';
import { SX_COLS, SX_ROWS, SX_TILE, type SxTrack, barrierEdges, tileCentre, toTrackDef } from '../sxTrack.ts';

// Supercross: a tight track on a dirt floor inside a stadium. The classic layout is four straights
// joined by 180-degree hairpins and a return lane, with a rhythm section, whoops and big tabletops;
// any track built from pieces (the editor, the Season) can be raced instead, in any of the
// original's stadium styles. Padded walls keep you in (no cannon indoors).

/** Half-size of the floor inside the walls: the classic track's, and a piece track's (its grid plus run-off). */
const CLASSIC_ARENA = { x: 71, z: 37 };
const PIECE_ARENA = { x: (SX_COLS * SX_TILE) / 2 + 6, z: (SX_ROWS * SX_TILE) / 2 + 6 };
const arenaFor = (spec: SupercrossSpec) => (spec.track ? PIECE_ARENA : CLASSIC_ARENA);

const jumps: Jump[] = [
  // Rhythm section on the second straight.
  ...Array.from({ length: 6 }, (_, i) => ({ at: 90 + i * 8, up: 3, rise: 1.4, top: 0, down: 3, speed: 9 })),
  // Back-to-back tabletops: forgiving if you come up short.
  { at: 198, up: 4, rise: 1.8, top: 9, down: 5, speed: 10 },
  { at: 228, up: 4, rise: 1.8, top: 6, down: 5, speed: 10 },
  // Whoops, then the big tabletop before the return lane.
  ...Array.from({ length: 8 }, (_, i) => ({ at: 308 + i * 5, up: 2.5, rise: 0.3, top: 0, down: 2.5, speed: 8 })),
  { at: 362, up: 6, rise: 2.6, top: 8, down: 7, speed: 12 },
  // A pair of rollers on the return lane.
  { at: 428, up: 3, rise: 0.9, top: 0, down: 3, speed: 10 },
  { at: 440, up: 3, rise: 0.9, top: 0, down: 3, speed: 10 },
];

export const SUPERCROSS: TrackDef = {
  name: 'Supercross',
  control: [
    [0, -27], [30, -27], [50, -27], [58.4, -24.4], [61, -18], [58.4, -11.6], [52, -9],
    [20, -9], [-10, -9], [-30, -9], [-36.4, -6.4], [-39, 0], [-36.4, 6.4], [-30, 9],
    [0, 9], [30, 9], [52, 9], [58.4, 11.6], [61, 18], [58.4, 24.4], [52, 27],
    [20, 27], [-10, 27], [-44, 27], [-55, 25], [-62, 15], [-62, 0], [-62, -15], [-55, -25], [-44, -27], [-22, -27],
  ],
  halfWidth: 4.2,
  jumps,
  bermScale: 30,
  bermMax: 1.5,
  curvatureWindow: 4,
};

const LOAM: TerrainPalette = {
  base: 0x6b4a33, grass: 0x6b4a33, dirt: 0x5a3d29, track: 0x4d3322, rock: 0x5e402b, grassAmount: 0, dirtAmount: 0.5,
};

/** The original's stadiums: square ones by day or night, the dome, the pyramid and the excavation site. */
export type StadiumId = 'square-night' | 'square-day' | 'dome' | 'pyramid' | 'excavation';
export const STADIUMS: { id: StadiumId; name: string }[] = [
  { id: 'square-night', name: 'Square Stadium (night)' },
  { id: 'square-day', name: 'Square Stadium (day)' },
  { id: 'dome', name: 'Dome Stadium' },
  { id: 'pyramid', name: 'Pyramid' },
  { id: 'excavation', name: 'Excavation Site' },
];

/** Which track and stadium a Supercross event runs in (the classic track at night by default). */
export interface SupercrossSpec {
  track?: SxTrack;
  stadium?: StadiumId;
}

const NIGHT: Atmosphere = {
  sky: 0x06070d,
  fog: { color: 0x0b0c14, near: 90, far: 260 },
  hemi: { sky: 0xa8b4d0, ground: 0x5a3a22, intensity: 1.15 },
  sun: { color: 0xfff6e8, intensity: 2.6, offset: new THREE.Vector3(-15, 60, 12) },
  crowd: true,
  far: 600,
};

const DAY: Atmosphere = {
  ...SUNNY,
  fog: { color: 0xc9d6dc, near: 140, far: 420 },
  crowd: true,
  far: 700,
};
const DOME: Atmosphere = {
  ...NIGHT,
  sky: 0x12131a,
  fog: { color: 0x15161e, near: 80, far: 220 },
  hemi: { sky: 0xc8d0e8, ground: 0x5a3a22, intensity: 1.35 },
};
const DUSK: Atmosphere = {
  sky: 0xe7a46a,
  fog: { color: 0xd9a77c, near: 120, far: 420 },
  hemi: { sky: 0xffd8b0, ground: 0x7a5032, intensity: 1.05 },
  sun: { color: 0xffc890, intensity: 2.2, offset: new THREE.Vector3(70, 35, -30) },
  crowd: true,
  far: 800,
};
const DUSTY_DAY: Atmosphere = {
  ...SUNNY,
  sky: 0xb7cde0,
  fog: { color: 0xd8cbb4, near: 140, far: 420 },
  crowd: false,
  far: 700,
};

const ATMOSPHERES: Record<StadiumId, Atmosphere> = {
  'square-night': NIGHT, 'square-day': DAY, dome: DOME, pyramid: DUSK, excavation: DUSTY_DAY,
};

/** A banked stand of fans as a texture: rows of little coloured blobs on dark seats. */
function crowdTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1b1d26';
  ctx.fillRect(0, 0, 512, 256);
  const shirts = ['#d8261c', '#f2c418', '#1f5fd1', '#e8e8e8', '#2f9e3a', '#f07a1a', '#7a3fb0', '#222'];
  const skins = ['#f1c9a5', '#c68e62', '#8d5524', '#e0ac69'];
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let row = 0; row < 16; row++) {
    for (let x = 0; x < 512; x += 7) {
      if (rand() < 0.12) continue;
      const y = row * 16 + 4;
      ctx.fillStyle = shirts[Math.floor(rand() * shirts.length)];
      ctx.fillRect(x + rand() * 2, y + 5, 6, 7);
      ctx.fillStyle = skins[Math.floor(rand() * skins.length)];
      ctx.fillRect(x + 1 + rand() * 2, y, 4, 5);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function stadium(style: StadiumId = 'square-night', arena = CLASSIC_ARENA) {
  const ARENA_X = arena.x, ARENA_Z = arena.z;
  const group = new THREE.Group();
  const crowd = crowdTexture();
  const stands = style !== 'excavation';
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0x1f5fd1 });
  const concrete = new THREE.MeshLambertMaterial({ color: 0x2a2c34 });

  // Padded walls round the floor, with a blue stripe along the top.
  const sides: [number, number, number, number][] = [
    [0, -ARENA_Z, ARENA_X * 2, 0], [0, ARENA_Z, ARENA_X * 2, Math.PI],
    [-ARENA_X, 0, ARENA_Z * 2, Math.PI / 2], [ARENA_X, 0, ARENA_Z * 2, -Math.PI / 2],
  ];
  for (const [x, z, length, yaw] of sides) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(length, 1.3, 0.6), wallMat);
    wall.position.set(x, 0.65, z);
    wall.rotation.y = yaw;
    wall.receiveShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(length, 0.25, 0.62), stripeMat);
    stripe.position.set(x, 1.2, z);
    stripe.rotation.y = yaw;
    group.add(wall, stripe);

    // Banked stand rising away from the wall, covered in fans (or, at the excavation site, a bank of
    // raw earth).
    const depth = 30, rise = 22;
    const slope = Math.hypot(depth, rise);
    const tex = crowd.clone();
    tex.repeat.set(length / 14, slope / 8);
    tex.needsUpdate = true;
    const material = stands ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
    const stand = new THREE.Mesh(new THREE.PlaneGeometry(length + 2 * depth, slope), material);
    const out = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-1); // away from the floor
    stand.position.set(x + out.x * (2 + depth / 2), 2.5 + rise / 2, z + out.z * (2 + depth / 2));
    stand.rotation.order = 'YXZ';
    stand.rotation.y = yaw;
    stand.rotation.x = -Math.atan2(rise, depth);
    stand.receiveShadow = !stands;
    group.add(stand);

    const base = new THREE.Mesh(new THREE.BoxGeometry(length + 4, 2.5, 2), concrete);
    base.position.set(x + out.x * 1.6, 1.25, z + out.z * 1.6);
    base.rotation.y = yaw;
    group.add(base);
  }

  if (style === 'dome') {
    // A roof over everything.
    const roof = new THREE.Mesh(
      new THREE.SphereGeometry(140, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.6),
      new THREE.MeshLambertMaterial({ color: 0x3a3d48, side: THREE.BackSide }),
    );
    roof.scale.set(1, 0.45, 0.75);
    roof.position.y = 2;
    group.add(roof);
  }
  if (style === 'pyramid') {
    // The great pyramid looming beyond the far stand.
    const pyramid = new THREE.Mesh(new THREE.ConeGeometry(110, 120, 4), new THREE.MeshLambertMaterial({ color: 0xd8b77c }));
    pyramid.position.set(0, 58, -190);
    pyramid.rotation.y = Math.PI / 4;
    group.add(pyramid);
  }
  if (style === 'excavation') {
    // Diggers parked up on the banks.
    const yellow = new THREE.MeshLambertMaterial({ color: 0xe8b21c });
    for (const [x, z, yaw] of [[-60, -62, 0.4], [55, 64, 2.9], [92, -10, 1.5]] as const) {
      const digger = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), yellow);
      body.position.y = 2.3;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 6), yellow);
      arm.position.set(0, 4, -4);
      arm.rotation.x = -0.6;
      const tracks = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1, 4), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
      tracks.position.y = 0.5;
      digger.add(body, arm, tracks);
      digger.position.set(x, 12, z);
      digger.rotation.y = yaw;
      group.add(digger);
    }
    return group;
  }

  // Lighting rigs hung over the floor.
  const rigMat = new THREE.MeshBasicMaterial({ color: 0xfff8e6 });
  const trussMat = new THREE.MeshLambertMaterial({ color: 0x3a3c44 });
  for (const x of [-45, -15, 15, 45]) {
    const truss = new THREE.Mesh(new THREE.BoxGeometry(1, 1, ARENA_Z * 2), trussMat);
    truss.position.set(x, 34, 0);
    group.add(truss);
    for (const z of [-24, -8, 8, 24]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 1.4), rigMat);
      lamp.position.set(x, 33.2, z);
      group.add(lamp);
    }
  }
  return group;
}

/** Tuff-block barriers between lanes that run side by side (piece tracks only). */
function barriers(spec: SupercrossSpec) {
  if (!spec.track) return [];
  return barrierEdges(spec.track).map(({ col, row, side }) => {
    const [cx, cz] = tileCentre(col, row);
    const east = side === 1;
    return {
      x: cx + (east ? SX_TILE / 2 : 0), z: cz + (east ? 0 : SX_TILE / 2),
      // Stopping short of the tile corners, so the inside of a hairpin isn't a wall.
      hx: east ? 0.3 : SX_TILE / 2 - 1.5, hz: east ? SX_TILE / 2 - 1.5 : 0.3,
    };
  });
}

export function supercrossGround(spec: SupercrossSpec = {}): Ground {
  const { x: ARENA_X, z: ARENA_Z } = arenaFor(spec);
  const track = new Track(spec.track ? toTrackDef(spec.track) : SUPERCROSS);
  const hm = buildHeightmap({
    size: 170,
    cells: 340,
    seed: 3,
    natural: (noise, x, z) => noise.fbm(x / 9, z / 9, 2) * 0.05,
    edgeWall: null,
    track,
    trackBlend: 7,
  });
  // Tall invisible walls: the padded ones are only waist high, but nobody leaves the stadium.
  const wall = (x: number, z: number, hx: number, hz: number) =>
    RAPIER.ColliderDesc.cuboid(hx, 6, hz).setTranslation(x, 6, z).setFriction(0.4).setRestitution(0.2);
  const walls = [
    wall(0, -ARENA_Z - 0.3, ARENA_X + 1, 0.3), wall(0, ARENA_Z + 0.3, ARENA_X + 1, 0.3),
    wall(-ARENA_X - 0.3, 0, 0.3, ARENA_Z + 1), wall(ARENA_X + 0.3, 0, 0.3, ARENA_Z + 1),
    ...barriers(spec).map((b) =>
      RAPIER.ColliderDesc.cuboid(b.hx, 0.35, b.hz).setTranslation(b.x, 0.35, b.z).setFriction(0.5).setRestitution(0.1)),
  ];

  return {
    hm,
    extra: walls,
    grid: (i) => {
      const [p, yaw] = Race.gridSlot(track, i);
      return [onGround(hm, p.x, p.z), yaw];
    },
  };
}

/** Rows of white and red tuff blocks along the barrier edges. */
function barrierMeshes(spec: SupercrossSpec) {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const red = new THREE.MeshLambertMaterial({ color: 0xd8261c });
  const block = new THREE.BoxGeometry(1.2, 0.7, 0.6);
  for (const b of barriers(spec)) {
    const along = b.hx > b.hz;
    const n = Math.round((along ? b.hx : b.hz) * 2 / 1.25);
    for (let i = 0; i < n; i++) {
      const off = -((n - 1) * 1.25) / 2 + i * 1.25;
      const m = new THREE.Mesh(block, i % 2 ? red : white);
      m.position.set(b.x + (along ? off : 0), 0.35, b.z + (along ? 0 : off));
      if (!along) m.rotation.y = Math.PI / 2;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }
  return group;
}

export function buildSupercross(world: RAPIER.World, spec: SupercrossSpec = {}): Venue {
  const ground = supercrossGround(spec);
  const hm = ground.hm;
  const style = spec.stadium ?? 'square-night';
  const root = new THREE.Group();
  root.add(createTerrainMesh(hm, LOAM, 4, SUPERCROSS_LOOK), createTrackDressing(hm, hm.track!, 'stadium'), stadium(style, arenaFor(spec)), barrierMeshes(spec));
  return {
    ...ground,
    id: 'supercross',
    name: spec.track?.name ?? 'Supercross',
    root,
    colliders: venueColliders(world, hm, ground.extra),
    atmosphere: ATMOSPHERES[style],
    cannon: false,
    dirt: { dust: 0x7a5c46, clod: 0x5a3c26, dustAmount: 0.5, clodAmount: 1.3 },
  };
}
