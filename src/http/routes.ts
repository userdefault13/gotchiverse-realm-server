import { Router, Request, Response } from 'express';
import { verifyMessage } from 'ethers';
import { env } from '../config/env';
import { buildSignMessage, consumeNonce, issueNonce, peekNonce } from '../auth/nonce';
import { signAuthToken } from '../auth/jwt';

export function createHttpRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'gotchiverse-realm-server',
      map: 'citaadel',
      publicUrl: env.publicUrl,
      build: 'aarena-rh-ko-20260726',
      time: new Date().toISOString(),
    });
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
