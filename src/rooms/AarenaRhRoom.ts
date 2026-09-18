import { Room, Client } from 'colyseus';
import { AarenaState } from '../schema/AarenaState';
import { Player } from '../schema/Player';
import { verifyAuthToken } from '../auth/jwt';
import { MOVE, env } from '../config/env';
import { CombatHandle, registerCombatMessages } from '../combat/registerCombat';
import { parseJoinTraits, resolveCombatProfile } from '../combat/combatStats';
import { isAarenaBlocked, randomAarenaSpawn, resolveAarenaMove } from '../maps/aarenaCollisions';
import { creditCartridgePocket } from '../prize/creditPocket';
import { leaderboardOnJoin, leaderboardOnLeave } from '../leaderboard/store';
import { agentSessionEnd, agentSessionStart } from '../agent/session';
import { RoundClock } from '../tourney/roundClock';
import { reportTourneyEvent } from '../tourney/reportEvents';
import { verifyRhCartridge } from '../tourney/verifyCartridge';

type JoinOptions = {
  token?: string;
  gotchiId?: string;
  name?: string;
  cartridgeId?: string;
  chain?: string;
  /** JSON array or number[] of withSetsNumericTraits [NRG,AGG,SPK,BRN,...] */
  traits?: unknown;
};

type AuthData = {
  address: string;
  gotchiId: string;
  cartridgeId: string;
  agentId?: string;
  /** Hero collateral pinned at join when RH_TOURNEY_VERIFY_CARTRIDGE resolved it. */
  collateral?: string | null;
};

type MoveMessage = {
  x?: number;
  y?: number;
  /** Client finished a predicted rush — accept without walk-speed clamp. */
  rushSettle?: boolean;
};

/** Allow walk+dash desync — old cap yanked players back to plaza spawn. */
const MAX_RUSH_SETTLE_PX = 24 * 64 * 2 + 256;

/**
 * Robinhood Chain aarena — same map/combat as Base aarena, but:
 * - skips Base subgraph ownership (Nakey / soft cartridge ids)
 * - enables HP + KO SIM pocket prizes
 */
export class AarenaRhRoom extends Room<AarenaState> {
  maxClients = 200;
  private lastMoveAt = new Map<string, number>();
  private joinedAt = new Map<string, number>();
  private lastGotchiPos = new Map<string, { x: number; y: number; at: number }>();
  private combat: CombatHandle | null = null;
  private tourney: RoundClock | null = null;

  onCreate() {
    this.setState(new AarenaState());
    this.setMetadata({ mapId: 'aarena', chain: 'rh', tourney: env.rhTourneyEnabled });
    if (env.rhTourneyEnabled) {
      this.tourney = new RoundClock({
        roomId: this.roomId,
        roundMs: env.rhRoundMinutes * 60_000,
        onRoundEnd: (payload) => reportTourneyEvent(payload),
        onKo: (payload) => reportTourneyEvent(payload),
        broadcast: (type, payload) => this.broadcast(type, payload),
      });
    }
    this.combat = registerCombatMessages(this, {
      enableDamage: true,
      roomKey: 'aarena-rh',
      // The tournament replaces the per-KO NVDA drip (env.rhKoDripEnabled defaults accordingly).
      awardPrizes: env.rhKoDripEnabled,
      tourney: this.tourney,
    });

    this.onMessage('round.state', (client) => {
      if (this.tourney) client.send('round.state', this.tourney.state());
    });

    this.onMessage('move', (client, message: MoveMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
      if (player.hp <= 0) return;

      const now = Date.now();

      if (message.rushSettle) {
        this.combat?.cancelRush(client.sessionId);
        const dist = Math.hypot(message.x - player.x, message.y - player.y);
        if (dist > MAX_RUSH_SETTLE_PX) return;
        if (!isAarenaBlocked(message.x, message.y)) {
          player.x = Math.round(message.x);
          player.y = Math.round(message.y);
        } else {
          const snapped = resolveAarenaMove(player.x, player.y, message.x, message.y);
          player.x = snapped.x;
          player.y = snapped.y;
        }
        this.lastMoveAt.set(client.sessionId, now);
        this.rememberGotchiPos(player.gotchiId, player.x, player.y);
        return;
      }

      if (this.combat?.isRushing(client.sessionId)) return;

      const joined = this.joinedAt.get(client.sessionId) || now;
      if (now - joined < 4000) {
        const snapped = resolveAarenaMove(player.x, player.y, message.x, message.y);
        player.x = snapped.x;
        player.y = snapped.y;
        this.lastMoveAt.set(client.sessionId, now);
        this.rememberGotchiPos(player.gotchiId, player.x, player.y);
        return;
      }

      const prevTime = this.lastMoveAt.get(client.sessionId) || now;
      const dt = Math.max(1, now - prevTime) / 1000;
      this.lastMoveAt.set(client.sessionId, now);

      let dx = message.x - player.x;
      let dy = message.y - player.y;
      const dist = Math.hypot(dx, dy);
      const maxDist = Math.min(MOVE.maxStepPx, MOVE.maxSpeedPxPerSec * dt);
      if (dist > maxDist && dist > 0) {
        dx = (dx / dist) * maxDist;
        dy = (dy / dist) * maxDist;
      }

      const next = resolveAarenaMove(player.x, player.y, player.x + dx, player.y + dy);
      player.x = next.x;
      player.y = next.y;
      this.rememberGotchiPos(player.gotchiId, player.x, player.y);
    });

    this.onMessage('ping', (client) => {
      client.send('pong', { t: Date.now() });
    });

    /** Test-only: hotkey alchemica drop → SIM NVDA pocket credit (RH_TEST_DROP_ENABLED). */
    this.onMessage('prize.testDrop', (client, message: { token?: string }) => {
      void this.handleTestDrop(client, message?.token);
    });
  }

