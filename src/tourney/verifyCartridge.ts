/**
 * RH weekly stock tournament — verify a joining human's cartridge + hero against cartridge-sim.
 *
 * Aarcade re-validates every event, so this is a UX gate: a player who claims a cartridge that
 * is not theirs, or a retired hero, is told at join time instead of silently earning nothing.
 * Players who join without a cartridgeId are allowed in (they cannot earn tournament score).
 */
import { env } from '../config/env';

type HeroLite = { id?: string; sourceTokenId?: string | number; collateral?: string; retired?: unknown };
type CartridgeLite = {
  cartridgeId?: string;
  gameId?: string;
  owner?: string;
  cAavegotchis?: HeroLite[];
  retiredHeroes?: HeroLite[];
};

export type CartridgeCheck =
  | { ok: true; collateral: string | null; heroId: string }
  | { ok: false; reason: string };

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; snap: CartridgeLite | null }>();

async function fetchCartridge(cartridgeId: string): Promise<CartridgeLite | null> {
  const hit = cache.get(cartridgeId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.snap;
  const base = env.aarcadeCartridgeSimUrl.replace(/\/$/, '');
  let snap: CartridgeLite | null = null;
  try {
    const res = await fetch(`${base}/cartridges/${encodeURIComponent(cartridgeId)}`, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const body = (await res.json()) as { data?: CartridgeLite } | CartridgeLite;
      snap = ((body as { data?: CartridgeLite }).data ?? body) as CartridgeLite;
    } else if (res.status !== 404) {
      // transient upstream trouble — don't cache, don't block
      return null;
    }
  } catch {
    return null;
  }
  cache.set(cartridgeId, { at: Date.now(), snap });
  return snap;
}

export function checkCartridgeSnapshot(snap: CartridgeLite | null, address: string, gotchiId: string): CartridgeCheck {
  if (!snap) return { ok: false, reason: 'cartridge_not_found' };
  const gid = String(snap.gameId || '').toLowerCase();
  if (gid !== 'gotchiverse-rh' && gid !== 'gotchiverse') return { ok: false, reason: 'not_rh_track' };
  if (String(snap.owner || '').toLowerCase() !== String(address || '').toLowerCase()) return { ok: false, reason: 'cartridge_not_owned' };
  const want = String(gotchiId || '').trim();
  const match = (h: HeroLite) => h && (String(h.id) === want || String(h.sourceTokenId) === want);
  const hero = (snap.cAavegotchis || []).find(match);
  if (hero) return { ok: true, collateral: hero.collateral ? String(hero.collateral).toLowerCase() : null, heroId: String(hero.id || want) };
  if ((snap.retiredHeroes || []).some((h) => match(h) || String((h.retired as { originalId?: string })?.originalId || '') === want)) {
    return { ok: false, reason: 'hero_retired' };
  }
  return { ok: false, reason: 'hero_not_on_roster' };
}

/**
 * @returns ok when verification is off, the player has no cartridge, or cartridge-sim is unreachable
 *   (fail-open — Aarcade still gates every event server-side).
 */
export async function verifyRhCartridge(address: string, gotchiId: string, cartridgeId: string): Promise<CartridgeCheck> {
  if (!env.rhTourneyVerifyCartridge || !cartridgeId) return { ok: true, collateral: null, heroId: gotchiId };
  const snap = await fetchCartridge(cartridgeId);
  if (snap === null && !cache.has(cartridgeId)) return { ok: true, collateral: null, heroId: gotchiId };
  return checkCartridgeSnapshot(snap, address, gotchiId);
}
