/**
 * Soft-launch aarena leaderboard — process-local stats keyed by gotchiId.
 * Survives room churn; resets on REALM process restart (fine for MVP).
 */

export type LeaderboardRow = {
  id: string;
  name: string;
  address: string;
  kills: number;
  deaths: number;
  hits: number;
  hitsReceived: number;
  damageDealt: number;
  damageTaken: number;
  killStreak: number;
  bestKillStreak: number;
  lastHitTime: number;
  lastDeathTime: number;
  /** Accumulated seconds across sessions. */
  sessionTime: number;
  alchemicaPickedUp: number;
  alchemicaDropped: number;
  tips: { FUD: number; FOMO: number; ALPHA: number; KEK: number };
  tipsSent: number;
  tipsValueSent: number;
  /** Live session start (ms) while online; 0 when offline. */
  sessionStartedAt: number;
};

type SortKey =
  | 'kills'
  | 'deaths'
  | 'hits'
  | 'killStreak'
  | 'killDeathRatio'
  | 'sessionTime'
  | 'damageDealt'
  | 'alchemicaPickedUp'
  | 'tipsValueSent'
  | 'playerId'
  | 'name'
  | 'rank';

const byGotchi = new Map<string, LeaderboardRow>();

function emptyRow(gotchiId: string): LeaderboardRow {
  return {
    id: String(gotchiId),
    name: `Gotchi #${gotchiId}`,
    address: '',
    kills: 0,
    deaths: 0,
    hits: 0,
    hitsReceived: 0,
    damageDealt: 0,
    damageTaken: 0,
    killStreak: 0,
    bestKillStreak: 0,
    lastHitTime: 0,
    lastDeathTime: 0,
    sessionTime: 0,
    alchemicaPickedUp: 0,
    alchemicaDropped: 0,
    tips: { FUD: 0, FOMO: 0, ALPHA: 0, KEK: 0 },
    tipsSent: 0,
    tipsValueSent: 0,
    sessionStartedAt: 0,
  };
}

function ensure(gotchiId: string): LeaderboardRow {
  const id = String(gotchiId || '').trim();
  if (!id) return emptyRow('');
  let row = byGotchi.get(id);
  if (!row) {
    row = emptyRow(id);
    byGotchi.set(id, row);
  }
  return row;
}

/** Upsert identity + open a session clock on aarena join. */
export function leaderboardOnJoin(opts: {
  gotchiId: string;
  name?: string;
  address?: string;
}): void {
  const row = ensure(opts.gotchiId);
  if (!row.id) return;
  if (opts.name) row.name = String(opts.name);
  if (opts.address) row.address = String(opts.address).toLowerCase();
  if (!row.sessionStartedAt) row.sessionStartedAt = Date.now();
}

/** Point-in-time copy of a row (agent session deltas); null when unseen. */
export function leaderboardSnapshot(gotchiId: string): LeaderboardRow | null {
  const row = byGotchi.get(String(gotchiId || ''));
  return row ? { ...row, tips: { ...row.tips } } : null;
}

/** Close session clock and roll seconds into sessionTime. */
export function leaderboardOnLeave(gotchiId: string): void {
  const row = byGotchi.get(String(gotchiId || ''));
  if (!row || !row.sessionStartedAt) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - row.sessionStartedAt) / 1000));
  row.sessionTime += elapsed;
  row.sessionStartedAt = 0;
}

export function leaderboardRecordHit(opts: {
  attackerGotchiId: string;
  victimGotchiId: string;
  damage: number;
  attackerName?: string;
  victimName?: string;
  attackerAddress?: string;
  victimAddress?: string;
}): void {
  const atk = ensure(opts.attackerGotchiId);
  const vic = ensure(opts.victimGotchiId);
  if (!atk.id || !vic.id || atk.id === vic.id) return;
  if (opts.attackerName) atk.name = opts.attackerName;
  if (opts.victimName) vic.name = opts.victimName;
  if (opts.attackerAddress) atk.address = opts.attackerAddress.toLowerCase();
  if (opts.victimAddress) vic.address = opts.victimAddress.toLowerCase();

  const dmg = Math.max(0, Math.round(Number(opts.damage) || 0));
  const now = Date.now();
  atk.hits += 1;
  atk.damageDealt += dmg;
  atk.lastHitTime = now;
  vic.hitsReceived += 1;
  vic.damageTaken += dmg;
}

export function leaderboardRecordKo(opts: {
  attackerGotchiId: string;
  victimGotchiId: string;
  attackerName?: string;
  victimName?: string;
  attackerAddress?: string;
  victimAddress?: string;
}): void {
  const atk = ensure(opts.attackerGotchiId);
  const vic = ensure(opts.victimGotchiId);
  if (!atk.id || !vic.id || atk.id === vic.id) return;
  if (opts.attackerName) atk.name = opts.attackerName;
  if (opts.victimName) vic.name = opts.victimName;
  if (opts.attackerAddress) atk.address = opts.attackerAddress.toLowerCase();
  if (opts.victimAddress) vic.address = opts.victimAddress.toLowerCase();

  const now = Date.now();
  atk.kills += 1;
  atk.killStreak += 1;
  if (atk.killStreak > atk.bestKillStreak) atk.bestKillStreak = atk.killStreak;

  vic.deaths += 1;
  vic.killStreak = 0;
  vic.lastDeathTime = now;
}

