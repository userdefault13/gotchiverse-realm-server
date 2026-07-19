import { Schema, type } from '@colyseus/schema';

export class Antenna extends Schema {
  @type('string') id: string = '';
  @type('string') ownerSessionId: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') hp: number = 100;
  @type('boolean') powered: boolean = true;
}
