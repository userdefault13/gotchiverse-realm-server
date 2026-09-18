/**
 * RH weekly stock tournament — per-room round clock.
 *
 * Rounds are fixed-length windows aligned to the wall clock, so a realm restart re-derives the same
 * round boundaries (`roundId = <roomId>-<startedAtMs>`). The clock tallies KOs / damage / hits per
 * wallet, picks a winner at the boundary (most KOs, tie → damage, tie → earliest last KO) and hands
 * the `round_end` payload to the reporter. Aarcade (lib/rhTourney/events.cjs) is the authority on
 * whether the win and the round's KOs count — this side only reports.
 */

export type RoundActor = {
  address: string;
  gotchiId: string;
  cartridgeId: string;
  agentId?: string;
};

export type RoundParticipant = RoundActor & {
  kos: number;
  damage: number;
  hits: number;
  lastKoAt: number;
};

export type RoundEndPayload = {
  type: 'round_end';
  refId: string;
  roomId: string;
  roundId: string;
  startedAt: string;
  endedAt: string;
  participants: Array<Omit<RoundParticipant, 'lastKoAt'>>;
  winner: RoundActor | null;
};

export type KoEventPayload = {
  type: 'ko';
  refId: string;
  roomId: string;
  roundId: string;
  seq: number;
  attacker: RoundActor;
  victim: RoundActor;
  damage: number;
  at: string;
};

export type RoundStatePayload = {
  roundId: string;
  startedAt: number;
  endsAt: number;
  remainingMs: number;
  roundMs: number;
  leaders: Array<{ address: string; gotchiId: string; kos: number; damage: number }>;
};

export type RoundClockOpts = {
  roomId: string;
  roundMs: number;
  now?: () => number;
  /** Called with the finished round; the reporter posts it to Aarcade. */
  onRoundEnd: (payload: RoundEndPayload) => void;
  onKo?: (payload: KoEventPayload) => void;
  broadcast?: (type: 'round.state' | 'round.end', payload: unknown) => void;
  /** How often `round.state` is broadcast. */
  stateEveryMs?: number;
};

function normAddr(a: string | undefined | null): string {
  return String(a || '').trim().toLowerCase();
}

export function roundStartFor(nowMs: number, roundMs: number): number {
  return Math.floor(nowMs / roundMs) * roundMs;
}

export function pickWinner(participants: RoundParticipant[]): RoundParticipant | null {
  const eligible = participants.filter((p) => p.kos > 0);
  if (!eligible.length) return null;
  return [...eligible].sort(
    (a, b) => b.kos - a.kos || b.damage - a.damage || a.lastKoAt - b.lastKoAt || a.address.localeCompare(b.address),
  )[0];
}

export class RoundClock {
  private readonly roomId: string;
  private readonly roundMs: number;
  private readonly now: () => number;
  private readonly opts: RoundClockOpts;
  private startedAt: number;
  private seq = 0;
  private participants = new Map<string, RoundParticipant>();
  private timer: NodeJS.Timeout | null = null;
  private lastStateAt = 0;

  constructor(opts: RoundClockOpts) {
    this.opts = opts;
    this.roomId = opts.roomId;
    this.roundMs = Math.max(60_000, Math.floor(opts.roundMs));
    this.now = opts.now || (() => Date.now());
    this.startedAt = roundStartFor(this.now(), this.roundMs);
    this.timer = setInterval(() => this.tick(), 1000);
  }

  get roundId(): string {
    return `${this.roomId}-${this.startedAt}`;
  }

  get endsAt(): number {
    return this.startedAt + this.roundMs;
  }

  /** Register a player so they show in the tally even before their first hit. */
  touch(actor: RoundActor): RoundParticipant | null {
    const address = normAddr(actor.address);
    if (!address) return null;
    let p = this.participants.get(address);
    if (!p) {
      p = { address, gotchiId: String(actor.gotchiId || ''), cartridgeId: String(actor.cartridgeId || ''), agentId: actor.agentId, kos: 0, damage: 0, hits: 0, lastKoAt: 0 };
      this.participants.set(address, p);
    } else {
      // latest hero/cartridge wins (re-join with a different hero mid-round)
      if (actor.gotchiId) p.gotchiId = String(actor.gotchiId);
      if (actor.cartridgeId) p.cartridgeId = String(actor.cartridgeId);
      if (actor.agentId) p.agentId = actor.agentId;
    }
    return p;
  }

