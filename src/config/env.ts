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
    'https://api.goldsky.com/api/public/project_cmh3flagm0001r4p25foufjtt/subgraphs/aavegotchi-core-base/prod/gn',
  gotchiverseSubgraphUrl:
    process.env.GOTCHIVERSE_SUBGRAPH_URL ||
    'https://api.goldsky.com/api/public/project_cmh3flagm0001r4p25foufjtt/subgraphs/gotchiverse-base/prod/gn',
  skipOwnershipCheck: String(process.env.SKIP_OWNERSHIP_CHECK || 'true').toLowerCase() === 'true',
  /** Flip via COMBAT_IS_LIVE=true after AarenaRoom join is verified in prod. */
  combatIsLive: String(process.env.COMBAT_IS_LIVE || 'false').toLowerCase() === 'true',
};

export const SPAWN = {
  // Approximate citaadel spawn band (pixels), from shared_code map constants
  minX: 42 * 64,
  maxX: 42 * 64 + 20 * 64,
  minY: 52 * 64,
  maxY: 52 * 64 + 20 * 64,
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
