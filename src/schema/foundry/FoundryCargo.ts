import { Schema, type } from '@colyseus/schema';

export class FoundryCargo extends Schema {
  @type('string') sessionId: string = '';
  @type('number') fud: number = 0;
  @type('number') fomo: number = 0;
  @type('number') alpha: number = 0;
  @type('number') kek: number = 0;

  @type('number') ironOre: number = 0;
  @type('number') copperOre: number = 0;
  @type('number') aluminumOre: number = 0;
  @type('number') cobaltOre: number = 0;
  @type('number') methane: number = 0;
  @type('number') noxiousGas: number = 0;

  @type('number') steel: number = 0;
  @type('number') copperPlate: number = 0;
  @type('number') aluminumPlate: number = 0;
  @type('number') cobaltIngot: number = 0;

  @type('number') wire: number = 0;
  @type('number') bolts: number = 0;
  @type('number') nuts: number = 0;
  @type('number') screws: number = 0;
  @type('number') dishFrame: number = 0;
  @type('number') antennaCore: number = 0;
  @type('number') antennaRelay: number = 0;

  @type('number') titheAccrued: number = 0;
}
