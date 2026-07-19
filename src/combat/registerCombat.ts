import { Room, Client } from 'colyseus';
import { Player } from '../schema/Player';
import { AARENA_BOUNDS } from '../config/env';

type CombatIntent = {
  hand?: string;
  direction?: { x?: number; y?: number };
  chargeDuration?: number;
};

type ActiveMissile = {
  id: string;
  ownerSessionId: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  expiresAt: number;
};

type ActiveMelee = {
  id: string;
  ownerSessionId: string;
  expiresAt: number;
};

/** Authoritative dash while a charged melee rush is active. */
type ActiveRush = {
  sessionId: string;
  dirX: number;
  dirY: number;
  speed: number;
  remaining: number;
  expiresAt: number;
};

type CombatRoomState = {
  players: { get: (id: string) => Player | undefined };
};

export type CombatHandle = {
  /** Drop combat entities owned by a leaving client. */
  onPlayerLeave: (sessionId: string) => void;
  /** True while this session is mid-rush (rooms should ignore walk moves). */
  isRushing: (sessionId: string) => boolean;
  dispose: () => void;
};

const WALK_SPEED = 220;
const MISSILE_SPEED = WALK_SPEED * 3.5;
const MISSILE_CHARGED_SPEED = WALK_SPEED * 5;
/** Dash feel — legacy rushSpeed (112) is too slow for charge-preview distances. */
const RUSH_SPEED = 720;
const SLAP_SIZE = 64;
const MISSILE_SIZE = 24;
const ATTACK_COOLDOWN_MS = 180;
const SLAP_TTL_MS = 450;
const MISSILE_TTL_MS = 2200;
const TICK_MS = 50;
/** Matches FE charge tail: maxRushDistance * GOTCHI_SIZE.UNIT */
const MAX_RUSH_DISTANCE_PX = 24 * 64;
const MAX_RUSH_CHARGE_S = 2;

function normalizeDir(x: number, y: number): { x: number; y: number } | null {
  const len = Math.hypot(x, y);
  if (!Number.isFinite(len) || len < 0.001) return null;
  return {
    x: Math.round((x / len) * 1000) / 1000,
    y: Math.round((y / len) * 1000) / 1000,
  };
}

function clampMap(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(Math.min(AARENA_BOUNDS.maxX, Math.max(AARENA_BOUNDS.minX, x))),
    y: Math.round(Math.min(AARENA_BOUNDS.maxY, Math.max(AARENA_BOUNDS.minY, y))),
  };
}

function rushDistancePx(chargeDuration: number): number {
  const t = Math.min(Math.max(chargeDuration, 0), MAX_RUSH_CHARGE_S);
  // Tiny positive charge still dashes a bit; full charge → max distance.
  const fraction = Math.max(t / MAX_RUSH_CHARGE_S, 0.08);
  return fraction * MAX_RUSH_DISTANCE_PX;
}

/**
 * Visual combat MVP: validate fire/melee intents and broadcast legacy-shaped
 * enter/positions/leave payloads so the FE can reuse Melee/Missiles Phaser code.
 * Rush also moves the owning Player along the attack direction.
 * Damage / collisions deferred.
 */
