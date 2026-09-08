import { Room, Client } from 'colyseus';
import { Player } from '../schema/Player';
import { isAarenaBlocked, resolveAarenaMove, randomAarenaSpawn } from '../maps/aarenaCollisions';
import { env } from '../config/env';
import { creditCartridgePocket } from '../prize/creditPocket';
import {
  AttackKind,
  COMBAT_CONFIG,
  CombatProfile,
  apCostFor,
  resolveCombatProfile,
  rollDamage,
  parseJoinTraits,
} from './combatStats';
import { leaderboardRecordHit, leaderboardRecordKo } from '../leaderboard/store';

type CombatIntent = {
  hand?: string;
  direction?: { x?: number; y?: number };
  chargeDuration?: number;
  /** Client sprite origin — snap server here before rush so dash ends match prediction. */
  x?: number;
  y?: number;
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
  kind: AttackKind;
};

type ActiveMelee = {
  id: string;
  ownerSessionId: string;
  expiresAt: number;
  /** Sessions already damaged by this melee instance. */
  hitSessions: Set<string>;
  kind: AttackKind;
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
  players: {
    get: (id: string) => Player | undefined;
    forEach: (cb: (player: Player, sessionId: string) => void) => void;
  };
};

export type CombatHandle = {
  /** Apply trait combat profile after join (powers, regen, intervals). */
  setProfile: (sessionId: string, profile: CombatProfile) => void;
  /** Drop combat entities owned by a leaving client. */
  onPlayerLeave: (sessionId: string) => void;
  /** True while this session is mid-rush (rooms should ignore walk moves). */
  isRushing: (sessionId: string) => boolean;
  /** Cancel an in-progress rush so settle / leave can apply immediately. */
  cancelRush: (sessionId: string) => void;
  dispose: () => void;
};

export type CombatRegisterOpts = {
  /** Enable HP damage + KO (both aarena rooms). */
  enableDamage?: boolean;
  /** Room id fragment for prize refIds. */
  roomKey?: string;
  /** Credit NVDA pocket on KO (RH only). */
  awardPrizes?: boolean;
};

/** Same ballpark as AarenaRoom rushSettle — walk+dash desync from plaza spawn. */
const MAX_ORIGIN_SNAP_PX = 24 * 64 * 2 + 256;

const WALK_SPEED = 220;
const MISSILE_SPEED = WALK_SPEED * 3.5;
const MISSILE_CHARGED_SPEED = WALK_SPEED * 5;
/** Dash feel — legacy rushSpeed (112) is too slow for charge-preview distances. */
const RUSH_SPEED = 720;
const SLAP_SIZE = 64;
const MISSILE_SIZE = 24;
const PLAYER_HIT_RADIUS = 40;
const DEFAULT_ATTACK_COOLDOWN_MS = 180;
const SLAP_TTL_MS = 450;
const MISSILE_TTL_MS = 2200;
const TICK_MS = 50;
/** Matches FE charge tail: maxRushDistance * GOTCHI_SIZE.UNIT */
const MAX_RUSH_DISTANCE_PX = 24 * 64;
const MAX_RUSH_CHARGE_S = 2;
const RESPAWN_MS = 2500;

function normalizeDir(x: number, y: number): { x: number; y: number } | null {
  const len = Math.hypot(x, y);
  if (!Number.isFinite(len) || len < 0.001) return null;
  return {
    x: Math.round((x / len) * 1000) / 1000,
    y: Math.round((y / len) * 1000) / 1000,
  };
}

function rushDistancePx(chargeDuration: number): number {
  const t = Math.min(Math.max(chargeDuration, 0), MAX_RUSH_CHARGE_S);
  // Tiny positive charge still dashes a bit; full charge → max distance.
  const fraction = Math.max(t / MAX_RUSH_CHARGE_S, 0.08);
  return fraction * MAX_RUSH_DISTANCE_PX;
}

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function baselineProfile(): CombatProfile {
  return resolveCombatProfile(parseJoinTraits(null));
}

/**
 * Validate fire/melee intents and broadcast legacy-shaped enter/positions/leave
 * payloads. When enableDamage: trait damage, AP spend/regen, KO (+ optional prizes).
 */