  private async handleTestDrop(client: Client, token?: string) {
    if (!env.rhTestDropEnabled) {
      client.send('combat.prize', {
        ok: false,
        error: 'test_drop_disabled',
        message: 'Set RH_TEST_DROP_ENABLED=true on REALM to use hotkey drops.',
      });
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!player.cartridgeId) {
      client.send('combat.prize', {
        ok: false,
        error: 'no_cartridge',
        message: 'Mint or bind an Aarcade cartridge to earn NVDA pocket prizes.',
      });
      return;
    }
    const refId = `testdrop:${this.roomId}:${client.sessionId}:${Date.now()}:${token || 'nvda'}`;
    const amount = env.rhTestDropAmount;
    const result = await creditCartridgePocket({
      cartridgeId: player.cartridgeId,
      amount,
      refId,
      reason: 'aarena-rh-test-drop',
      token: 'nvda',
    });
    if (result.ok && !result.skipped) {
      client.send('combat.prize', {
        ok: true,
        amount,
        token: 'nvda',
        cartridgeId: player.cartridgeId,
        refId,
      });
    } else {
      client.send('combat.prize', {
        ok: false,
        error: result.ok ? result.reason : result.error,
        message: 'Test drop credit failed — check AARCADE_POCKET_CREDIT_SECRET + cartridge-sim.',
      });
    }
  }

  private rememberGotchiPos(gotchiId: string, x: number, y: number) {
    if (!gotchiId) return;
    this.lastGotchiPos.set(String(gotchiId), { x, y, at: Date.now() });
  }

  async onAuth(_client: Client, options: JoinOptions): Promise<AuthData> {
    if (!options?.token) {
      throw new Error('Missing auth token');
    }
    const claims = verifyAuthToken(options.token);
    // Agent claims pin hero + cartridge from the token (no client-supplied override).
    if (claims.agentId) {
      const heroId = String(claims.gotchiId || '');
      if (!heroId) throw new Error('Missing gotchiId');
      return {
        address: claims.address,
        gotchiId: heroId,
        cartridgeId: String(claims.cartridgeId || ''),
        agentId: claims.agentId,
      };
    }
    const gotchiId = String(options.gotchiId || claims.gotchiId || claims.address || '');
    if (!gotchiId) {
      throw new Error('Missing gotchiId');
    }
    // RH room: no Base subgraph ownership — Nakey / wallet-id / soft cartridge players OK.
    const cartridgeId = String(options.cartridgeId || '').trim();
    // Tournament: a claimed cartridge must be the player's own and the hero live (not retired).
    const check = await verifyRhCartridge(claims.address, gotchiId, cartridgeId);
    if (!check.ok) {
      throw new Error(`rh_tourney:${check.reason}`);
    }
    return { address: claims.address, gotchiId: check.heroId || gotchiId, cartridgeId, collateral: check.collateral };
  }

  onJoin(client: Client, options: JoinOptions, auth?: AuthData) {
    const gotchiId = auth?.gotchiId || String(options.gotchiId || '');
    // Drop ghost sessions of the same gotchi so slap can't "self-hit" a duplicate body.
    for (const other of this.clients) {
      if (other.sessionId === client.sessionId) continue;
      const existing = this.state.players.get(other.sessionId);
      if (existing && String(existing.gotchiId) === String(gotchiId)) {
        try {
          other.leave(4000);
        } catch {
          /* ignore */
        }
      }
    }
    const prev = this.lastGotchiPos.get(String(gotchiId));
    const reuse =
      prev && Date.now() - prev.at < 120_000 && !isAarenaBlocked(prev.x, prev.y)
        ? { x: prev.x, y: prev.y }
        : null;
    const spawn = reuse || randomAarenaSpawn();
    const player = new Player();
    player.sessionId = client.sessionId;
    player.address = auth?.address || '';
    player.gotchiId = gotchiId;
    player.name = options.name || `Gotchi #${player.gotchiId}`;
    player.x = spawn.x;
    player.y = spawn.y;
    const traits = parseJoinTraits(options.traits);
    const profile = resolveCombatProfile(traits);
    player.maxHp = profile.maxHp;
    player.hp = profile.maxHp;
    player.maxAp = profile.maxAp;
    player.ap = profile.maxAp;
    player.cartridgeId = auth?.cartridgeId || String(options.cartridgeId || '').trim();
    this.state.players.set(client.sessionId, player);
    this.combat?.setProfile(client.sessionId, profile);
    this.lastMoveAt.set(client.sessionId, Date.now());
    this.joinedAt.set(client.sessionId, Date.now());
    this.rememberGotchiPos(gotchiId, player.x, player.y);
    leaderboardOnJoin({
      gotchiId,
      name: player.name,
      address: player.address,
    });
    if (this.tourney) {
      this.tourney.touch({ address: player.address, gotchiId, cartridgeId: player.cartridgeId, agentId: auth?.agentId });
      client.send('round.state', this.tourney.state());
    }
    if (auth?.agentId) {
      agentSessionStart(client.sessionId, {
        agentId: auth.agentId,
        cartridgeId: player.cartridgeId,
        gotchiId,
        zone: 'aarena-rh',
      });
    }
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.rememberGotchiPos(player.gotchiId, player.x, player.y);
      leaderboardOnLeave(player.gotchiId);
    }
    agentSessionEnd(client.sessionId);
    this.combat?.onPlayerLeave(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
    this.joinedAt.delete(client.sessionId);
  }

  onDispose() {
    this.combat?.dispose();
    this.combat = null;
    this.tourney?.dispose();
    this.tourney = null;
  }
}