  recordHit(attacker: RoundActor, damage: number): void {
    this.rollIfDue();
    const p = this.touch(attacker);
    if (!p) return;
    p.hits += 1;
    p.damage += Math.max(0, Number(damage) || 0);
  }

  /** Returns the KO refId for the combat.ko broadcast. */
  recordKo(attacker: RoundActor, victim: RoundActor, damage: number): { refId: string; seq: number; roundId: string } {
    this.rollIfDue();
    const a = this.touch(attacker);
    this.touch(victim);
    this.seq += 1;
    const seq = this.seq;
    const roundId = this.roundId;
    const at = this.now();
    if (a) {
      a.kos += 1;
      a.lastKoAt = at;
    }
    const refId = `ko:${this.roomId}:${this.startedAt}:${seq}:${normAddr(attacker.address)}:${normAddr(victim.address)}`;
    this.opts.onKo?.({
      type: 'ko',
      refId,
      roomId: this.roomId,
      roundId,
      seq,
      attacker: { ...attacker, address: normAddr(attacker.address) },
      victim: { ...victim, address: normAddr(victim.address) },
      damage: Math.max(0, Number(damage) || 0),
      at: new Date(at).toISOString(),
    });
    return { refId, seq, roundId };
  }

  state(): RoundStatePayload {
    const now = this.now();
    const leaders = [...this.participants.values()]
      .filter((p) => p.kos > 0 || p.damage > 0)
      .sort((a, b) => b.kos - a.kos || b.damage - a.damage)
      .slice(0, 5)
      .map((p) => ({ address: p.address, gotchiId: p.gotchiId, kos: p.kos, damage: p.damage }));
    return { roundId: this.roundId, startedAt: this.startedAt, endsAt: this.endsAt, remainingMs: Math.max(0, this.endsAt - now), roundMs: this.roundMs, leaders };
  }

  /** Close the current round if its window has passed; starts the next one. */
  rollIfDue(): boolean {
    if (this.now() < this.endsAt) return false;
    this.finishRound();
    return true;
  }

  private finishRound(): void {
    const participants = [...this.participants.values()];
    const winner = pickWinner(participants);
    const endedAt = this.endsAt;
    const payload: RoundEndPayload = {
      type: 'round_end',
      refId: `round:${this.roomId}:${this.startedAt}`,
      roomId: this.roomId,
      roundId: this.roundId,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      participants: participants.map(({ lastKoAt: _l, ...p }) => p),
      winner: winner ? { address: winner.address, gotchiId: winner.gotchiId, cartridgeId: winner.cartridgeId, agentId: winner.agentId } : null,
    };
    // Only report rounds where something happened; empty rounds are noise for the ledger.
    if (participants.some((p) => p.hits > 0 || p.kos > 0)) {
      try {
        this.opts.onRoundEnd(payload);
      } catch (err) {
        console.warn('[tourney] onRoundEnd failed', err instanceof Error ? err.message : err);
      }
    }
    this.opts.broadcast?.('round.end', { roundId: payload.roundId, winner: payload.winner, participants: payload.participants, endedAt: payload.endedAt });
    // next window: aligned to the wall clock, so a long tick gap skips straight to the current window
    this.startedAt = roundStartFor(Math.max(this.now(), endedAt), this.roundMs);
    this.seq = 0;
    this.participants = new Map();
  }

  private tick(): void {
    try {
      this.rollIfDue();
      const every = this.opts.stateEveryMs ?? 10_000;
      const now = this.now();
      if (now - this.lastStateAt >= every) {
        this.lastStateAt = now;
        this.opts.broadcast?.('round.state', this.state());
      }
    } catch (err) {
      console.warn('[tourney] tick failed', err instanceof Error ? err.message : err);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Report whatever was tallied so a room teardown mid-round doesn't lose the KOs' finalization.
    if ([...this.participants.values()].some((p) => p.hits > 0 || p.kos > 0)) {
      const payload: RoundEndPayload = {
        type: 'round_end',
        refId: `round:${this.roomId}:${this.startedAt}`,
        roomId: this.roomId,
        roundId: this.roundId,
        startedAt: new Date(this.startedAt).toISOString(),
        endedAt: new Date(this.now()).toISOString(),
        participants: [...this.participants.values()].map(({ lastKoAt: _l, ...p }) => p),
        winner: null, // a truncated round never credits a win
      };
      try {
        this.opts.onRoundEnd(payload);
      } catch {
        /* ignore */
      }
    }
    this.participants.clear();
  }
}
