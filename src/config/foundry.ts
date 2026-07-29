/**
 * Hybrid Grid Foundry — vein → material → recipe tree.
 * Coordinates are approximate citaadel map pixels.
 */
export const FOUNDRY_CONFIG = {
  enableParcelFoundryPoC: true,
  antennaLinkRangePx: 8000,
  maxAntennasPerPlayer: 3,
  gatherRangePx: 2000,
  factionTickMs: 5000,
  antennaDamagePerTick: 5,
  gatherAmount: 10,

  enemyHp: 100,
  enemyHitDamage: 25,
  enemyAttackRangePx: 2500,
  enemyRespawnMs: 45000,
  /** Chance a kill drops alchemica at all */
  enemyDropChance: 0.75,
  /** Per-token roll when a drop happens */
  enemyDropTable: {
    fud: { chance: 0.7, min: 3, max: 12 },
    fomo: { chance: 0.55, min: 2, max: 8 },
    alpha: { chance: 0.35, min: 1, max: 5 },
    kek: { chance: 0.2, min: 1, max: 3 },
  },

  yieldFields: {
    id: 'yield-fields',
    x: 320000,
    y: 140000,
    veinType: 'yield' as const,
    remaining: 10000,
  },

  ironVein: {
    id: 'iron-vein',
    x: 180000,
    y: 120000,
    veinType: 'iron' as const,
    remaining: 10000,
  },
  copperVein: {
    id: 'copper-vein',
    x: 195000,
    y: 125000,
    veinType: 'copper' as const,
    remaining: 10000,
  },
  aluminumVein: {
    id: 'aluminum-vein',
    x: 165000,
    y: 135000,
    veinType: 'aluminum' as const,
    remaining: 10000,
  },
  cobaltVein: {
    id: 'cobalt-vein',
    x: 210000,
    y: 110000,
    veinType: 'cobalt' as const,
    remaining: 8000,
  },
  methaneVent: {
    id: 'methane-vent',
    x: 150000,
    y: 150000,
    veinType: 'methane' as const,
    remaining: 8000,
  },
  noxiousVent: {
    id: 'noxious-vent',
    x: 160000,
    y: 160000,
    veinType: 'noxious' as const,
    remaining: 8000,
  },

  wallReceiverSouth: {
    id: 'wall-receiver-south',
    x: 270000,
    y: 230000,
  },
} as const;

export type FoundryConfigResponse = {
  enableParcelFoundryPoC: boolean;
  antennaLinkRangePx: number;
  maxAntennasPerPlayer: number;
  gatherRangePx: number;
  factionTickMs: number;
  antennaDamagePerTick: number;
  nodes: Array<{ id: string; x: number; y: number; veinType: string; remaining: number }>;
  wildNodes: Array<{ id: string; x: number; y: number; veinType: string; remaining: number }>;
  wallReceivers: Array<{ id: string; x: number; y: number }>;
};

/** Shop kit: same BOM as assemble-antenna + craft power (convenience UI path). */
export const FOUNDRY_ANTENNA_KITS = {
  'antenna-kit': {
    materials: {
      dishFrame: 1,
      antennaCore: 1,
      wire: 2,
      bolts: 2,
      nuts: 2,
      screws: 2,
    },
    power: { fud: 5, fomo: 5, alpha: 2, kek: 1 },
    grant: { antennaRelay: 1 },
  },
} as const;

export type ServerRecipe = {
  id: string;
  inputs: Record<string, number>;
  power: Record<string, number>;
  outputs: Record<string, number>;
};

export const FOUNDRY_SERVER_RECIPES: ServerRecipe[] = [
  { id: 'smelt-steel', inputs: { ironOre: 2 }, power: { fud: 2 }, outputs: { steel: 1 } },
  { id: 'smelt-copper', inputs: { copperOre: 2 }, power: { fomo: 2 }, outputs: { copperPlate: 1 } },
  { id: 'smelt-aluminum', inputs: { aluminumOre: 2 }, power: { alpha: 2 }, outputs: { aluminumPlate: 1 } },
  { id: 'smelt-cobalt', inputs: { cobaltOre: 2 }, power: { kek: 1 }, outputs: { cobaltIngot: 1 } },
  { id: 'draw-wire', inputs: { copperPlate: 1 }, power: { fomo: 1 }, outputs: { wire: 3 } },
  { id: 'cut-fasteners', inputs: { steel: 1 }, power: { fud: 1 }, outputs: { bolts: 2, nuts: 2 } },
  { id: 'stamp-screws', inputs: { steel: 1 }, power: { fud: 1 }, outputs: { screws: 4 } },
  {
    id: 'spin-dish-frame',
    inputs: { aluminumPlate: 2, wire: 1 },
    power: { alpha: 2 },
    outputs: { dishFrame: 1 },
  },
  {
    id: 'wind-antenna-core',
    inputs: { cobaltIngot: 1, wire: 2, methane: 1, noxiousGas: 1 },
    power: { kek: 1 },
    outputs: { antennaCore: 1 },
  },
  {
    id: 'assemble-antenna',
    inputs: {
      dishFrame: 1,
      antennaCore: 1,
      wire: 2,
      bolts: 2,
      nuts: 2,
      screws: 2,
    },
    power: { fud: 5, fomo: 5, alpha: 2, kek: 1 },
    outputs: { antennaRelay: 1 },
  },
];

/** @deprecated use FOUNDRY_ANTENNA_KITS */
export const FOUNDRY_SALVAGE_KITS = FOUNDRY_ANTENNA_KITS;

export function getFoundryVeinDefs() {
  return [
    FOUNDRY_CONFIG.yieldFields,
    FOUNDRY_CONFIG.ironVein,
    FOUNDRY_CONFIG.copperVein,
    FOUNDRY_CONFIG.aluminumVein,
    FOUNDRY_CONFIG.cobaltVein,
    FOUNDRY_CONFIG.methaneVent,
    FOUNDRY_CONFIG.noxiousVent,
  ];
}

export function getFoundryConfigResponse(): FoundryConfigResponse {
  const nodes = getFoundryVeinDefs().map((n) => ({
    id: n.id,
    x: n.x,
    y: n.y,
    veinType: n.veinType,
    remaining: n.remaining,
  }));
  return {
    enableParcelFoundryPoC: FOUNDRY_CONFIG.enableParcelFoundryPoC,
    antennaLinkRangePx: FOUNDRY_CONFIG.antennaLinkRangePx,
    maxAntennasPerPlayer: FOUNDRY_CONFIG.maxAntennasPerPlayer,
    gatherRangePx: FOUNDRY_CONFIG.gatherRangePx,
    factionTickMs: FOUNDRY_CONFIG.factionTickMs,
    antennaDamagePerTick: FOUNDRY_CONFIG.antennaDamagePerTick,
    nodes,
    wildNodes: nodes,
    wallReceivers: [
      {
        id: FOUNDRY_CONFIG.wallReceiverSouth.id,
        x: FOUNDRY_CONFIG.wallReceiverSouth.x,
        y: FOUNDRY_CONFIG.wallReceiverSouth.y,
      },
    ],
  };
}
