/**
 * Agent session bookkeeping — turns a room visit into one attested checkpoint.
 *
 * Rooms call agentSessionStart on join and agentSessionEnd on leave for players
 * whose auth claims carry an agentId. The session score is derived from the
 * leaderboard row delta so it cannot be inflated by the client.
 */
import { createHash } from 'node:crypto';
import { attestCheckpoint } from './acartridge';
import { leaderboardSnapshot, type LeaderboardRow } from '../leaderboard/store';

export type AgentSession = {
  agentId: string;
  cartridgeId: string;
  gotchiId: string;
  zone: string;
  startedAt: number;
  start: LeaderboardRow | null;
};

/** `acart-12` → 12 (on-chain tokenId); null for anything else. */
export function tokenIdFromAgentId(agentId: string): number | null {
  const m = String(agentId || '').match(/^acart-(\d+)$/i);
  return m ? Number(m[1]) : null;
}

export type SessionDelta = {
  kills: number;
  deaths: number;
  hits: number;
  damageDealt: number;
  alchemicaPickedUp: number;
  seconds: number;
};

const bySession = new Map<string, AgentSession>();

export function sessionDelta(start: LeaderboardRow | null, end: LeaderboardRow | null, seconds: number): SessionDelta {
  const d = (k: keyof LeaderboardRow) => Math.max(0, Number(end?.[k] ?? 0) - Number(start?.[k] ?? 0));
  return {
    kills: d('kills'),
    deaths: d('deaths'),
    hits: d('hits'),
    damageDealt: d('damageDealt'),
    alchemicaPickedUp: d('alchemicaPickedUp'),
    seconds: Math.max(0, Math.floor(seconds)),
  };
}

/**
 * Session score: KOs dominate, then damage and hits, plus one point per started
 * minute played so any real visit (even a short peaceful one) counts for at
 * least 1. Kept simple on purpose — the diamond stores bestScore per game, not
 * this formula.
 */
export function scoreSession(delta: SessionDelta): number {
  return (
    delta.kills * 100 +
    Math.floor(delta.damageDealt / 10) +
    delta.hits +
    delta.alchemicaPickedUp +
    (delta.seconds > 0 ? Math.ceil(delta.seconds / 60) : 0)
  );
}

export function agentSessionStart(sessionId: string, input: Omit<AgentSession, 'startedAt' | 'start'>): void {
  bySession.set(sessionId, {
    ...input,
    startedAt: Date.now(),
    start: leaderboardSnapshot(input.gotchiId),
  });
}

/** Fire-and-forget: attests the finished session. Safe to call for non-agents. */
export function agentSessionEnd(sessionId: string): void {
  const s = bySession.get(sessionId);
  if (!s) return;
  bySession.delete(sessionId);
  const now = Date.now();
  const delta = sessionDelta(s.start, leaderboardSnapshot(s.gotchiId), (now - s.startedAt) / 1000);
  const score = scoreSession(delta);
  const summary = { agentId: s.agentId, cartridgeId: s.cartridgeId, zone: s.zone, delta, at: now };
  const stateHash = `0x${createHash('sha256').update(JSON.stringify(summary)).digest('hex')}`;
  void attestCheckpoint({
    agentId: s.agentId,
    tokenId: tokenIdFromAgentId(s.agentId) ?? undefined,
    cartridgeId: s.cartridgeId || undefined,
    nonce: now,
    stateHash,
    score,
    world: { zone: s.zone, koWins: delta.kills, koLosses: delta.deaths },
  }).then((r) => {
    if (r.ok && !r.skipped) console.log(`[acartridge] attested ${s.agentId} ${s.zone} score=${score}`);
  });
}
