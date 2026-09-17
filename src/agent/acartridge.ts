/**
 * aCartridge (Agent as Player) client — Aarcade API + attestation.
 * See AarcadeGh-t docs/ACARTRIDGE_DIAMOND_PLAN.md (Phase 0b / Phase 2).
 *
 * Two calls only:
 *   - resolveAgentForSigner: which agent may a signing wallet play as (owner or controller)
 *   - attestCheckpoint:      sign off a finished session so it earns reputation
 *
 * Attestation has two modes, picked from env:
 *   soft  — no attestor key: POST with x-aarcade-attestor-key; the SIM credits rep itself.
 *   chain — ACARTRIDGE_DIAMOND + attestor key: sign the diamond's EIP-712 Checkpoint and
 *           POST payload + signature; the agent later submits attestCheckpoint on-chain.
 * Both are best-effort and never throw; a missing secret disables attestation.
 */
import { Wallet, encodeBytes32String } from 'ethers';
import { env } from '../config/env';

export type AgentGameSlot = { cartridgeId: string; heroId: string | null; enteredAt: string | null };

export type AgentRecord = {
  agentId: string;
  tokenId: number;
  owner: string;
  account: string;
  mode?: 'soft' | 'chain';
  games: Record<string, AgentGameSlot>;
  reputation: number;
};

export type ResolvedAgent = {
  agentId: string;
  tokenId: number;
  account: string;
  owner: string;
  cartridgeId: string;
  heroId: string;
  mode: 'soft' | 'chain';
};

function baseUrl(): string {
  return env.aarcadeAcartridgeUrl.replace(/\/$/, '');
}

export function isChainAttestation(): boolean {
  return Boolean(env.acartridgeAttestorPrivateKey && env.acartridgeDiamond);
}

/**
 * Pick the agent a wallet is allowed to play for in `gameId`. With `agentId` the
 * caller names one; otherwise the first eligible agent wins. Null when none.
 * Soft agents need a bound hero; on-chain agents may play as their cartridge
 * (`cart-<id>`) since binding a starter on-chain costs ETH.
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
    if (!agent || !slot?.cartridgeId) return null;
    const mode = agent.mode === 'chain' ? 'chain' : 'soft';
    const heroId = slot.heroId || (mode === 'chain' ? `cart-${slot.cartridgeId}` : '');
    if (!heroId) return null;
    return {
      agentId: agent.agentId,
      tokenId: Number(agent.tokenId),
      account: agent.account,
      owner: agent.owner,
      cartridgeId: slot.cartridgeId,
      heroId,
      mode,
    };
  } catch (err) {
    console.warn('[acartridge] by-signer error', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export type AttestInput = {
  agentId: string;
  tokenId?: number;
  cartridgeId?: string;
  gameId?: string;
  nonce: number;
  stateHash: string;
  stateUri?: string;
  score: number;
  world?: { zone?: string; koWins?: number; koLosses?: number };
};

export type AttestResult = { ok: true; skipped?: boolean; reason?: string } | { ok: false; error: string };

/** Must match AttestationFacet.checkpointDigest on the aCartridge diamond. */
export function checkpointTypedData(input: Required<Pick<AttestInput, 'tokenId' | 'cartridgeId'>> & AttestInput) {
  const gameId = input.gameId || env.acartridgeGameId;
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const zone = encodeBytes32String(String(input.world?.zone || '').slice(0, 31));
  return {
    domain: {
      name: 'AarcadeACartridge',
      version: '1',
      chainId: env.acartridgeChainId,
      verifyingContract: env.acartridgeDiamond,
    },
    types: {
      Checkpoint: [
        { name: 'tokenId', type: 'uint256' },
        { name: 'gameId', type: 'bytes32' },
        { name: 'cartridgeId', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'stateHash', type: 'bytes32' },
        { name: 'score', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'zone', type: 'bytes32' },
        { name: 'koWins', type: 'uint32' },
        { name: 'koLosses', type: 'uint32' },
      ],
    },
    value: {
      tokenId: BigInt(input.tokenId),
      gameId: gameIdHash(gameId),
      cartridgeId: BigInt(input.cartridgeId),
      nonce: BigInt(input.nonce),
      stateHash: input.stateHash,
      score: BigInt(Math.max(0, Math.floor(input.score))),
      deadline: BigInt(deadline),
      zone,
      koWins: Math.max(0, Number(input.world?.koWins) || 0),
      koLosses: Math.max(0, Number(input.world?.koLosses) || 0),
    },
    deadline,
    zone,
  };
}

function gameIdHash(gameId: string): string {
  // keccak256(utf8) — same as cast keccak / LibACartridge gameIdToBytes32
  const { keccak256, toUtf8Bytes } = require('ethers') as typeof import('ethers');
  return keccak256(toUtf8Bytes(gameId.trim().toLowerCase()));
}

/** POST an attested checkpoint. Only attested checkpoints earn reputation. */
export async function attestCheckpoint(input: AttestInput): Promise<AttestResult> {
  if (!env.acartridgeAttestorSecret) {
    return { ok: true, skipped: true, reason: 'no_attestor_secret' };
  }
  const gameId = input.gameId || env.acartridgeGameId;
  const body: Record<string, unknown> = {
    gameId,
    nonce: input.nonce,
    stateHash: input.stateHash,
    stateUri: input.stateUri || '',
    score: input.score,
    world: input.world,
  };

  if (isChainAttestation()) {
    if (input.tokenId == null || !input.cartridgeId) {
      return { ok: false, error: 'chain attestation needs tokenId + cartridgeId' };
    }
    try {
      const wallet = new Wallet(env.acartridgeAttestorPrivateKey);
      const td = checkpointTypedData({ ...input, tokenId: input.tokenId, cartridgeId: input.cartridgeId });
      body.signature = await wallet.signTypedData(td.domain, td.types, td.value);
      body.deadline = td.deadline;
      body.zone = td.zone;
      body.koWins = td.value.koWins;
      body.koLosses = td.value.koLosses;
      body.attestor = wallet.address;
    } catch (err) {
      return { ok: false, error: `sign_failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const url = `${baseUrl()}/agents/${encodeURIComponent(input.agentId)}/checkpoint`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aarcade-attestor-key': env.acartridgeAttestorSecret,
      },
      body: JSON.stringify(body),
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
