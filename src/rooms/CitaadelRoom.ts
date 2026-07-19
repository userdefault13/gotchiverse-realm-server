import { Room, Client } from 'colyseus';
import { CitaadelState } from '../schema/CitaadelState';
import { Player } from '../schema/Player';
import { WildNode } from '../schema/foundry/WildNode';
import { Antenna } from '../schema/foundry/Antenna';
import { WallReceiver } from '../schema/foundry/WallReceiver';
import { FoundryCargo } from '../schema/foundry/FoundryCargo';
import { verifyAuthToken } from '../auth/jwt';
import { assertGotchiOwnedBy } from '../auth/ownership';
import { MOVE, SPAWN } from '../config/env';
import { FOUNDRY_CONFIG } from '../config/foundry';
import { canReachReceiver } from '../foundry/mesh';

type JoinOptions = {
  token?: string;
  gotchiId?: string;
  name?: string;
  spawnLocId?: string;
};

type AuthData = {
  address: string;
  gotchiId: string;
};

const TILE = 64;
const GATHER_AMOUNT = 10;
const RECEIVER_ID = FOUNDRY_CONFIG.wallReceiverSouth.id;

function parcelSizeByType(typeId: string): { width: number; height: number } {
  switch (typeId) {
    case 'H':
      return { width: 8, height: 8 };
    case 'R':
      return { width: 16, height: 16 };
    case 'P':
    case 'G':
      return { width: 64, height: 64 };
    case 'U':
      return { width: 64, height: 32 };
    case 'V':
      return { width: 32, height: 64 };
    default:
      return { width: 8, height: 8 };
  }
}

function randomSpawn(): { x: number; y: number } {
  const x = SPAWN.minX + Math.random() * (SPAWN.maxX - SPAWN.minX);
  const y = SPAWN.minY + Math.random() * (SPAWN.maxY - SPAWN.minY);
  return { x: Math.round(x), y: Math.round(y) };
}

/** Spawn at parcel center when join options include a Citaadel parcel id (`C-x-y-T`). */
function spawnFromOptions(spawnLocId?: string): { x: number; y: number } {
  if (spawnLocId && spawnLocId.charAt(0) === 'C') {
    const parts = spawnLocId.split('-');
    if (parts.length >= 4) {
      const tileX = Number(parts[1]);
      const tileY = Number(parts[2]);
      const typeId = parts[3];
      if (Number.isFinite(tileX) && Number.isFinite(tileY)) {
        const { width, height } = parcelSizeByType(typeId);
        return {
          x: Math.round((tileX + width / 2) * TILE),
          y: Math.round((tileY + height / 2) * TILE),
        };
      }
    }
  }
  return randomSpawn();
}

