import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player';
import { WildNode } from './foundry/WildNode';
import { Antenna } from './foundry/Antenna';
import { WallReceiver } from './foundry/WallReceiver';
import { FoundryCargo } from './foundry/FoundryCargo';

export class CitaadelState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: WildNode }) wildNodes = new MapSchema<WildNode>();
  @type({ map: Antenna }) antennas = new MapSchema<Antenna>();
  @type({ map: WallReceiver }) wallReceivers = new MapSchema<WallReceiver>();
  @type({ map: FoundryCargo }) cargos = new MapSchema<FoundryCargo>();
  @type('string') mapId: string = 'citaadel';
}
