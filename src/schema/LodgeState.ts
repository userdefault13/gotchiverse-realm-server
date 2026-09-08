import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player';

/** Soft-launch lodge interior: 16×16 tiles (phase 1 default). */
export const LODGE_INTERIOR_W = 16;
export const LODGE_INTERIOR_H = 16;
export const LODGE_TILE_PX = 64;

export class LodgeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('string') lodgeId: string = '';
  @type('string') cartridgeId: string = '';
  @type('string') ownerAddress: string = '';
  @type('number') interiorW: number = LODGE_INTERIOR_W;
  @type('number') interiorH: number = LODGE_INTERIOR_H;
  /** JSON LodgeLayout — synced so guests see furniture. */
  @type('string') layoutJson: string = '';
}
