import { Schema, type } from '@colyseus/schema';

/** Desert Link-breaker scout — kill for chance at alchemica cargo drops. */
export class FoundryEnemy extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') hp: number = 100;
  @type('number') maxHp: number = 100;
  @type('string') kind: string = 'linkbreaker';
}
