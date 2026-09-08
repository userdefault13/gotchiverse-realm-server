import { Router, Request, Response } from 'express';
import { matchMaker } from 'colyseus';
import { verifyMessage } from 'ethers';
import { env } from '../config/env';
import { buildSignMessage, consumeNonce, issueNonce, peekNonce } from '../auth/nonce';
import { signAuthToken } from '../auth/jwt';
import { queryLeaderboard } from '../leaderboard/store';

async function countRoomClients(roomName: string): Promise<number> {
  try {
    const rooms = await matchMaker.query({ name: roomName });
    return rooms.reduce((sum, room) => sum + (Number((room as { clients?: number }).clients) || 0), 0);
  } catch (e) {
    console.warn(`[users/online] count ${roomName}`, e);
    return 0;
  }
}

export function createHttpRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'gotchiverse-realm-server',
      map: 'citaadel',
      publicUrl: env.publicUrl,
      build: 'users-online-20260823',
      time: new Date().toISOString(),
    });
  });

  /** Live Colyseus CCU for landing "players online" counters (Base + RH). */
  router.get('/users/online', async (_req, res) => {
    const [citaadelCount, aarenaCount, aarenaRhCount] = await Promise.all([
      countRoomClients('citaadel'),
      countRoomClients('aarena'),
      countRoomClients('aarena-rh'),
    ]);
    res.json({
      count: citaadelCount + aarenaCount + aarenaRhCount,
      citaadelCount,
      aarenaCount,
      aarenaRhCount,
    });
  });

  /**
   * Soft stub — FE falls back to computeClientCombatTraits when empty.
   * Keeps /user/combat-traits from 404-spamming the console in local/dev.
   */
  router.get('/user/combat-traits', (_req, res) => {
    res.json({ data: { gotchis: {} } });
  });

  /**
   * Aarena leaderboard (soft-launch).
   * FE: in-game HUD + /leaderboard page → NEXT_PUBLIC_API_URL/leaderboard/all
   * Query: limit, offset, sortBy, sortType, filterBy, gotchi
   */
  router.get('/leaderboard/all', (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit);
      const offset = Number(req.query.offset);
      const sortBy = req.query.sortBy != null ? String(req.query.sortBy) : 'kills';
      const sortType = req.query.sortType != null ? String(req.query.sortType) : 'desc';
      const filterRaw = req.query.filterBy;
      const filterBy =
        filterRaw == null || filterRaw === 'undefined' || filterRaw === 'null'
          ? ''
          : String(filterRaw);
      const gotchiId =
        req.query.gotchi != null && String(req.query.gotchi) !== 'undefined'
          ? String(req.query.gotchi)
          : '';

      const { leaderboard, player, total } = queryLeaderboard({
        limit: Number.isFinite(limit) ? limit : 10,
        offset: Number.isFinite(offset) ? offset : 0,
        sortBy,
        sortType,
        filterBy,
        gotchiId,
      });

      res.json({
        leaderboard,
        player,
        gotchis: leaderboard,
        total,
        data: { leaderboard, player, total },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message, leaderboard: [], player: null });
    }
  });

  /** Foundry PoC probe — disabled stub so FE doesn't 404 when PoC isn't on this host. */
  router.get('/foundry/config', (_req, res) => {
    res.json({
      enableParcelFoundryPoC: false,
      antennaLinkRangePx: 8000,
      maxAntennasPerPlayer: 3,
      wildNodes: [],
      wallReceivers: [],
    });
  });

  router.get('/realm/config/list', (_req, res) => {
    res.json({
      data: {
        requireMetaMaskSign: true,
        maps: ['citaadel', 'aarena', 'aarena-rh'],
        netcode: 'colyseus',
        colyseusUrl: env.publicUrl,
        roomName: 'citaadel',
        // Keep false until AarenaRoom join is verified in prod, then flip true.
        combatIsLive: env.combatIsLive,
      },
    });
  });

  router.get('/user/nonce/get', (req: Request, res: Response) => {
    const address = String(req.query.address || '');
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({ error: 'Invalid address' });
      return;
    }
    const nonce = issueNonce(address);
    const message = buildSignMessage(address, nonce);
    // Flat fields match legacy Gotchiverse FE (signs `nonce` via signMessage).
    res.json({
      nonce,
      message,
      data: { nonce, message },
    });
  });

  router.get('/user/authtoken/get', async (req: Request, res: Response) => {
    try {
      const address = String(req.query.address || '');
      const signature = String(req.query.signature || '');
      const gotchiId = req.query.gotchiId ? String(req.query.gotchiId) : undefined;

      if (!/^0x[a-fA-F0-9]{40}$/.test(address) || !signature) {
        res.status(400).json({ error: 'address and signature are required' });
        return;
      }

      const nonce = peekNonce(address);
      if (!nonce) {
        res.status(400).json({ error: 'Nonce missing or expired; request a new nonce' });
        return;
      }

      // Legacy FE calls signer.signMessage(nonce). Also accept the structured message.
      let recovered: string;
      try {
        recovered = verifyMessage(nonce, signature);
      } catch {
        recovered = verifyMessage(buildSignMessage(address, nonce), signature);
      }
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        res.status(401).json({ error: 'Signature verification failed' });
        return;
      }

      if (!consumeNonce(address, nonce)) {
        res.status(400).json({ error: 'Nonce already used' });
        return;
      }

      const token = signAuthToken({ address, gotchiId });
      res.json({
        token,
        authToken: token,
        data: {
          authToken: token,
          token,
          address: address.toLowerCase(),
          gotchiId,
          expiresIn: env.jwtTtlSeconds,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(401).json({ error: message });
    }
  });

  /**
   * Base migration: equip/unequip no longer requires a REALM backend signer.
   * Return empty `0x` signatures so legacy FE clients that still call this
   * endpoint can batchEquip without crashing.
   */
  router.post('/realm/installation/signature/equip/get', (req: Request, res: Response) => {
    const { parcelId, gotchiId, itemId, x, y } = req.body || {};
    if (
      parcelId === undefined ||
      gotchiId === undefined ||
      itemId === undefined ||
      x === undefined ||
      y === undefined
    ) {
      res.status(400).json({ error: 'parcelId, gotchiId, itemId, x, y are required' });
      return;
    }
    res.json({
      signature: '0x',
      network: 'base',
      note: 'Empty signature for Base RealmDiamond equip/unequip',
      data: { parcelId, gotchiId, itemId, x, y },
    });
  });

  /**
   * Base migration: channelAlchemica / claimAvailableAlchemica accept empty `0x`.
   * Stub for FE clients that still hit the legacy signature endpoint.
   */
  router.post('/realm/alchemica/signature/channel/get', (req: Request, res: Response) => {
    const { parcelId, gotchiId, lastChanneled } = req.body || {};
    if (parcelId === undefined || gotchiId === undefined || lastChanneled === undefined) {
      res.status(400).json({ error: 'parcelId, gotchiId, lastChanneled are required' });
      return;
    }
    res.json({
      signature: '0x',
      network: 'base',
      note: 'Empty signature for Base RealmDiamond channel/claim',
      data: { parcelId, gotchiId, lastChanneled },
    });
  });

  /**
   * Compatibility shim for the legacy FE socket lookup.
   * Returns Colyseus endpoint info instead of a raw zone WebSocket URL.
   */
  router.get('/realm/socket', (req: Request, res: Response) => {
    const owner = String(req.query.owner || '');
    const gotchi = String(req.query.gotchi || '');
    const map = String(req.query.map || 'citaadel');
    const roomName = map === 'aarena' ? 'aarena' : 'citaadel';

    res.json({
      socketUrl: env.publicUrl,
      id: `${roomName}-0`,
      roomName,
      netcode: 'colyseus',
      owner,
      gotchi,
    });
  });

  return router;
}
