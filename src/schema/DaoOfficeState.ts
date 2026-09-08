import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player';

/** Soft-launch DAO Office interior: 8×8 (world tent / humble parcel footprint). */
export const DAO_OFFICE_INTERIOR_W = 8;
export const DAO_OFFICE_INTERIOR_H = 8;
export const DAO_OFFICE_TILE_PX = 64;

export class DaoOfficeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('string') daoOfficeId: string = '';
  @type('string') cartridgeId: string = '';
  @type('string') ownerAddress: string = '';
  @type('number') interiorW: number = DAO_OFFICE_INTERIOR_W;
  @type('number') interiorH: number = DAO_OFFICE_INTERIOR_H;
  /** JSON DaoOfficeLayout — floor stub until furniture art lands. */
  @type('string') layoutJson: string = '';
}
