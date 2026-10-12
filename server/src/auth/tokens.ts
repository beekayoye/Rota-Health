import { randomBytes, createHash } from 'node:crypto';

export function generateRefreshToken(): string {
  // 32 random bytes, base64url encoded (PRD 15.1)
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  // SHA-256 hash stored in DB (PRD 15.1)
  return createHash('sha256').update(token).digest('hex');
}

export function getRefreshTokenExpiry(): Date {
  // 30 days expiry (PRD 15.1)
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}
