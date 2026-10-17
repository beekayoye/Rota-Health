import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AccessTokenClaims } from '../auth/jwt.js';
import { redis } from '../lib/redis.js';
import { prisma } from '../db/prisma.js';

export interface AuthenticatedUser {
  id: string;
  familyId: string;
  tokenVersion: number;
  name?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Missing or invalid Authorization header',
        details: {},
      },
    });
    return;
  }

  const token = authHeader.slice(7);
  let claims: AccessTokenClaims;

  try {
    claims = verifyAccessToken(token);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'TokenExpiredError') {
      res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token expired',
          details: {},
        },
      });
      return;
    }

    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid access token',
        details: {},
      },
    });
    return;
  }

  // PRD 15.1: Check token version against users.token_version cached in Redis at auth:tv:{userId} (TTL 60 s)
  const redisKey = `auth:tv:${claims.sub}`;
  let currentTv: number | null = null;

  try {
    const cachedTv = await redis.get(redisKey);
    if (cachedTv !== null) {
      currentTv = parseInt(cachedTv, 10);
    }
  } catch {
    // If Redis read fails, fall back to DB
  }

  if (currentTv === null) {
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { tokenVersion: true },
    });

    if (!user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'User not found',
          details: {},
        },
      });
      return;
    }

    const userTv = user.tokenVersion;
    currentTv = userTv;

    try {
      await redis.set(redisKey, userTv.toString(), 'EX', 60);
    } catch {
      // Ignore Redis cache failure
    }
  }

  if (currentTv === null || claims.tv !== currentTv) {
    res.status(401).json({
      error: {
        code: 'TOKEN_REVOKED',
        message: 'Token has been revoked',
        details: {},
      },
    });
    return;
  }

  req.user = {
    id: claims.sub,
    familyId: claims.sid,
    tokenVersion: claims.tv,
  };

  next();
}
