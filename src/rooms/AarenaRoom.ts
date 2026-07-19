import { Room, Client } from 'colyseus';
import { AarenaState } from '../schema/AarenaState';
import { Player } from '../schema/Player';
import { verifyAuthToken } from '../auth/jwt';
import { assertGotchiOwnedBy } from '../auth/ownership';
import { AARENA_BOUNDS, AARENA_SPAWN, MOVE } from '../config/env';
import { CombatHandle, registerCombatMessages } from '../combat/registerCombat';

type JoinOptions = {
  token?: string;
  gotchiId?: string;
  name?: string;
};

type AuthData = {
  address: string;
  gotchiId: string;
};

function randomSpawn(): { x: number; y: number } {
  const x = AARENA_SPAWN.minX + Math.random() * (AARENA_SPAWN.maxX - AARENA_SPAWN.minX);
  const y = AARENA_SPAWN.minY + Math.random() * (AARENA_SPAWN.maxY - AARENA_SPAWN.minY);
  return { x: Math.round(x), y: Math.round(y) };
}

function clampToMap(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(Math.min(AARENA_BOUNDS.maxX, Math.max(AARENA_BOUNDS.minX, x))),
    y: Math.round(Math.min(AARENA_BOUNDS.maxY, Math.max(AARENA_BOUNDS.minY, y))),
  };
}

export class AarenaRoom extends Room<AarenaState> {
  maxClients = 200;
  private lastMoveAt = new Map<string, number>();
  private joinedAt = new Map<string, number>();
  private combat: CombatHandle | null = null;

  onCreate() {
    this.setState(new AarenaState());
    this.setMetadata({ mapId: 'aarena' });
    this.combat = registerCombatMessages(this);

    this.onMessage('move', (client, message: { x?: number; y?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (this.combat?.isRushing(client.sessionId)) return;
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      const now = Date.now();
      // Allow one-shot snap shortly after join (FE/server spawn align).
      const joined = this.joinedAt.get(client.sessionId) || now;
      if (now - joined < 4000) {
        const snapped = clampToMap(message.x, message.y);
        player.x = snapped.x;
        player.y = snapped.y;
        this.lastMoveAt.set(client.sessionId, now);
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

      const next = clampToMap(player.x + dx, player.y + dy);
      player.x = next.x;
      player.y = next.y;
    });

    this.onMessage('ping', (client) => {
      client.send('pong', { t: Date.now() });
    });
  }

  async onAuth(_client: Client, options: JoinOptions): Promise<AuthData> {
    if (!options?.token) {
      throw new Error('Missing auth token');
    }
    const claims = verifyAuthToken(options.token);
    const gotchiId = String(options.gotchiId || claims.gotchiId || '');
    if (!gotchiId) {
      throw new Error('Missing gotchiId');
    }
    await assertGotchiOwnedBy(claims.address, gotchiId);
    return { address: claims.address, gotchiId };
  }

  onJoin(client: Client, options: JoinOptions, auth?: AuthData) {
    const spawn = randomSpawn();
    const player = new Player();
    player.sessionId = client.sessionId;
    player.address = auth?.address || '';
    player.gotchiId = auth?.gotchiId || String(options.gotchiId || '');
    player.name = options.name || `Gotchi #${player.gotchiId}`;
    player.x = spawn.x;
    player.y = spawn.y;
    this.state.players.set(client.sessionId, player);
    this.lastMoveAt.set(client.sessionId, Date.now());
    this.joinedAt.set(client.sessionId, Date.now());
  }

  onLeave(client: Client) {
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
