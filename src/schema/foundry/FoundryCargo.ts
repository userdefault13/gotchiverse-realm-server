import { Schema, type } from '@colyseus/schema';

export class FoundryCargo extends Schema {
  @type('string') sessionId: string = '';
  @type('number') fud: number = 0;
  @type('number') fomo: number = 0;
  @type('number') alpha: number = 0;
  @type('number') kek: number = 0;
  @type('number') salvageAntenna: number = 0;
  @type('number') salvageDish: number = 0;
  @type('number') salvageSlag: number = 0;
  @type('number') titheAccrued: number = 0;
}
