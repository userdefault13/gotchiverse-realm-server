import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player';

/** Soft-launch Bazaar interior: 8×8 (world tent / humble parcel footprint). */
export const BAZAAR_INTERIOR_W = 8;
export const BAZAAR_INTERIOR_H = 8;
export const BAZAAR_TILE_PX = 64;

export class BazaarState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('string') bazaarId: string = '';
  @type('string') cartridgeId: string = '';
  @type('string') ownerAddress: string = '';
  @type('number') interiorW: number = BAZAAR_INTERIOR_W;
  @type('number') interiorH: number = BAZAAR_INTERIOR_H;
  /** JSON BazaarLayout — floor stub until furniture art lands. */
  @type('string') layoutJson: string = '';
}
