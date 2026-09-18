import dotenv from 'dotenv';

dotenv.config();

function csv(value: string | undefined, fallback: string[]): string[] {
  if (!value || !value.trim()) return fallback;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT || 2567),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: csv(process.env.CORS_ORIGINS, ['http://localhost:3001', 'http://127.0.0.1:3001']),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS || 86400),
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:2567').replace(/\/$/, ''),
  coreSubgraphUrl:
    process.env.CORE_SUBGRAPH_URL ||
    'https://aarcadeghst.com/api/subgraph/aavegotchi-core-base',
  gotchiverseSubgraphUrl:
    process.env.GOTCHIVERSE_SUBGRAPH_URL ||
    'https://aarcadeghst.com/api/subgraph/gotchiverse-base',
  skipOwnershipCheck: String(process.env.SKIP_OWNERSHIP_CHECK || 'true').toLowerCase() === 'true',
  /** Flip via COMBAT_IS_LIVE=true after AarenaRoom join is verified in prod. */
  combatIsLive: String(process.env.COMBAT_IS_LIVE || 'false').toLowerCase() === 'true',
  /** Aarcade cartridge-sim base (no trailing slash required). */
  aarcadeCartridgeSimUrl: (
    process.env.AARCADE_CARTRIDGE_SIM_URL || 'https://aarcadeghst.com/api/cartridge-sim'
  ).replace(/\/$/, ''),
  /** Shared secret for service pocket/credit from REALM KO prizes. */
  aarcadePocketCreditSecret: process.env.AARCADE_POCKET_CREDIT_SECRET || '',
  /** Aarcade aCartridge (Agent as Player) API base — agent auth + attested checkpoints. */
  aarcadeAcartridgeUrl: (
    process.env.AARCADE_ACARTRIDGE_URL || 'https://aarcadeghst.com/api/acartridge'
  ).replace(/\/$/, ''),
  /** Attestor key sent as x-aarcade-attestor-key; empty disables attestation (agents still play). */
  acartridgeAttestorSecret: process.env.ACARTRIDGE_ATTESTOR_SECRET || '',
  /** Cartridge gameId agents enter for this realm (Base network). */
  acartridgeGameId: process.env.ACARTRIDGE_GAME_ID || 'gotchiverse-base',
  /**
   * Chain mode: sign EIP-712 Checkpoints for the aCartridge diamond instead of the soft-sim
   * header-only attestation. Needs the attestor wallet key (registered via setAttestor) and
   * the diamond address; `abra keygen foundry` stores the key as EVM_PRIVATE_KEY.
   */
  acartridgeAttestorPrivateKey:
    process.env.ACARTRIDGE_ATTESTOR_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY || '',
  acartridgeDiamond: process.env.ACARTRIDGE_DIAMOND || '',
  acartridgeChainId: Number(process.env.ACARTRIDGE_CHAIN_ID || 84532),
  /** SIM NVDA units credited per KO (18-decimal integer string). Default 0.001 NVDA. */
  rhKoPrizeAmount: process.env.RH_KO_PRIZE_AMOUNT || '1000000000000000',
  /** Max KO pocket credits per wallet per UTC day. */
  rhKoMaxCreditsPerDay: Number(process.env.RH_KO_MAX_CREDITS_PER_DAY || 20),
  /** Min ms between KO credits for the same attacker→victim pair. */
  rhKoPairCooldownMs: Number(process.env.RH_KO_PAIR_COOLDOWN_MS || 60_000),
  /** When true, hotkey token-drop credits SIM NVDA pocket (aarena-rh testing). */
  rhTestDropEnabled: String(process.env.RH_TEST_DROP_ENABLED || 'false').toLowerCase() === 'true',
  /** SIM NVDA units credited per test drop (18-decimal). Default 0.001 NVDA. */
  rhTestDropAmount: process.env.RH_TEST_DROP_AMOUNT || process.env.RH_KO_PRIZE_AMOUNT || '1000000000000000',

  /**
   * RH weekly stock tournament (AarcadeGh-t docs/RH_TOURNEY.md). When enabled, aarena-rh runs
   * timed rounds and reports KOs / round results to Aarcade, which owns scoring + prizes.
   */
  rhTourneyEnabled: String(process.env.RH_TOURNEY_ENABLED || 'false').toLowerCase() === 'true',
  rhTourneyEventsUrl: process.env.RH_TOURNEY_EVENTS_URL || 'https://aarcadeghst.com/api/rh-tourney/events',
  rhTourneyEventSecret: process.env.RH_TOURNEY_EVENT_SECRET || '',
  /** Round length in minutes (wall-clock aligned). */
  rhRoundMinutes: Math.max(1, Number(process.env.RH_ROUND_MINUTES || 10)),
  /** Verify a joining human's cartridge/hero against cartridge-sim (fail-open on upstream errors). */
  rhTourneyVerifyCartridge: String(process.env.RH_TOURNEY_VERIFY_CARTRIDGE || 'false').toLowerCase() === 'true',
  /**
   * Legacy 0.001-NVDA-per-KO pocket drip. Explicit RH_KO_DRIP_ENABLED wins; otherwise the drip
   * stays on until the tournament is enabled (owner decision: tournament replaces the drip).
   */
  rhKoDripEnabled:
    process.env.RH_KO_DRIP_ENABLED != null
      ? String(process.env.RH_KO_DRIP_ENABLED).toLowerCase() === 'true'
      : String(process.env.RH_TOURNEY_ENABLED || 'false').toLowerCase() !== 'true',
};

/** +10 chunk / 660 tile pad around the original citaadel (matches FE CITAADEL_MAP_PAD_TILES). */
export const MAP_PAD_TILES = 660;

export const SPAWN = {
  // Freebie spawn in District 49 (C96): local x=1055, y=1055 → padded tiles.
  // C96 origin padded (9108, 5940) + local (1055, 1055) = (10163, 6995).
  minX: 10160 * 64,
  maxX: 10165 * 64,
  minY: 6992 * 64,
  maxY: 6997 * 64,
};

/** Full citaadel tilemap (164×116 chunks × 66 tiles × 64px) — D44–D49 + pads. */
export const CITAADEL_BOUNDS = {
  minX: 0,
  minY: 0,
  maxX: 164 * 66 * 64,
  maxY: 116 * 66 * 64,
};

/** Aarena map size + SPAWN_BOUNDS from shared_code/constants/const.game.ts */
const TILE = 64;
const AARENA_SIZE = 128 * TILE;
export const AARENA_BOUNDS = {
  minX: 0,
  minY: 0,
  maxX: AARENA_SIZE,
  maxY: AARENA_SIZE,
};
export const AARENA_SPAWN = {
  minX: TILE + 800,
  maxX: AARENA_SIZE - TILE - 800,
  minY: TILE + 800,
  maxY: AARENA_SIZE - TILE - 800,
};

export const MOVE = {
  maxStepPx: 48,
  maxSpeedPxPerSec: 400,
};
