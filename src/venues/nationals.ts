import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { buildHeightmap, nationalsTerrain } from '../heightmap.ts';
import { createTerrainMesh } from '../terrain.ts';
import { createTrackDressing } from '../trackDressing.ts';
import { Race } from '../race.ts';
import { NATIONALS, Track } from '../track.ts';
import { type Ground, SUNNY, type Venue, onGround, rockColliders, scatterRocks, venueColliders } from '../venue.ts';

/** Outdoor motocross: the ~940 m Nationals loop through desert hills. */
export function nationalsGround(): Ground {
  const track = new Track(NATIONALS);
  const hm = buildHeightmap(nationalsTerrain(track));
  return {
    hm,
    grid: (i) => {
      const [p, yaw] = Race.gridSlot(track, i);
      return [onGround(hm, p.x, p.z), yaw];
    },
  };
}

export function buildNationals(world: RAPIER.World): Venue {
  const ground = nationalsGround();
  const hm = ground.hm;
  const root = new THREE.Group();
  const rocks = scatterRocks(hm, 260);
  root.add(createTerrainMesh(hm), createTrackDressing(hm, hm.track!), rocks);
  return {
    ...ground,
    id: 'nationals',
    name: 'Nationals',
    root,
    colliders: venueColliders(world, hm, rockColliders(rocks)),
    atmosphere: SUNNY,
    cannon: true,
    dirt: { dust: 0x9c7c5a, clod: 0x6a4a30, dustAmount: 1, clodAmount: 1 },
  };
}
