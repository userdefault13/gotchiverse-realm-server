import { Room, Client } from 'colyseus';
import { AarenaState } from '../schema/AarenaState';
import { Player } from '../schema/Player';
import { verifyAuthToken } from '../auth/jwt';
import { assertGotchiOwnedBy } from '../auth/ownership';
import { MOVE } from '../config/env';
import { CombatHandle, registerCombatMessages } from '../combat/registerCombat';
import { parseJoinTraits, resolveCombatProfile } from '../combat/combatStats';
import { isAarenaBlocked, randomAarenaSpawn, resolveAarenaMove } from '../maps/aarenaCollisions';
import { leaderboardOnJoin, leaderboardOnLeave } from '../leaderboard/store';
import { agentSessionEnd, agentSessionStart } from '../agent/session';

type JoinOptions = {
  token?: string;
  gotchiId?: string;
  name?: string;
  /** JSON array or number[] of withSetsNumericTraits [NRG,AGG,SPK,BRN,...] */
  traits?: unknown;
};

type AuthData = {
  address: string;
  gotchiId: string;
  agentId?: string;
  cartridgeId?: string;
};

type MoveMessage = {
  x?: number;
  y?: number;
  /** Client finished a predicted rush — accept without walk-speed clamp. */
  rushSettle?: boolean;
};

/** Allow walk+dash desync — old cap yanked players back to plaza spawn. */
const MAX_RUSH_SETTLE_PX = 24 * 64 * 2 + 256;

export class AarenaRoom extends Room<AarenaState> {
  maxClients = 200;
  private lastMoveAt = new Map<string, number>();
  private joinedAt = new Map<string, number>();
  /** Remember last pos per gotchi so brief reconnects don't random-respawn in the plaza. */
  private lastGotchiPos = new Map<string, { x: number; y: number; at: number }>();
  private combat: CombatHandle | null = null;

  onCreate() {
    this.setState(new AarenaState());
    this.setMetadata({ mapId: 'aarena' });
    this.combat = registerCombatMessages(this, {
      enableDamage: true,
      roomKey: 'aarena',
      awardPrizes: false,
    });

    this.onMessage('move', (client, message: MoveMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
      if (player.hp <= 0) return;

      const now = Date.now();

      // Post-dash reconcile: cancel in-flight rush and trust client end position.
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

      // Allow one-shot snap shortly after join (FE/server spawn align / wall nudge).
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
    // Agent claims carry the cartridge hero as gotchiId; the token itself is proof.
    const gotchiId = claims.agentId
      ? String(claims.gotchiId || '')
      : String(options.gotchiId || claims.gotchiId || '');
    if (!gotchiId) {
      throw new Error('Missing gotchiId');
    }
    if (!claims.agentId) await assertGotchiOwnedBy(claims.address, gotchiId);
    return { address: claims.address, gotchiId, agentId: claims.agentId, cartridgeId: claims.cartridgeId };
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
    player.cartridgeId = auth?.cartridgeId || '';
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
    if (auth?.agentId) {
      agentSessionStart(client.sessionId, {
        agentId: auth.agentId,
        cartridgeId: auth.cartridgeId || '',
        gotchiId,
        zone: 'aarena',
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
  }
}