export function registerCombatMessages(
  room: Room<CombatRoomState>,
  opts: CombatRegisterOpts = {},
): CombatHandle {
  const enableDamage = Boolean(opts.enableDamage);
  const awardPrizes = Boolean(opts.awardPrizes);
  const roomKey = opts.roomKey || room.roomId || 'aarena';
  const lastMeleeAt = new Map<string, number>();
  const lastFireAt = new Map<string, number>();
  const profiles = new Map<string, CombatProfile>();
  const missiles = new Map<string, ActiveMissile>();
  const melees = new Map<string, ActiveMelee>();
  const rushes = new Map<string, ActiveRush>();
  /** attackerAddr:victimAddr → last credit ms */
  const pairLastCredit = new Map<string, number>();
  /** `${day}:${addr}` → count */
  const dailyCredits = new Map<string, number>();
  const invulnerableUntil = new Map<string, number>();
  let seq = 0;
  let koSeq = 0;

  const nextId = (gotchiId: string, kind: 'melee' | 'missile') => {
    seq += 1;
    return kind === 'melee' ? `${gotchiId}_${seq}` : `${gotchiId}#${seq}`;
  };

  const profileOf = (sessionId: string): CombatProfile =>
    profiles.get(sessionId) || baselineProfile();

  const cooldownOk = (sessionId: string, kind: 'melee' | 'fire'): boolean => {
    const now = Date.now();
    const profile = profileOf(sessionId);
    const minMs =
      kind === 'melee'
        ? profile.minMeleeInterval || DEFAULT_ATTACK_COOLDOWN_MS
        : profile.minFireInterval || DEFAULT_ATTACK_COOLDOWN_MS;
    const map = kind === 'melee' ? lastMeleeAt : lastFireAt;
    const prev = map.get(sessionId) || 0;
    if (now - prev < minMs) return false;
    if (rushes.has(sessionId)) return false;
    const player = room.state.players.get(sessionId);
    if (player && player.hp <= 0) return false;
    return true;
  };

  const markAttack = (sessionId: string, kind: 'melee' | 'fire') => {
    const now = Date.now();
    if (kind === 'melee') lastMeleeAt.set(sessionId, now);
    else lastFireAt.set(sessionId, now);
  };

  /** Soft AP gate — returns false without freezing input; notifies client. */
  const trySpendAp = (client: Client, kind: AttackKind): boolean => {
    const player = room.state.players.get(client.sessionId);
    if (!player) return false;
    const profile = profileOf(client.sessionId);
    const cost = apCostFor(kind, profile);
    if (player.ap < cost) {
      client.send('combat.ap_denied', {
        kind,
        ap: player.ap,
        maxAp: player.maxAp,
        cost,
        message: 'Not enough stamina',
      });
      return false;
    }
    player.ap = Math.max(0, player.ap - cost);
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

  const canAwardPrize = (attacker: Player, victim: Player): boolean => {
    if (!awardPrizes) return false;
    const a = (attacker.address || '').toLowerCase();
    const v = (victim.address || '').toLowerCase();
    if (!a || !v || a === v) return false;
    const now = Date.now();
    const pairKey = `${a}:${v}`;
    const last = pairLastCredit.get(pairKey) || 0;
    if (now - last < env.rhKoPairCooldownMs) return false;
    const dayKey = `${utcDayKey()}:${a}`;
    const count = dailyCredits.get(dayKey) || 0;
    if (count >= env.rhKoMaxCreditsPerDay) return false;
    return true;
  };

  const markPrizeAwarded = (attacker: Player, victim: Player) => {
    const a = (attacker.address || '').toLowerCase();
    const v = (victim.address || '').toLowerCase();
    pairLastCredit.set(`${a}:${v}`, Date.now());
    const dayKey = `${utcDayKey()}:${a}`;
    dailyCredits.set(dayKey, (dailyCredits.get(dayKey) || 0) + 1);
  };

  const applyHit = (
    attackerSessionId: string,
    victimSessionId: string,
    kind: AttackKind,
  ) => {
    if (!enableDamage) return;
    if (attackerSessionId === victimSessionId) return;
    const now = Date.now();
    if ((invulnerableUntil.get(victimSessionId) || 0) > now) return;

    const attacker = room.state.players.get(attackerSessionId);
    const victim = room.state.players.get(victimSessionId);
    if (!attacker || !victim) return;
    // Never self-damage: same session, same gotchi, or same wallet (ghost reconnects).
    if (String(attacker.gotchiId || '') && String(attacker.gotchiId) === String(victim.gotchiId)) return;
    const atkAddr = (attacker.address || '').toLowerCase();
    const vicAddr = (victim.address || '').toLowerCase();
    if (atkAddr && vicAddr && atkAddr === vicAddr) return;
    if (victim.hp <= 0 || attacker.hp <= 0) return;

    const atkProfile = profileOf(attackerSessionId);
    const vicProfile = profileOf(victimSessionId);
    const { damage, evaded } = rollDamage(kind, atkProfile, vicProfile);

    if (!evaded) {
      victim.hp = Math.max(0, victim.hp - damage);
      leaderboardRecordHit({
        attackerGotchiId: attacker.gotchiId,
        victimGotchiId: victim.gotchiId,
        damage,
        attackerName: attacker.name,
        victimName: victim.name,
        attackerAddress: attacker.address,
        victimAddress: victim.address,
      });
    }

    room.broadcast('combat.hit', {
      attackerSessionId,
      victimSessionId,
      attackerGotchiId: attacker.gotchiId,
      victimGotchiId: victim.gotchiId,
      hp: victim.hp,
      maxHp: victim.maxHp,
      damage: evaded ? 0 : damage,
      evaded,
      kind,
    });

    if (evaded || victim.hp > 0) return;

    leaderboardRecordKo({
      attackerGotchiId: attacker.gotchiId,
      victimGotchiId: victim.gotchiId,
      attackerName: attacker.name,
      victimName: victim.name,
      attackerAddress: attacker.address,
      victimAddress: victim.address,
    });

    koSeq += 1;
    const refId = `ko:${roomKey}:${koSeq}:${attacker.gotchiId}:${victim.gotchiId}`;
    invulnerableUntil.set(victimSessionId, now + RESPAWN_MS + 500);

    let prizeAmount: string | null = null;
    let prizeSkipped: string | null = null;
    if (awardPrizes) {
      if (canAwardPrize(attacker, victim) && attacker.cartridgeId) {
        prizeAmount = env.rhKoPrizeAmount;
        markPrizeAwarded(attacker, victim);
        void creditCartridgePocket({
          cartridgeId: attacker.cartridgeId,
          amount: prizeAmount,
          refId,
          reason: 'aarena-rh-ko',
        }).then((result) => {
          if (!result.ok) {
            const client = room.clients.find((c: Client) => c.sessionId === attackerSessionId);
            client?.send('combat.prize', { ok: false, error: result.error, refId });
          }
        });
      } else if (!attacker.cartridgeId) {
        prizeSkipped = 'no_cartridge';
      } else {
        prizeSkipped = 'capped_or_cooldown';
      }
    }

    room.broadcast('combat.ko', {
      attackerSessionId,
      victimSessionId,
      attackerGotchiId: attacker.gotchiId,
      victimGotchiId: victim.gotchiId,
      prizeAmount,
      prizeToken: prizeAmount ? 'nvda' : null,
      prizeSkipped,
      refId,
      respawnMs: RESPAWN_MS,
    });

    if (awardPrizes) {
      if (attacker.cartridgeId && prizeAmount) {
        const atkClient = room.clients.find((c: Client) => c.sessionId === attackerSessionId);
        atkClient?.send('combat.prize', {
          ok: true,
          amount: prizeAmount,
          token: 'nvda',
          cartridgeId: attacker.cartridgeId,
          refId,
        });
      } else if (prizeSkipped === 'no_cartridge') {
        const atkClient = room.clients.find((c: Client) => c.sessionId === attackerSessionId);
        atkClient?.send('combat.prize', {
          ok: false,
          error: 'no_cartridge',
          message: 'Mint or bind an Aarcade cartridge to earn NVDA pocket prizes.',
        });
      }
    }

    setTimeout(() => {
      const p = room.state.players.get(victimSessionId);
      if (!p) return;
      const spawn = randomAarenaSpawn();
      const profile = profileOf(victimSessionId);
      p.x = spawn.x;
      p.y = spawn.y;
      p.maxHp = profile.maxHp;
      p.maxAp = profile.maxAp;
      p.hp = profile.maxHp;
      p.ap = profile.maxAp;
      room.broadcast('combat.respawn', {
        sessionId: victimSessionId,
        gotchiId: p.gotchiId,
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: p.maxHp,
        ap: p.ap,
        maxAp: p.maxAp,
      });
    }, RESPAWN_MS);
  };

  const tryMeleeHits = () => {
    if (!enableDamage) return;
    melees.forEach((melee) => {
      const owner = room.state.players.get(melee.ownerSessionId);
      if (!owner || owner.hp <= 0) return;
      const radius = SLAP_SIZE / 2 + PLAYER_HIT_RADIUS;
      room.state.players.forEach((other: Player, sessionId: string) => {
        if (sessionId === melee.ownerSessionId) return;
        if (melee.hitSessions.has(sessionId)) return;
        if (other.hp <= 0) return;
        const dist = Math.hypot(other.x - owner.x, other.y - owner.y);
        if (dist <= radius) {
          melee.hitSessions.add(sessionId);
          applyHit(melee.ownerSessionId, sessionId, melee.kind);
        }
      });
    });
  };

  const tryMissileHits = (leaveMissiles: { id: string; destroyed: boolean }[]) => {
    if (!enableDamage) return;
    missiles.forEach((m, id) => {
      const owner = room.state.players.get(m.ownerSessionId);
      if (!owner || owner.hp <= 0) return;
      const radius = MISSILE_SIZE / 2 + PLAYER_HIT_RADIUS;
      let hit = false;
      room.state.players.forEach((other: Player, sessionId: string) => {
        if (hit || sessionId === m.ownerSessionId) return;
        if (other.hp <= 0) return;
        const dist = Math.hypot(other.x - m.x, other.y - m.y);
        if (dist <= radius) {
          hit = true;
          applyHit(m.ownerSessionId, sessionId, m.kind);
          leaveMissiles.push({ id, destroyed: true });
          missiles.delete(id);
        }
      });
    });
  };

  room.onMessage('combat.melee', (client: Client, message: CombatIntent) => {
    try {
      const player = room.state.players.get(client.sessionId);
      if (!player) return;
      if (!cooldownOk(client.sessionId, 'melee')) return;

      const dir = normalizeDir(Number(message?.direction?.x), Number(message?.direction?.y));
      if (!dir) return;

      const chargeDuration = Number(message?.chargeDuration) || 0;
      const isRush = chargeDuration > 0;
      const kind: AttackKind = isRush ? 'rush' : 'slap';
      if (!trySpendAp(client, kind)) return;
      markAttack(client.sessionId, 'melee');

      // Align server with client sprite before rush — walk clamp often leaves server at plaza.
      const originX = Number(message?.x);
      const originY = Number(message?.y);
      if (Number.isFinite(originX) && Number.isFinite(originY)) {
        const dist = Math.hypot(originX - player.x, originY - player.y);
        if (dist <= MAX_ORIGIN_SNAP_PX && !isAarenaBlocked(originX, originY)) {
          player.x = Math.round(originX);
          player.y = Math.round(originY);
        }
      }

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
        hitSessions: new Set(),
        kind,
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
    } catch (e) {
      console.warn('[combat.melee]', e);
    }
  });

  room.onMessage('combat.fire', (client: Client, message: CombatIntent) => {
    try {
      const player = room.state.players.get(client.sessionId);
      if (!player) return;
      if (!cooldownOk(client.sessionId, 'fire')) return;

      const dir = normalizeDir(Number(message?.direction?.x), Number(message?.direction?.y));
      if (!dir) return;

      const chargeDuration = Number(message?.chargeDuration) || 0;
      const isCharged = chargeDuration > 0;
      const kind: AttackKind = isCharged ? 'snipe' : 'ranged';
      if (!trySpendAp(client, kind)) return;
      markAttack(client.sessionId, 'fire');

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
        kind,
      });
    } catch (e) {
      console.warn('[combat.fire]', e);
    }
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
      if (player.hp <= 0) {
        rushes.delete(sessionId);
        return;
      }
      const step = Math.min(rush.remaining, rush.speed * dt);
      rush.remaining -= step;
      const next = resolveAarenaMove(player.x, player.y, player.x + rush.dirX * step, player.y + rush.dirY * step);
      player.x = next.x;
      player.y = next.y;
      // Stop dash into solids so rushes don't tunnel through walls.
      if (next.blocked || rush.remaining <= 0) rushes.delete(sessionId);
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

    tryMeleeHits();
    tryMissileHits(leaveMissiles);

    // HP / AP regen while alive
    if (enableDamage && COMBAT_CONFIG.enableHealthRegen) {
      room.state.players.forEach((player: Player, sessionId: string) => {
        if (player.hp <= 0) return;
        const profile = profileOf(sessionId);
        if (profile.healthRegen > 0 && player.hp < player.maxHp) {
          player.hp = Math.min(player.maxHp, player.hp + profile.healthRegen * dt);
        }
        if (profile.apRegen > 0 && player.ap < player.maxAp) {
          player.ap = Math.min(player.maxAp, player.ap + profile.apRegen * dt);
        }
      });
    }

    if (moved.length) {
      room.broadcast('combat.positions', { missile: moved });
    }
    broadcastLeave(leaveMissiles, leaveMelees);
  }, TICK_MS);

  return {
    setProfile(sessionId: string, profile: CombatProfile) {
      profiles.set(sessionId, profile);
    },
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
      lastMeleeAt.delete(sessionId);
      lastFireAt.delete(sessionId);
      profiles.delete(sessionId);
      invulnerableUntil.delete(sessionId);
      broadcastLeave(leaveMissiles, leaveMelees);
    },
    isRushing(sessionId: string) {
      return rushes.has(sessionId);
    },
    cancelRush(sessionId: string) {
      rushes.delete(sessionId);
    },
    dispose() {
      clearInterval(interval);
      missiles.clear();
      melees.clear();
      rushes.clear();
      lastMeleeAt.clear();
      lastFireAt.clear();
      profiles.clear();
      invulnerableUntil.clear();
    },
  };
}
