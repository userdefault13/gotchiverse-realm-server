/**
 * RH weekly stock tournament — post round / KO events to Aarcade.
 *
 * POST RH_TOURNEY_EVENTS_URL { events: [...] } with x-aarcade-service-key. Aarcade dedupes by
 * refId, so retries are safe. Events are batched every ~2 s; a failed batch is retried with
 * backoff up to 3 times and then dropped (Aarcade's ledger is authoritative — a lost event is
 * lost score only, never lost money).
 */
import { env } from '../config/env';
import type { KoEventPayload, RoundEndPayload } from './roundClock';

export type TourneyEvent = KoEventPayload | RoundEndPayload;

const FLUSH_MS = 2000;
const MAX_BATCH = 50;
const MAX_ATTEMPTS = 3;

type Pending = { event: TourneyEvent; attempts: number };

const queue: Pending[] = [];
let timer: NodeJS.Timeout | null = null;
let inflight = false;

function schedule(delay = FLUSH_MS) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

export function reportTourneyEvent(event: TourneyEvent): void {
  if (!env.rhTourneyEnabled) return;
  if (!env.rhTourneyEventsUrl || !env.rhTourneyEventSecret) {
    console.warn('[tourney] RH_TOURNEY_EVENTS_URL / RH_TOURNEY_EVENT_SECRET unset — event dropped', event.refId);
    return;
  }
  queue.push({ event, attempts: 0 });
  schedule(event.type === 'round_end' ? 200 : FLUSH_MS);
}

export async function flush(): Promise<void> {
  if (inflight || !queue.length) return;
  inflight = true;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const res = await fetch(env.rhTourneyEventsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aarcade-service-key': env.rhTourneyEventSecret },
      body: JSON.stringify({ events: batch.map((b) => b.event) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`http_${res.status} ${text.slice(0, 160)}`);
    }
    const body = (await res.json().catch(() => null)) as { data?: { results?: Array<{ refId: string; accepted: boolean; rejectReason?: string | null; winCredited?: boolean }> } } | null;
    const results = body?.data?.results || [];
    for (const r of results) {
      if (r.rejectReason && r.rejectReason !== 'duplicate' && r.rejectReason !== 'disabled') {
        console.log('[tourney] event not credited', r.refId, r.rejectReason);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retry = batch.filter((b) => b.attempts + 1 < MAX_ATTEMPTS).map((b) => ({ ...b, attempts: b.attempts + 1 }));
    const dropped = batch.length - retry.length;
    console.warn(`[tourney] report failed (${message}); retrying ${retry.length}, dropped ${dropped}`);
    queue.unshift(...retry);
    if (retry.length) schedule(FLUSH_MS * 2 ** Math.min(3, retry[0].attempts));
  } finally {
    inflight = false;
    if (queue.length) schedule();
  }
}

/** Test / shutdown helper. */
export function pendingTourneyEvents(): number {
  return queue.length;
}
