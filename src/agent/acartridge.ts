/**
 * aCartridge (Agent as Player) client — Aarcade soft-sim API.
 * See AarcadeGh-t docs/ACARTRIDGE_DIAMOND_PLAN.md (Phase 0b).
 *
 * Two calls only:
 *   - resolveAgentForSigner: which agent may a signing wallet play as (owner or controller)
 *   - attestCheckpoint:      sign off a finished session so it earns reputation
 * Both are best-effort and never throw; a missing secret disables attestation.
 */
import { env } from '../config/env';

export type AgentGameSlot = { cartridgeId: string; heroId: string | null; enteredAt: string };

export type AgentRecord = {
  agentId: string;
  tokenId: number;
  owner: string;
  account: string;
  games: Record<string, AgentGameSlot>;
  reputation: number;
};

export type ResolvedAgent = {
  agentId: string;
  account: string;
  owner: string;
  cartridgeId: string;
  heroId: string;
};

function baseUrl(): string {
  return env.aarcadeAcartridgeUrl.replace(/\/$/, '');
}

/**
 * Pick the agent a wallet is allowed to play for in `gameId`. With `agentId` the
 * caller names one; otherwise the first eligible agent wins. Null when none.
 */
export async function resolveAgentForSigner(
  address: string,
  opts: { agentId?: string; gameId?: string } = {},
): Promise<ResolvedAgent | null> {
  const gameId = opts.gameId || env.acartridgeGameId;
  const url = `${baseUrl()}/agents/by-signer/${encodeURIComponent(address.toLowerCase())}?gameId=${encodeURIComponent(gameId)}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      console.warn('[acartridge] by-signer failed', res.status);
      return null;
    }
    const json = (await res.json()) as { agents?: AgentRecord[] };
    const agents = Array.isArray(json.agents) ? json.agents : [];
    const wanted = opts.agentId ? String(opts.agentId).toLowerCase() : '';
    const agent = wanted ? agents.find((a) => a.agentId.toLowerCase() === wanted) : agents[0];
    const slot = agent?.games?.[gameId];
    if (!agent || !slot?.cartridgeId || !slot.heroId) return null;
    return {
      agentId: agent.agentId,
      account: agent.account,
      owner: agent.owner,
      cartridgeId: slot.cartridgeId,
      heroId: slot.heroId,
    };
  } catch (err) {
    console.warn('[acartridge] by-signer error', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export type AttestInput = {
  agentId: string;
  gameId?: string;
  nonce: number;
  stateHash: string;
  stateUri?: string;
  score: number;
  world?: { zone?: string; koWins?: number; koLosses?: number };
};

export type AttestResult = { ok: true; skipped?: boolean; reason?: string } | { ok: false; error: string };

/** POST an attested checkpoint. Only attested checkpoints earn reputation on the SIM. */
export async function attestCheckpoint(input: AttestInput): Promise<AttestResult> {
  if (!env.acartridgeAttestorSecret) {
    return { ok: true, skipped: true, reason: 'no_attestor_secret' };
  }
  const url = `${baseUrl()}/agents/${encodeURIComponent(input.agentId)}/checkpoint`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aarcade-attestor-key': env.acartridgeAttestorSecret,
      },
      body: JSON.stringify({
        gameId: input.gameId || env.acartridgeGameId,
        nonce: input.nonce,
        stateHash: input.stateHash,
        stateUri: input.stateUri || '',
        score: input.score,
        world: input.world,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[acartridge] attest failed', res.status, text.slice(0, 200));
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[acartridge] attest error', message);
    return { ok: false, error: message };
  }
}