function distancePx(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export class CitaadelRoom extends Room<CitaadelState> {
  maxClients = 200;
  private lastMoveAt = new Map<string, number>();
  private joinedAt = new Map<string, number>();
  private lastTeleportAt = new Map<string, number>();
  private antennaSeq = 0;

  onCreate() {
    this.setState(new CitaadelState());
    this.setMetadata({ mapId: 'citaadel' });
    this.seedFoundryState();
    this.registerFoundryMessages();

    this.onMessage('move', (client, message: { x?: number; y?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      const now = Date.now();
      // Allow one-shot snap to selected parcel shortly after join (FE/server spawn align).
      const joined = this.joinedAt.get(client.sessionId) || now;
      if (now - joined < 4000) {
        player.x = Math.round(message.x);
        player.y = Math.round(message.y);
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

      player.x = Math.round(player.x + dx);
      player.y = Math.round(player.y + dy);
    });

    // Bounce-gate / event travel — intentional long-distance snap (not walk-clamped).
    this.onMessage('teleport', (client, message: { x?: number; y?: number; parcelId?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      const now = Date.now();
      const last = this.lastTeleportAt.get(client.sessionId) || 0;
      if (now - last < 1500) return;
      this.lastTeleportAt.set(client.sessionId, now);

      // Citaadel parcels sit within a large but finite tile map.
      const MAX = 9000 * TILE;
      if (message.x < -TILE || message.y < -TILE || message.x > MAX || message.y > MAX) return;

      player.x = Math.round(message.x);
      player.y = Math.round(message.y);
      this.lastMoveAt.set(client.sessionId, now);
    });

    this.onMessage('ping', (client) => {
      client.send('pong', { t: Date.now() });
    });

    this.setSimulationInterval(() => this.factionTick(), FOUNDRY_CONFIG.factionTickMs);
  }

  private seedFoundryState() {
    const yieldNode = new WildNode();
    yieldNode.id = FOUNDRY_CONFIG.yieldFields.id;
    yieldNode.x = FOUNDRY_CONFIG.yieldFields.x;
    yieldNode.y = FOUNDRY_CONFIG.yieldFields.y;
    yieldNode.veinType = FOUNDRY_CONFIG.yieldFields.veinType;
    yieldNode.remaining = FOUNDRY_CONFIG.yieldFields.remaining;
    this.state.wildNodes.set(yieldNode.id, yieldNode);

    const desertNode = new WildNode();
    desertNode.id = FOUNDRY_CONFIG.defiDesert.id;
    desertNode.x = FOUNDRY_CONFIG.defiDesert.x;
    desertNode.y = FOUNDRY_CONFIG.defiDesert.y;
    desertNode.veinType = FOUNDRY_CONFIG.defiDesert.veinType;
    desertNode.remaining = FOUNDRY_CONFIG.defiDesert.remaining;
    this.state.wildNodes.set(desertNode.id, desertNode);

    const receiver = new WallReceiver();
    receiver.id = FOUNDRY_CONFIG.wallReceiverSouth.id;
    receiver.x = FOUNDRY_CONFIG.wallReceiverSouth.x;
    receiver.y = FOUNDRY_CONFIG.wallReceiverSouth.y;
    this.state.wallReceivers.set(receiver.id, receiver);
  }

  private registerFoundryMessages() {
    this.onMessage('foundry.gather', (client, message: { nodeId?: string }) => {
      const nodeId = String(message?.nodeId || '');
      const node = this.state.wildNodes.get(nodeId);
      const player = this.state.players.get(client.sessionId);
      const cargo = this.getOrCreateCargo(client.sessionId);
      if (!node || !player || node.remaining <= 0) return;

      if (distancePx(player.x, player.y, node.x, node.y) > FOUNDRY_CONFIG.gatherRangePx) {
        return;
      }

      node.remaining = Math.max(0, node.remaining - GATHER_AMOUNT);

      if (node.veinType === 'yield') {
        cargo.fud += GATHER_AMOUNT;
        cargo.fomo += GATHER_AMOUNT;
        cargo.alpha += GATHER_AMOUNT;
        cargo.kek += GATHER_AMOUNT;
      } else if (node.veinType === 'desert_salvage') {
        cargo.salvageAntenna += GATHER_AMOUNT;
        cargo.salvageDish += GATHER_AMOUNT;
        cargo.salvageSlag += GATHER_AMOUNT;
      }
    });

    this.onMessage('foundry.deposit', (client) => {
      const player = this.state.players.get(client.sessionId);
      const cargo = this.getOrCreateCargo(client.sessionId);
      const receiver = this.state.wallReceivers.get(RECEIVER_ID);
      if (!player || !receiver) return;

      this.depositAlchemicaToTithe(cargo);
    });

    this.onMessage('foundry.placeAntenna', (client, message: { x?: number; y?: number }) => {
      if (typeof message?.x !== 'number' || typeof message?.y !== 'number') return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      const owned = this.countAntennasForSession(client.sessionId);
      if (owned >= FOUNDRY_CONFIG.maxAntennasPerPlayer) return;

      const antenna = new Antenna();
      antenna.id = `antenna-${++this.antennaSeq}`;
      antenna.ownerSessionId = client.sessionId;
      antenna.x = Math.round(message.x);
      antenna.y = Math.round(message.y);
      antenna.hp = 100;
      antenna.powered = true;
      this.state.antennas.set(antenna.id, antenna);
    });

    this.onMessage('foundry.bounceFreight', (client) => {
      const cargo = this.getOrCreateCargo(client.sessionId);
      this.depositAlchemicaToTithe(cargo);
    });

    this.onMessage(
      'foundry.damageAntenna',
      (client, message: { antennaId?: string; amount?: number }) => {
        const antennaId = String(message?.antennaId || '');
        const amount = Number(message?.amount ?? FOUNDRY_CONFIG.antennaDamagePerTick);
        const antenna = this.state.antennas.get(antennaId);
        if (!antenna || !Number.isFinite(amount) || amount <= 0) return;

        antenna.hp = Math.max(0, antenna.hp - amount);
        if (antenna.hp <= 0) {
          antenna.powered = false;
        }
      },
    );

    this.onMessage('foundry.meshTransfer', (client) => {
      const cargo = this.getOrCreateCargo(client.sessionId);
      const receiver = this.state.wallReceivers.get(RECEIVER_ID);
      if (!receiver) return;

      const antennas = Array.from(this.state.antennas.values()).map((a) => ({
        id: a.id,
        x: a.x,
        y: a.y,
        powered: a.powered,
        hp: a.hp,
      }));

      if (!canReachReceiver(antennas, receiver, FOUNDRY_CONFIG.antennaLinkRangePx)) {
        return;
      }

      const playerAntennas = Array.from(this.state.antennas.values()).filter(
        (a) => a.ownerSessionId === client.sessionId && a.powered && a.hp > 0,
      );
      if (playerAntennas.length === 0) return;

      this.depositAlchemicaToTithe(cargo);
    });
  }

  private factionTick() {
    const receiver = this.state.wallReceivers.get(RECEIVER_ID);
    if (!receiver) return;

    const active = Array.from(this.state.antennas.values()).filter((a) => a.powered && a.hp > 0);
    if (active.length === 0) return;

    let target: Antenna;

    if (Math.random() < 0.5) {
      const midCandidates = active.filter((a) => a.hp > 30);
      const pool = midCandidates.length > 0 ? midCandidates : active;
      target = pool[Math.floor(Math.random() * pool.length)];
    } else {
      target = active.reduce((farthest, antenna) => {
        const farthestDist = distancePx(farthest.x, farthest.y, receiver.x, receiver.y);
        const antennaDist = distancePx(antenna.x, antenna.y, receiver.x, receiver.y);
        return antennaDist > farthestDist ? antenna : farthest;
      });
    }

    target.hp = Math.max(0, target.hp - FOUNDRY_CONFIG.antennaDamagePerTick);
    if (target.hp <= 0) {
      target.powered = false;
    }
  }

  private getOrCreateCargo(sessionId: string): FoundryCargo {
    let cargo = this.state.cargos.get(sessionId);
    if (!cargo) {
      cargo = new FoundryCargo();
      cargo.sessionId = sessionId;
      this.state.cargos.set(sessionId, cargo);
    }
    return cargo;
  }

  private countAntennasForSession(sessionId: string): number {
    let count = 0;
    this.state.antennas.forEach((antenna) => {
      if (antenna.ownerSessionId === sessionId) count += 1;
    });
    return count;
  }

  private depositAlchemicaToTithe(cargo: FoundryCargo) {
    const total = cargo.fud + cargo.fomo + cargo.alpha + cargo.kek;
    if (total <= 0) return;

    cargo.titheAccrued += total;
    cargo.fud = 0;
    cargo.fomo = 0;
    cargo.alpha = 0;
    cargo.kek = 0;
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
    const spawn = spawnFromOptions(options?.spawnLocId);
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
    this.getOrCreateCargo(client.sessionId);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.state.cargos.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
    this.joinedAt.delete(client.sessionId);
    this.lastTeleportAt.delete(client.sessionId);

    const toRemove: string[] = [];
    this.state.antennas.forEach((antenna, id) => {
      if (antenna.ownerSessionId === client.sessionId) {
        toRemove.push(id);
      }
    });
    for (const id of toRemove) {
      this.state.antennas.delete(id);
    }
  }
}
