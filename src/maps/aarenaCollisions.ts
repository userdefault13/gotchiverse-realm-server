import blocksJSON from '../data/aarena/blocks.json';
import hazardBlocksJSON from '../data/aarena/hazardBlocks.json';
import { AARENA_BOUNDS, AARENA_SPAWN } from '../config/env';

type Rect = { left: number; top: number; right: number; bottom: number };

type CollisionBlock = {
  type?: string;
  position?: { x?: number; y?: number };
  dimensions?: { width?: number; height?: number };
};

const TILE = 64;
/** Matches FE GOTCHI_SIZE for spawn/move footprint. */
const GOTCHI_W = 48;
const GOTCHI_H = 48;

function tileBlockToRect(block: CollisionBlock): Rect | null {
  const x = Number(block?.position?.x);
  const y = Number(block?.position?.y);
  const w = Number(block?.dimensions?.width);
  const h = Number(block?.dimensions?.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;

  const inset = 2;
  const px = x * TILE;
  const py = y * TILE;
  const width = w * TILE;
  const height = h * TILE;
  return {
    left: px + inset,
    top: py + inset,
    right: px + width - inset,
    bottom: py + height - inset,
  };
}

let blockersCache: Rect[] | null = null;

function blockers(): Rect[] {
  if (blockersCache) return blockersCache;
  const sources = [
    ...(Array.isArray(blocksJSON) ? blocksJSON : []),
    ...(Array.isArray(hazardBlocksJSON) ? hazardBlocksJSON : []),
  ] as CollisionBlock[];
  blockersCache = sources.map(tileBlockToRect).filter((r): r is Rect => Boolean(r));
  return blockersCache;
}

function playerRect(x: number, y: number): Rect {
  const halfW = GOTCHI_W / 2;
  const halfH = GOTCHI_H / 2;
  return {
    left: x - halfW,
    top: y - halfH,
    right: x + halfW,
    bottom: y + halfH,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function isAarenaBlocked(x: number, y: number): boolean {
  const player = playerRect(x, y);
  return blockers().some((b) => overlaps(player, b));
}

export function clampAarenaMap(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(Math.min(AARENA_BOUNDS.maxX, Math.max(AARENA_BOUNDS.minX, x))),
    y: Math.round(Math.min(AARENA_BOUNDS.maxY, Math.max(AARENA_BOUNDS.minY, y))),
  };
}

/**
 * Resolve a step against aarena solids with axis sliding (same idea as FE).
 */
export function resolveAarenaMove(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number; blocked: boolean } {
  const dest = clampAarenaMap(toX, toY);
  const from = clampAarenaMap(fromX, fromY);

  if (isAarenaBlocked(from.x, from.y)) {
    // Allow escaping a bad spawn.
    if (!isAarenaBlocked(dest.x, dest.y)) return { x: dest.x, y: dest.y, blocked: false };
    if (!isAarenaBlocked(dest.x, from.y)) return { x: dest.x, y: from.y, blocked: false };
    if (!isAarenaBlocked(from.x, dest.y)) return { x: from.x, y: dest.y, blocked: false };
    return { x: from.x, y: from.y, blocked: true };
  }

  if (!isAarenaBlocked(dest.x, dest.y)) return { x: dest.x, y: dest.y, blocked: false };

  const canX = !isAarenaBlocked(dest.x, from.y);
  const canY = !isAarenaBlocked(from.x, dest.y);
  if (canX && !canY) return { x: dest.x, y: from.y, blocked: false };
  if (canY && !canX) return { x: from.x, y: dest.y, blocked: false };
  if (canX && canY) {
    if (Math.abs(dest.x - from.x) >= Math.abs(dest.y - from.y)) {
      return { x: dest.x, y: from.y, blocked: false };
    }
    return { x: from.x, y: dest.y, blocked: false };
  }
  return { x: from.x, y: from.y, blocked: true };
}

/** Random spawn inside SPAWN_BOUNDS that does not overlap walls/hazard blocks. */
export function randomAarenaSpawn(maxAttempts = 80): { x: number; y: number } {
  for (let i = 0; i < maxAttempts; i += 1) {
    const x = AARENA_SPAWN.minX + Math.random() * (AARENA_SPAWN.maxX - AARENA_SPAWN.minX);
    const y = AARENA_SPAWN.minY + Math.random() * (AARENA_SPAWN.maxY - AARENA_SPAWN.minY);
    const candidate = { x: Math.round(x), y: Math.round(y) };
    if (!isAarenaBlocked(candidate.x, candidate.y)) return candidate;
  }

  // Spiral search from spawn-band center.
  const cx = Math.round((AARENA_SPAWN.minX + AARENA_SPAWN.maxX) / 2);
  const cy = Math.round((AARENA_SPAWN.minY + AARENA_SPAWN.maxY) / 2);
  for (let ring = 1; ring <= 40; ring += 1) {
    for (let ox = -ring; ox <= ring; ox += 1) {
      for (const oy of [-ring, ring]) {
        const x = cx + ox * TILE;
        const y = cy + oy * TILE;
        if (
          x >= AARENA_SPAWN.minX &&
          x <= AARENA_SPAWN.maxX &&
          y >= AARENA_SPAWN.minY &&
          y <= AARENA_SPAWN.maxY &&
          !isAarenaBlocked(x, y)
        ) {
          return { x, y };
        }
      }
    }
    for (let oy = -ring + 1; oy <= ring - 1; oy += 1) {
      for (const ox of [-ring, ring]) {
        const x = cx + ox * TILE;
        const y = cy + oy * TILE;
        if (
          x >= AARENA_SPAWN.minX &&
          x <= AARENA_SPAWN.maxX &&
          y >= AARENA_SPAWN.minY &&
          y <= AARENA_SPAWN.maxY &&
          !isAarenaBlocked(x, y)
        ) {
          return { x, y };
        }
      }
    }
  }

  return { x: cx, y: cy };
}
