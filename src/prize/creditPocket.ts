import { env } from '../config/env';

export type PocketCreditInput = {
  cartridgeId: string;
  amount: string;
  refId: string;
  reason?: string;
  token?: string;
};

export type PocketCreditResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

/** Credit SIM cartridge pocket via Aarcade service endpoint. Never throws. */
export async function creditCartridgePocket(input: PocketCreditInput): Promise<PocketCreditResult> {
  const cartridgeId = String(input.cartridgeId || '').trim();
  if (!cartridgeId) {
    return { ok: true, skipped: true, reason: 'no_cartridge' };
  }
  if (!env.aarcadePocketCreditSecret) {
    console.warn('[prize] AARCADE_POCKET_CREDIT_SECRET unset — skip credit');
    return { ok: true, skipped: true, reason: 'secret_unset' };
  }

  const base = env.aarcadeCartridgeSimUrl.replace(/\/$/, '');
  const url = `${base}/cartridges/${encodeURIComponent(cartridgeId)}/pocket/credit`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aarcade-service-key': env.aarcadePocketCreditSecret,
      },
      body: JSON.stringify({
        token: input.token || 'nvda',
        amount: String(input.amount),
        refId: input.refId,
        reason: input.reason || 'aarena-rh-ko',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[prize] pocket credit failed', res.status, text.slice(0, 200));
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[prize] pocket credit error', message);
    return { ok: false, error: message };
  }
}
