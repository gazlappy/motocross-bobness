import type RAPIER from '@dimforge/rapier3d-compat';
import type { Venue, VenueId } from '../venue.ts';
import { buildNationals } from './nationals.ts';
import { type SupercrossSpec, buildSupercross } from './supercross.ts';
import { buildBaja } from './baja.ts';
import { buildQuarry } from './quarry.ts';

const BUILDERS: Record<VenueId, (world: RAPIER.World) => Venue> = {
  nationals: buildNationals,
  supercross: buildSupercross,
  baja: buildBaja,
  quarry: buildQuarry,
};

export function buildVenue(id: VenueId, world: RAPIER.World, sx?: SupercrossSpec): Venue {
  return id === 'supercross' && sx ? buildSupercross(world, sx) : BUILDERS[id](world);
}
