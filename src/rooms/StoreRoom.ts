import { Room, Client } from 'colyseus';
import { Player } from '../schema/Player';
import {
  StoreState,
  STORE_INTERIOR_W,
  STORE_INTERIOR_H,
  STORE_TILE_PX,
} from '../schema/StoreState';
import { verifyAuthToken } from '../auth/jwt';
import { assertGotchiOwnedBy } from '../auth/ownership';

type JoinOptions = {
  token?: string;
  gotchiId?: string;
  name?: string;
  storeId?: string;
  cartridgeId?: string;
  ownerAddress?: string;
};

type AuthData = {
  address: string;
  gotchiId: string;
};

/** Phase 1 Store interior: max 8 shoppers; dispose 60s after empty. */
export class StoreRoom extends Room<StoreState> {
  maxClients = 8;
  private emptyDisposeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly emptyGraceMs = 60_000;
  private lastMoveAt = new Map<string, number>();

  onCreate(options: JoinOptions) {
    // Custom empty grace — avoid immediate dispose on last leave.
    this.autoDispose = false;
    this.setState(new StoreState());
    const storeId = String(options?.storeId || '').trim() || this.roomId;
    this.state.storeId = storeId;
    this.state.cartridgeId = String(options?.cartridgeId || '').trim();
    this.state.ownerAddress = String(options?.ownerAddress || '').trim().toLowerCase();
    this.state.interiorW = STORE_INTERIOR_W;
    this.state.interiorH = STORE_INTERIOR_H;
    this.setMetadata({ mapId: 'store', storeId });

    this.onMessage('move', (client, message: { x?: number; y?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      const maxX = this.state.interiorW * STORE_TILE_PX;
      const maxY = this.state.interiorH * STORE_TILE_PX;
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

    this.onMessage('store.leave', (client) => {
      client.leave(1000);
    });

    this.onMessage('store.layout.seed', (client, message: { layoutJson?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // First joiner / owner may seed empty room layout from local SIM store.
      if (this.state.layoutJson) return;
      const raw = String(message?.layoutJson || '');
      if (!raw || raw.length > 200_000) return;
      this.state.layoutJson = raw;
    });

    this.onMessage('store.layout.update', (client, message: { layoutJson?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const owner = String(this.state.ownerAddress || '').toLowerCase();
      const addr = String(player.address || '').toLowerCase();
      // Allow update when owner matches, or when no owner was set on join (soft-launch).
      if (owner && addr && owner !== addr) {
        client.send('store.error', { code: 'not_owner' });
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
      this.broadcast('store.layout.changed', { layoutJson: raw }, { except: client });
    });
  }

  async onAuth(_client: Client, options: JoinOptions): Promise<AuthData> {
    if (!options?.token) {
      throw new Error('store_auth_required');
    }
    const claims = verifyAuthToken(options.token);
    const gotchiId = String(options.gotchiId || claims.gotchiId || '');
    if (!gotchiId) {
      throw new Error('store_auth_required');
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
    // Spawn just inside the front door (matches client SPAWN_TX/TY = 7, 14).
    player.x = Math.round(7 * STORE_TILE_PX + STORE_TILE_PX / 2);
    player.y = Math.round((STORE_INTERIOR_H - 2) * STORE_TILE_PX + STORE_TILE_PX / 2);
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