export function registerCombatMessages(room: Room<CombatRoomState>): CombatHandle {
  const lastAttackAt = new Map<string, number>();
  const missiles = new Map<string, ActiveMissile>();
  const melees = new Map<string, ActiveMelee>();
  const rushes = new Map<string, ActiveRush>();
  let seq = 0;

  const nextId = (gotchiId: string, kind: 'melee' | 'missile') => {
    seq += 1;
    return kind === 'melee' ? `${gotchiId}_${seq}` : `${gotchiId}#${seq}`;
  };

  const canAttack = (sessionId: string): boolean => {
    const now = Date.now();
    const prev = lastAttackAt.get(sessionId) || 0;
    if (now - prev < ATTACK_COOLDOWN_MS) return false;
    if (rushes.has(sessionId)) return false;
    lastAttackAt.set(sessionId, now);
    return true;
  };

  const broadcastLeave = (
    leaveMissiles: { id: string; destroyed: boolean }[],
    leaveMelees: { id: string; destroyed: boolean }[],
  ) => {
    if (!leaveMissiles.length && !leaveMelees.length) return;
    room.broadcast('combat.leave', {
      ...(leaveMissiles.length ? { missile: leaveMissiles } : {}),
      ...(leaveMelees.length ? { melee: leaveMelees } : {}),
    });
  };

  room.onMessage('combat.melee', (client: Client, message: CombatIntent) => {
    const player = room.state.players.get(client.sessionId);
    if (!player) return;
    if (!canAttack(client.sessionId)) return;

    const dir = normalizeDir(Number(message?.direction?.x), Number(message?.direction?.y));
    if (!dir) return;

    const chargeDuration = Number(message?.chargeDuration) || 0;
    const isRush = chargeDuration > 0;
    const id = nextId(player.gotchiId, 'melee');
    const distance = isRush ? rushDistancePx(chargeDuration) : 0;
    const rushTtl = isRush ? Math.max(200, Math.round((distance / RUSH_SPEED) * 1000)) : SLAP_TTL_MS;

    room.broadcast('combat.enter', {
      melee: [
        {
          id,
          x: Math.round(player.x),
          y: Math.round(player.y),
          size: SLAP_SIZE,
          isRush,
          direction: dir,
          created: true,
          distance: Math.round(distance),
          speed: RUSH_SPEED,
        },
      ],
    });

    melees.set(id, {
      id,
      ownerSessionId: client.sessionId,
      expiresAt: Date.now() + rushTtl,
    });

    if (isRush && distance > 0) {
      rushes.set(client.sessionId, {
        sessionId: client.sessionId,
        dirX: dir.x,
        dirY: dir.y,
        speed: RUSH_SPEED,
        remaining: distance,
        expiresAt: Date.now() + rushTtl,
      });
    }
  });

  room.onMessage('combat.fire', (client: Client, message: CombatIntent) => {
    const player = room.state.players.get(client.sessionId);
    if (!player) return;
    if (!canAttack(client.sessionId)) return;

    const dir = normalizeDir(Number(message?.direction?.x), Number(message?.direction?.y));
    if (!dir) return;

    const chargeDuration = Number(message?.chargeDuration) || 0;
    const isCharged = chargeDuration > 0;
    const id = nextId(player.gotchiId, 'missile');
    const muzzle = 30;
    const x = player.x + dir.x * muzzle;
    const y = player.y + dir.y * muzzle;
    const speed = isCharged ? MISSILE_CHARGED_SPEED : MISSILE_SPEED;

    room.broadcast('combat.enter', {
      missile: [
        {
          id,
          x: Math.round(x),
          y: Math.round(y),
          size: MISSILE_SIZE,
          isCharged,
          direction: dir,
        },
      ],
    });

    missiles.set(id, {
      id,
      ownerSessionId: client.sessionId,
      x,
      y,
      dirX: dir.x,
      dirY: dir.y,
      speed,
      expiresAt: Date.now() + MISSILE_TTL_MS,
    });
  });

  const interval = setInterval(() => {
    const now = Date.now();
    const dt = TICK_MS / 1000;
    const moved: { id: string; x: number; y: number }[] = [];
    const leaveMissiles: { id: string; destroyed: boolean }[] = [];
    const leaveMelees: { id: string; destroyed: boolean }[] = [];

    rushes.forEach((rush, sessionId) => {
      const player = room.state.players.get(sessionId);
      if (!player || now >= rush.expiresAt || rush.remaining <= 0) {
        rushes.delete(sessionId);
        return;
      }
      const step = Math.min(rush.remaining, rush.speed * dt);
      rush.remaining -= step;
      const next = clampMap(player.x + rush.dirX * step, player.y + rush.dirY * step);
      player.x = next.x;
      player.y = next.y;
      if (rush.remaining <= 0) rushes.delete(sessionId);
    });

    missiles.forEach((m, id) => {
      if (now >= m.expiresAt) {
        leaveMissiles.push({ id, destroyed: true });
        missiles.delete(id);
        return;
      }
      m.x += m.dirX * m.speed * dt;
      m.y += m.dirY * m.speed * dt;
      moved.push({ id, x: Math.round(m.x), y: Math.round(m.y) });
    });

    melees.forEach((m, id) => {
      if (now >= m.expiresAt) {
        leaveMelees.push({ id, destroyed: true });
        melees.delete(id);
      }
    });

    if (moved.length) {
      room.broadcast('combat.positions', { missile: moved });
    }
    broadcastLeave(leaveMissiles, leaveMelees);
  }, TICK_MS);

  return {
    onPlayerLeave(sessionId: string) {
      const leaveMissiles: { id: string; destroyed: boolean }[] = [];
      const leaveMelees: { id: string; destroyed: boolean }[] = [];
      missiles.forEach((m, id) => {
        if (m.ownerSessionId === sessionId) {
          leaveMissiles.push({ id, destroyed: true });
          missiles.delete(id);
        }
      });
      melees.forEach((m, id) => {
        if (m.ownerSessionId === sessionId) {
          leaveMelees.push({ id, destroyed: true });
          melees.delete(id);
        }
      });
      rushes.delete(sessionId);
      lastAttackAt.delete(sessionId);
      broadcastLeave(leaveMissiles, leaveMelees);
    },
    isRushing(sessionId: string) {
      return rushes.has(sessionId);
    },
    dispose() {
      clearInterval(interval);
      missiles.clear();
      melees.clear();
      rushes.clear();
      lastAttackAt.clear();
    },
  };
}
