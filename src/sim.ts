import RAPIER from '@dimforge/rapier3d-compat';
import type { Controls } from './input.ts';
import { type Player, drainEvents } from './player.ts';

/** Steps several players sharing one physics world: every bike rides, then the world steps once. */
export class Sim {
  readonly world: RAPIER.World;
  readonly players: Player[] = [];
  private queue = new RAPIER.EventQueue(true);

  constructor(world: RAPIER.World) {
    this.world = world;
  }

  step(controls: Controls[], dt: number) {
    this.players.forEach((p, i) => p.beforeStep(controls[i], dt));
    this.world.step(this.queue);
    const events = drainEvents(this.queue);
    for (const p of this.players) p.afterStep(dt, events);
  }
}
