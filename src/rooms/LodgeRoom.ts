import { Room, Client } from 'colyseus';
import { Player } from '../schema/Player';
import {
  LodgeState,
  LODGE_INTERIOR_W,
  LODGE_INTERIOR_H,
  LODGE_TILE_PX,
} from '../schema/LodgeState';
import { verifyAuthToken } from '../auth/jwt';
import { assertGotchiOwnedBy } from '../auth/ownership';

type JoinOptions = {
  token?: string;
  gotchiId?: string;
  name?: string;
  lodgeId?: string;
  cartridgeId?: string;
  ownerAddress?: string;
};

type AuthData = {
  address: string;
  gotchiId: string;
};

/** Phase 1 Lodge interior: max 8 guests; dispose 60s after empty. */
export class LodgeRoom extends Room<LodgeState> {
  maxClients = 8;
  private emptyDisposeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly emptyGraceMs = 60_000;
  private lastMoveAt = new Map<string, number>();

  onCreate(options: JoinOptions) {
    // Custom empty grace — avoid immediate dispose on last leave.
    this.autoDispose = false;
    this.setState(new LodgeState());
    const lodgeId = String(options?.lodgeId || '').trim() || this.roomId;
    this.state.lodgeId = lodgeId;
    this.state.cartridgeId = String(options?.cartridgeId || '').trim();
    this.state.ownerAddress = String(options?.ownerAddress || '').trim().toLowerCase();
    this.state.interiorW = LODGE_INTERIOR_W;
    this.state.interiorH = LODGE_INTERIOR_H;
    this.setMetadata({ mapId: 'lodge', lodgeId });

    this.onMessage('move', (client, message: { x?: number; y?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      const maxX = this.state.interiorW * LODGE_TILE_PX;
      const maxY = this.state.interiorH * LODGE_TILE_PX;
      const x = Math.max(0, Math.min(maxX, Math.round(message.x)));
      const y = Math.max(0, Math.min(maxY, Math.round(message.y)));

      const now = Date.now();
      const last = this.lastMoveAt.get(client.sessionId) || 0;
      if (now - last < 33) return;
      this.lastMoveAt.set(client.sessionId, now);

      player.x = x;
      player.y = y;
    });

    this.onMessage('ping', (client) => {
      client.send('pong', { t: Date.now() });
    });

    this.onMessage('lodge.leave', (client) => {
      client.leave(1000);
    });

    this.onMessage('lodge.layout.seed', (client, message: { layoutJson?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // First joiner / owner may seed empty room layout from local SIM lodge.
      if (this.state.layoutJson) return;
      const raw = String(message?.layoutJson || '');
      if (!raw || raw.length > 200_000) return;
      this.state.layoutJson = raw;
    });

    this.onMessage('lodge.layout.update', (client, message: { layoutJson?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const owner = String(this.state.ownerAddress || '').toLowerCase();
      const addr = String(player.address || '').toLowerCase();
      // Allow update when owner matches, or when no owner was set on join (soft-launch).
      if (owner && addr && owner !== addr) {
        client.send('lodge.error', { code: 'not_owner' });
        return;
      }
      const raw = String(message?.layoutJson || '');
      if (!raw || raw.length > 200_000) return;
      try {
        JSON.parse(raw);
      } catch {
        return;
      }
      this.state.layoutJson = raw;
      this.broadcast('lodge.layout.changed', { layoutJson: raw }, { except: client });
    });
  }

  async onAuth(_client: Client, options: JoinOptions): Promise<AuthData> {
    if (!options?.token) {
      throw new Error('lodge_auth_required');
    }
    const claims = verifyAuthToken(options.token);
    const gotchiId = String(options.gotchiId || claims.gotchiId || '');
    if (!gotchiId) {
      throw new Error('lodge_auth_required');
    }
    await assertGotchiOwnedBy(claims.address, gotchiId);
    return { address: claims.address, gotchiId };
  }

  onJoin(client: Client, options: JoinOptions, auth?: AuthData) {
    this.clearEmptyDispose();

    const player = new Player();
    player.sessionId = client.sessionId;
    player.address = auth?.address || '';
    player.gotchiId = auth?.gotchiId || String(options.gotchiId || '');
    player.name = String(options?.name || `Gotchi #${player.gotchiId}`);
    player.cartridgeId = String(options?.cartridgeId || '').trim();
    // Spawn near center of 16×16 lodge floor.
    player.x = Math.round((LODGE_INTERIOR_W / 2) * LODGE_TILE_PX);
    player.y = Math.round((LODGE_INTERIOR_H / 2) * LODGE_TILE_PX);
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
    if (this.clients.length === 0) {
      this.scheduleEmptyDispose();
    }
  }

  onDispose() {
    this.clearEmptyDispose();
  }

  private scheduleEmptyDispose() {
    this.clearEmptyDispose();
    this.emptyDisposeTimer = setTimeout(() => {
      if (this.clients.length === 0) {
        void this.disconnect();
      }
    }, this.emptyGraceMs);
  }

  private clearEmptyDispose() {
    if (this.emptyDisposeTimer) {
      clearTimeout(this.emptyDisposeTimer);
      this.emptyDisposeTimer = null;
    }
  }
}
