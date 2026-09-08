/**
 * Trait-only combat profile (Gotchiverse Bible Ch.2).
 * Numbers ported from shared_code GAME_CONFIG + shared.utils.api (no Decimal / wearables).
 */

export type TraitStats = {
  NRG: number;
  AGG: number;
  SPK: number;
  BRN: number;
};

export type CombatProfile = {
  maxHp: number;
  maxAp: number;
  meleePower: number;
  rangedPower: number;
  defense: number;
  damageReduction: number;
  evasion: number;
  luck: number;
  apCostMultiplier: number;
  healthRegen: number;
  apRegen: number;
  minMeleeInterval: number;
  minFireInterval: number;
  attackSpeed: number;
};

/** Mirrored combat constants from shared_code/constants/const.game.ts */
export const COMBAT_CONFIG = {
  damageCoefficient: 2,
  fireRate: 4,
  meleeRate: 3,
  slapAPCost: 1,
  rushAPCost: 20,
  rangeAPCost: 3,
  chargedRangeAPCost: 10,
  baseMeleeDamage: 100,
  baseRushDamage: 100,
  baseRangedDamage: 60,
  baseSnipeDamage: 150,
  enableVariableDamage: true,
  enableEvasion: true,
  baseEvasion: 0,
  baseLuck: 1,
  maxAttackSpeedModifier: 2,
  maxAP: 500,
  maxAPBuffCoef: 1,
  maxHealth: 2500,
  maxHealthBuffCoef: 10,
  baseDefense: 0,
  baseRangedPower: 0,
  rangeBuffCoef: 1,
  baseMeleePower: 0,
  meleeBuffCoef: 1.5,
  luckBuffCoef: 0.005,
  actionSpeedBuffCoef: 0.01,
  enableHealthRegen: true,
  healthRegenPerSecond: 7.5,
  apRegenPerSecond: 3,
  regenBuffCoef: 0.02,
  defaultHealth: 1000,
  defaultAp: 100,
} as const;

const BASELINE_TRAITS: TraitStats = { NRG: 50, AGG: 50, SPK: 50, BRN: 50 };

export function clampTrait(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.min(99, Math.max(0, Math.round(v)));
}

/** Parse join-option traits; non-numeric / short / cartridge → 50 baseline. */
export function parseJoinTraits(raw: unknown): TraitStats {
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return { ...BASELINE_TRAITS };
    }
  }
  if (!Array.isArray(arr) || arr.length < 4) return { ...BASELINE_TRAITS };
  return {
    NRG: clampTrait(arr[0]),
    AGG: clampTrait(arr[1]),
    SPK: clampTrait(arr[2]),
    BRN: clampTrait(arr[3]),
  };
}

function getMaxHealth(t: TraitStats): number {
  let base = COMBAT_CONFIG.defaultHealth;
  const threshold = 50;
  if (t.NRG < threshold) {
    base += COMBAT_CONFIG.maxHealthBuffCoef * (threshold - t.NRG);
  }
  return Math.min(base, COMBAT_CONFIG.maxHealth);
}

function getMaxAp(t: TraitStats): number {
  let base = COMBAT_CONFIG.defaultAp;
  const threshold = 50;
  if (t.NRG > threshold) {
    base += COMBAT_CONFIG.maxAPBuffCoef * (t.NRG - (threshold - 1));
  }
  return Math.min(base, COMBAT_CONFIG.maxAP);
}

function getRangedPower(t: TraitStats): number {
  let base = COMBAT_CONFIG.baseRangedPower;
  const threshold = 50;
  if (t.BRN > threshold) {
    base += COMBAT_CONFIG.rangeBuffCoef * (t.BRN - (threshold - 1));
  }
  return base;
}

function getMeleePower(t: TraitStats): number {
  let base = COMBAT_CONFIG.baseMeleePower;
  const threshold = 50;
  if (t.BRN < threshold) {
    base += COMBAT_CONFIG.meleeBuffCoef * (threshold - t.BRN);
  }
  return Math.round(base);
}

function getDefense(t: TraitStats): number {
  let base = COMBAT_CONFIG.baseDefense;
  const threshold = 50;
  if (t.AGG < threshold) {
    base += 1 * (threshold - t.AGG);
  }
  return base;
}

function getDamageReduction(defense: number): number {
  const calculated = defense * 0.005;
  return Number(Math.min(1, calculated / (1 + calculated)).toFixed(3));
}

function getLuck(t: TraitStats): number {
  let base = COMBAT_CONFIG.baseLuck;
  const threshold = 50;
  if (t.SPK >= threshold) {
    base += COMBAT_CONFIG.luckBuffCoef * (t.SPK - threshold);
  }
  return Number(base.toFixed(3));
}