function liveSessionSeconds(row: LeaderboardRow): number {
  const live =
    row.sessionStartedAt > 0 ? Math.max(0, Math.floor((Date.now() - row.sessionStartedAt) / 1000)) : 0;
  return row.sessionTime + live;
}

function killDeathRatio(row: LeaderboardRow): number {
  const d = Math.max(1, row.deaths);
  return row.kills / d;
}

export type PublicLeaderboardEntry = {
  rank: number;
  id: string | number;
  name: string;
  address: string;
  kills: number;
  deaths: number;
  hits: number;
  lastDeathTime: number;
  lastHitTime: number;
  sessionTime: number;
  killDeathRatio: number;
  killStreak: number;
  bestKillStreak: number;
  damageDealt: number;
  alchemicaPickedUp: number;
  alchemicaDropped: number;
  destructiblesHit: number;
  destructiblesKilled: number;
  tips: { FUD: number; FOMO: number; ALPHA: number; KEK: number };
  tipsAverage: number;
  tipsSent: number;
  tipsValueSent: number;
};

function toPublic(row: LeaderboardRow, rank: number): PublicLeaderboardEntry {
  const tipsSum = row.tips.FUD + row.tips.FOMO + row.tips.ALPHA + row.tips.KEK;
  const numericId = /^\d+$/.test(row.id) ? Number(row.id) : row.id;
  return {
    rank,
    id: numericId,
    name: row.name,
    address: row.address,
    kills: row.kills,
    deaths: row.deaths,
    hits: row.hits,
    lastDeathTime: row.lastDeathTime,
    lastHitTime: row.lastHitTime,
    sessionTime: liveSessionSeconds(row),
    killDeathRatio: killDeathRatio(row),
    killStreak: row.killStreak,
    bestKillStreak: row.bestKillStreak,
    damageDealt: row.damageDealt,
    alchemicaPickedUp: row.alchemicaPickedUp,
    alchemicaDropped: row.alchemicaDropped,
    destructiblesHit: 0,
    destructiblesKilled: 0,
    tips: { ...row.tips },
    tipsAverage: tipsSum / 4,
    tipsSent: row.tipsSent,
    tipsValueSent: row.tipsValueSent,
  };
}

function sortValue(row: LeaderboardRow, key: SortKey): number | string {
  switch (key) {
    case 'deaths':
      return row.deaths;
    case 'hits':
      return row.hits;
    case 'killStreak':
      return row.bestKillStreak || row.killStreak;
    case 'killDeathRatio':
      return killDeathRatio(row);
    case 'sessionTime':
      return liveSessionSeconds(row);
    case 'damageDealt':
      return row.damageDealt;
    case 'alchemicaPickedUp':
      return row.alchemicaPickedUp - row.alchemicaDropped;
    case 'tipsValueSent':
      return row.tipsValueSent;
    case 'playerId':
      return /^\d+$/.test(row.id) ? Number(row.id) : row.id;
    case 'name':
      return (row.name || '').toLowerCase();
    case 'rank':
    case 'kills':
    default:
      return row.kills;
  }
}

export function queryLeaderboard(opts: {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortType?: string;
  filterBy?: string;
  gotchiId?: string;
}): {
  leaderboard: PublicLeaderboardEntry[];
  player: PublicLeaderboardEntry | null;
  total: number;
} {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 10));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const sortBy = (opts.sortBy || 'kills') as SortKey;
  const sortType = String(opts.sortType || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const filter = String(opts.filterBy || '').trim().toLowerCase();
  const gotchiId = opts.gotchiId ? String(opts.gotchiId) : '';

  let rows = Array.from(byGotchi.values()).filter((r) => r.id);
  if (filter) {
    rows = rows.filter(
      (r) =>
        r.id.toLowerCase().includes(filter) ||
        (r.name || '').toLowerCase().includes(filter) ||
        (r.address || '').toLowerCase().includes(filter),
    );
  }

  rows.sort((a, b) => {
    const av = sortValue(a, sortBy);
    const bv = sortValue(b, sortBy);
    if (typeof av === 'string' || typeof bv === 'string') {
      const cmp = String(av).localeCompare(String(bv));
      return sortType === 'asc' ? cmp : -cmp;
    }
    if (av === bv) {
      // Tie-break: more kills, then fewer deaths.
      if (a.kills !== b.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    }
    return sortType === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av);
  });

  // Rank by default kills desc so rank is stable even when viewing other sorts.
  const rankOrder = Array.from(byGotchi.values())
    .filter((r) => r.id)
    .sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    });
  const rankMap = new Map<string, number>();
  rankOrder.forEach((r, i) => rankMap.set(r.id, i + 1));

  const page = rows.slice(offset, offset + limit);
  const leaderboard = page.map((r) => toPublic(r, rankMap.get(r.id) || 0));

  let player: PublicLeaderboardEntry | null = null;
  if (gotchiId) {
    const existing = byGotchi.get(gotchiId);
    if (existing) {
      player = toPublic(existing, rankMap.get(existing.id) || rankOrder.length + 1);
    } else {
      // Ephemeral zero row for HUD — do not pollute the store.
      player = toPublic(emptyRow(gotchiId), rankOrder.length + 1);
    }
  }

  return { leaderboard, player, total: rows.length };
}

/** Test / admin helper */
export function leaderboardClear(): void {
  byGotchi.clear();
}
