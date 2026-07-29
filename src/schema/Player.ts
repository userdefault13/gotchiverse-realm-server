import { Schema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string') sessionId: string = '';
  @type('string') address: string = '';
  @type('string') gotchiId: string = '';
  @type('string') name: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  /** Combat HP (aarena-rh). Base aarena leaves at max. */
  @type('number') hp: number = 3;
  @type('number') maxHp: number = 3;
  /** Soft-launch Aarcade cartridge for SIM pocket prizes. */
  @type('string') cartridgeId: string = '';
}
