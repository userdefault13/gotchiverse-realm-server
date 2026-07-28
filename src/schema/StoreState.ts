import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player';

/** Soft-launch retail interior: 16×16 tiles (phase 1 default). */
export const STORE_INTERIOR_W = 16;
export const STORE_INTERIOR_H = 16;
export const STORE_TILE_PX = 64;

export class StoreState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('string') storeId: string = '';
  @type('string') cartridgeId: string = '';
  @type('string') ownerAddress: string = '';
  @type('number') interiorW: number = STORE_INTERIOR_W;
  @type('number') interiorH: number = STORE_INTERIOR_H;
  /** JSON StoreLayout — synced so shoppers see shelves/cashier. */
  @type('string') layoutJson: string = '';
}
