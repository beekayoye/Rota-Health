import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const JWT_SECRET = config.JWT_SECRET;

export interface AccessTokenClaims {
  sub: string; // user ID
  sid: string; // refresh token family ID
  tv: number; // token version
  iat: number;
  exp: number;
}

export function signAccessToken(payload: {
  userId: string;
  familyId: string;
  tokenVersion: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: Omit<AccessTokenClaims, 'exp'> & { exp: number } = {
    sub: payload.userId,
    sid: payload.familyId,
    tv: payload.tokenVersion,
    iat: now,
    exp: now + 900, // 15 minutes (900 seconds)
  };

  return jwt.sign(claims, JWT_SECRET, {
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
  }) as AccessTokenClaims;
}
