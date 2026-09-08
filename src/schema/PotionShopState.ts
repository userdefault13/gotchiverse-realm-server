import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player';

/** Soft-launch Potion Shop interior: 16×16 tiles (store shell). */
export const POTION_SHOP_INTERIOR_W = 16;
export const POTION_SHOP_INTERIOR_H = 16;
export const POTION_SHOP_TILE_PX = 64;

export class PotionShopState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('string') potionShopId: string = '';
  @type('string') cartridgeId: string = '';
  @type('string') ownerAddress: string = '';
  @type('number') interiorW: number = POTION_SHOP_INTERIOR_W;
  @type('number') interiorH: number = POTION_SHOP_INTERIOR_H;
  /** JSON PotionShopLayout — floor stub until furniture art lands. */
  @type('string') layoutJson: string = '';
}
