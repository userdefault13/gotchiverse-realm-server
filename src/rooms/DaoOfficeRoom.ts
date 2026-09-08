import { Room, Client } from 'colyseus';
import { Player } from '../schema/Player';
import {
  DaoOfficeState,
  DAO_OFFICE_INTERIOR_W,
  DAO_OFFICE_INTERIOR_H,
  DAO_OFFICE_TILE_PX,
} from '../schema/DaoOfficeState';
import { verifyAuthToken } from '../auth/jwt';
import { assertGotchiOwnedBy } from '../auth/ownership';

type JoinOptions = {
  token?: string;
  gotchiId?: string;
  name?: string;
  daoOfficeId?: string;
  cartridgeId?: string;
  ownerAddress?: string;
};

type AuthData = {
  address: string;
  gotchiId: string;
};

/** Soft-launch DAO Office interior: max 8 visitors; dispose 60s after empty. */
export class DaoOfficeRoom extends Room<DaoOfficeState> {
  maxClients = 8;
  private emptyDisposeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly emptyGraceMs = 60_000;
  private lastMoveAt = new Map<string, number>();

  onCreate(options: JoinOptions) {
    this.autoDispose = false;
    this.setState(new DaoOfficeState());
    const daoOfficeId = String(options?.daoOfficeId || '').trim() || this.roomId;
    this.state.daoOfficeId = daoOfficeId;
    this.state.cartridgeId = String(options?.cartridgeId || '').trim();
    this.state.ownerAddress = String(options?.ownerAddress || '').toLowerCase();
    this.state.interiorW = DAO_OFFICE_INTERIOR_W;
    this.state.interiorH = DAO_OFFICE_INTERIOR_H;
    this.setMetadata({ mapId: 'dao_office', daoOfficeId });

    this.onMessage('move', (client, message: { x?: number; y?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      const maxX = this.state.interiorW * DAO_OFFICE_TILE_PX;
      const maxY = this.state.interiorH * DAO_OFFICE_TILE_PX;
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

    this.onMessage('dao_office.leave', (client) => {
      client.leave(1000);
    });

    this.onMessage('dao_office.layout.seed', (client, message: { layoutJson?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (this.state.layoutJson) return;
      const raw = String(message?.layoutJson || '');
      if (!raw || raw.length > 200_000) return;
      this.state.layoutJson = raw;
    });

    this.onMessage('dao_office.layout.update', (client, message: { layoutJson?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const owner = String(this.state.ownerAddress || '').toLowerCase();
      const addr = String(player.address || '').toLowerCase();
      if (owner && addr && owner !== addr) {
        client.send('dao_office.error', { code: 'not_owner' });
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
      this.broadcast('dao_office.layout.changed', { layoutJson: raw }, { except: client });
    });
  }

  async onAuth(_client: Client, options: JoinOptions): Promise<AuthData> {
    if (!options?.token) {
      throw new Error('dao_office_auth_required');
    }
    const claims = verifyAuthToken(options.token);
    const gotchiId = String(options.gotchiId || claims.gotchiId || '');
    if (!gotchiId) {
      throw new Error('dao_office_auth_required');
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
    player.x = Math.round((DAO_OFFICE_INTERIOR_W / 2) * DAO_OFFICE_TILE_PX);
    player.y = Math.round((DAO_OFFICE_INTERIOR_H / 2) * DAO_OFFICE_TILE_PX);
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
