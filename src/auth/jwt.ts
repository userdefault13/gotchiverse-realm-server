import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export type AuthClaims = {
  address: string;
  gotchiId?: string;
  /** Agent as Player: set when the signer was admitted for an aCartridge (see agent/acartridge). */
  agentId?: string;
  /** The agent's account address (owns its cartridges); `address` stays the signing key. */
  account?: string;
  /** Cartridge the agent plays this realm with. */
  cartridgeId?: string;
};

export function signAuthToken(claims: AuthClaims): string {
  return jwt.sign(
    {
      address: claims.address.toLowerCase(),
      gotchiId: claims.gotchiId,
      agentId: claims.agentId,
      account: claims.account,
      cartridgeId: claims.cartridgeId,
    },
    env.jwtSecret,
    { expiresIn: env.jwtTtlSeconds },
  );
}

export function verifyAuthToken(token: string): AuthClaims {
  const payload = jwt.verify(token, env.jwtSecret) as AuthClaims & { address: string };
  if (!payload?.address) {
    throw new Error('Invalid token payload');
  }
  return {
    address: payload.address.toLowerCase(),
    gotchiId: payload.gotchiId,
    agentId: payload.agentId,
    account: payload.account,
    cartridgeId: payload.cartridgeId,
  };
}
