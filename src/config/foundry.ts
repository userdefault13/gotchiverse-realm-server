/**
 * Hybrid Grid Foundry PoC constants.
 * Coordinates are approximate citaadel map pixels aligned with gotchiverse-2d plan.
 */
export const FOUNDRY_CONFIG = {
  enableParcelFoundryPoC: true,
  antennaLinkRangePx: 8000,
  maxAntennasPerPlayer: 3,
  gatherRangePx: 2000,
  factionTickMs: 5000,
  antennaDamagePerTick: 5,

  /** Yield Fields — richer alchemica vein */
  yieldFields: {
    id: 'yield-fields',
    x: 320000,
    y: 140000,
    veinType: 'yield' as const,
    remaining: 10000,
  },

  /** DeFi Desert — salvage vein */
  defiDesert: {
    id: 'defi-desert',
    x: 180000,
    y: 120000,
    veinType: 'desert_salvage' as const,
    remaining: 10000,
  },

  /** South beach / west gate rim — tithe deposit receiver */
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
  nodes: Array<{ id: string; x: number; y: number; veinType: string }>;
  wallReceivers: Array<{ id: string; x: number; y: number }>;
};

export function getFoundryConfigResponse(): FoundryConfigResponse {
  return {
    enableParcelFoundryPoC: FOUNDRY_CONFIG.enableParcelFoundryPoC,
    antennaLinkRangePx: FOUNDRY_CONFIG.antennaLinkRangePx,
    maxAntennasPerPlayer: FOUNDRY_CONFIG.maxAntennasPerPlayer,
    gatherRangePx: FOUNDRY_CONFIG.gatherRangePx,
    factionTickMs: FOUNDRY_CONFIG.factionTickMs,
    antennaDamagePerTick: FOUNDRY_CONFIG.antennaDamagePerTick,
    nodes: [
      {
        id: FOUNDRY_CONFIG.yieldFields.id,
        x: FOUNDRY_CONFIG.yieldFields.x,
        y: FOUNDRY_CONFIG.yieldFields.y,
        veinType: FOUNDRY_CONFIG.yieldFields.veinType,
      },
      {
        id: FOUNDRY_CONFIG.defiDesert.id,
        x: FOUNDRY_CONFIG.defiDesert.x,
        y: FOUNDRY_CONFIG.defiDesert.y,
        veinType: FOUNDRY_CONFIG.defiDesert.veinType,
      },
    ],
    wallReceivers: [
      {
        id: FOUNDRY_CONFIG.wallReceiverSouth.id,
        x: FOUNDRY_CONFIG.wallReceiverSouth.x,
        y: FOUNDRY_CONFIG.wallReceiverSouth.y,
      },
    ],
  };
}