function getAttackSpeed(t: TraitStats): number {
  let base = 1;
  const threshold = 50;
  if (t.AGG > threshold) {
    base += COMBAT_CONFIG.actionSpeedBuffCoef * (t.AGG - (threshold - 1));
  }
  return Math.min(COMBAT_CONFIG.maxAttackSpeedModifier, base);
}

function getAttackIntervals(attackSpeed: number): { minFireInterval: number; minMeleeInterval: number } {
  const calcFireRate = COMBAT_CONFIG.fireRate * attackSpeed;
  const calcMeleeRate = COMBAT_CONFIG.meleeRate * attackSpeed;
  return {
    minFireInterval: Number((1000 / Math.ceil(calcFireRate)).toFixed(3)),
    minMeleeInterval: Number((1000 / Math.ceil(calcMeleeRate)).toFixed(3)),
  };
}

function getRegen(t: TraitStats, type: 'health' | 'AP'): number {
  let base = type === 'health' ? COMBAT_CONFIG.healthRegenPerSecond : COMBAT_CONFIG.apRegenPerSecond;
  const threshold = 50;
  if (t.SPK < threshold) {
    const diffTimesCoef = COMBAT_CONFIG.regenBuffCoef * (threshold - t.SPK);
    base = base * (1 + diffTimesCoef);
  }
  return base;
}

export function resolveCombatProfile(traits: TraitStats): CombatProfile {
  const defense = getDefense(traits);
  const attackSpeed = getAttackSpeed(traits);
  const { minFireInterval, minMeleeInterval } = getAttackIntervals(attackSpeed);
  return {
    maxHp: getMaxHealth(traits),
    maxAp: getMaxAp(traits),
    meleePower: getMeleePower(traits),
    rangedPower: getRangedPower(traits),
    defense,
    damageReduction: getDamageReduction(defense),
    evasion: COMBAT_CONFIG.baseEvasion,
    luck: getLuck(traits),
    apCostMultiplier: 1,
    healthRegen: COMBAT_CONFIG.enableHealthRegen ? getRegen(traits, 'health') : 0,
    apRegen: COMBAT_CONFIG.enableHealthRegen ? getRegen(traits, 'AP') : 0,
    minMeleeInterval,
    minFireInterval,
    attackSpeed,
  };
}

export type AttackKind = 'slap' | 'rush' | 'ranged' | 'snipe';

export function apCostFor(kind: AttackKind, profile: CombatProfile): number {
  const mult = profile.apCostMultiplier || 1;
  switch (kind) {
    case 'slap':
      return COMBAT_CONFIG.slapAPCost * mult;
    case 'rush':
      return COMBAT_CONFIG.rushAPCost * mult;
    case 'ranged':
      return COMBAT_CONFIG.rangeAPCost * mult;
    case 'snipe':
      return COMBAT_CONFIG.chargedRangeAPCost * mult;
    default:
      return COMBAT_CONFIG.slapAPCost * mult;
  }
}

export function baseDamageFor(kind: AttackKind, profile: CombatProfile): number {
  switch (kind) {
    case 'slap':
      return COMBAT_CONFIG.baseMeleeDamage + profile.meleePower;
    case 'rush':
      return COMBAT_CONFIG.baseRushDamage + profile.meleePower;
    case 'ranged':
      return COMBAT_CONFIG.baseRangedDamage + profile.rangedPower;
    case 'snipe':
      return COMBAT_CONFIG.baseSnipeDamage + profile.rangedPower;
    default:
      return COMBAT_CONFIG.baseMeleeDamage + profile.meleePower;
  }
}

/** Roll damage against victim DR / evasion. Returns 0 when evaded. */
export function rollDamage(
  kind: AttackKind,
  attacker: CombatProfile,
  victim: CombatProfile,
): { damage: number; evaded: boolean } {
  if (COMBAT_CONFIG.enableEvasion) {
    // Traits-only: baseEvasion is 0; SPK≥50 raises luck above 1 → evade chance.
    const evadeChance = Math.min(0.5, Math.max(0, victim.luck - 1) + victim.evasion);
    if (evadeChance > 0 && Math.random() < evadeChance) {
      return { damage: 0, evaded: true };
    }
  }

  const base = baseDamageFor(kind, attacker);
  let raw = base;
  if (COMBAT_CONFIG.enableVariableDamage) {
    const max = base * COMBAT_CONFIG.damageCoefficient;
    raw = base + Math.random() * (max - base);
  }
  const damage = Math.max(1, Math.round(raw * (1 - victim.damageReduction)));
  return { damage, evaded: false };
}
