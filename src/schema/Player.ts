import { Schema, type } from '@colyseus/schema';

export class Player extends Schema {
  @type('string') sessionId: string = '';
  @type('string') address: string = '';
  @type('string') gotchiId: string = '';
  @type('string') name: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  /** Combat HP (trait-scaled; both aarena rooms). */
  @type('number') hp: number = 1000;
  @type('number') maxHp: number = 1000;
  /** Attack stamina (AP). */
  @type('number') ap: number = 100;
  @type('number') maxAp: number = 100;
  /** Soft-launch Aarcade cartridge for SIM pocket prizes. */
  @type('string') cartridgeId: string = '';
}
