import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { hashPassword, verifyPassword } from '../auth/argon2.js';
import { signAccessToken } from '../auth/jwt.js';
import { generateRefreshToken, hashRefreshToken, getRefreshTokenExpiry } from '../auth/tokens.js';
import { validateBody } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';

export const authRouter = Router();

// Zod schemas with strict() per PRD 10
const registerSchema = z
  .object({
    email: z
      .string()
      .email()
      .transform((val) => val.trim().toLowerCase()),
    password: z.string().min(10).max(128),
    name: z.string().min(1).max(80),
    deviceId: z.string().uuid(),
  })
  .strict();

const loginSchema = z
  .object({
    email: z
      .string()
      .email()
      .transform((val) => val.trim().toLowerCase()),
    password: z.string(),
    deviceId: z.string().uuid(),
  })
  .strict();

const refreshSchema = z
  .object({
    refreshToken: z.string().min(1),
    deviceId: z.string().uuid(),
  })
  .strict();

const logoutSchema = z
  .object({
    deviceId: z.string().uuid(),
  })
  .strict();

const logoutAllSchema = z.object({}).strict();

// POST /v1/auth/register
authRouter.post('/register', validateBody(registerSchema), async (req: Request, res: Response) => {
  const { email, password, name, deviceId } = req.body;

  // Check unique email
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    res.status(409).json({
      error: {
        code: 'EMAIL_TAKEN',
        message: 'A user with this email already exists',
        details: {},
      },
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  const familyId = randomUUID();
  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const expiresAt = getRefreshTokenExpiry();
  const now = new Date();

  // Create user and default settings in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        tokenVersion: 0,
      },
    });

    await tx.userSettings.create({
      data: {
        userId: user.id,
        quietHoursUpdatedAt: now,
        timeZoneAt: now,
        notifyShiftsAt: now,
        notifySwapsAt: now,
        notifyBillingAt: now,
        languageAt: now,
        themeAt: now,
      },
    });

    await tx.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash,
        deviceId,
        expiresAt,
      },
    });

    return user;
  });

  const accessToken = signAccessToken({
    userId: result.id,
    familyId,
    tokenVersion: 0,
  });

  res.status(201).json({
    user: {
      id: result.id,
      email: result.email,
      name: result.name,
    },
    accessToken,
    refreshToken: rawRefreshToken,
  });
});

// POST /v1/auth/login
authRouter.post('/login', validateBody(loginSchema), async (req: Request, res: Response) => {
  const { email, password, deviceId } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  // PRD 6.1: Dummy password verification for unknown email timing defense
  const passwordValid = await verifyPassword(password, user ? user.passwordHash : null);

  if (!user || !passwordValid) {
    res.status(401).json({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        details: {},
      },
    });
    return;
  }

  const familyId = randomUUID();
  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const expiresAt = getRefreshTokenExpiry();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId,
      tokenHash,
      deviceId,
      expiresAt,
    },
  });

  const accessToken = signAccessToken({
    userId: user.id,
    familyId,
    tokenVersion: user.tokenVersion,
  });

  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    accessToken,
    refreshToken: rawRefreshToken,
  });
});

// POST /v1/auth/refresh
authRouter.post('/refresh', validateBody(refreshSchema), async (req: Request, res: Response) => {
  const { refreshToken, deviceId } = req.body;
  const tokenHash = hashRefreshToken(refreshToken);

  const existingToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  const now = new Date();

  // If not found or expired
  if (!existingToken || existingToken.expiresAt <= now) {
    res.status(401).json({
      error: {
        code: 'REFRESH_EXPIRED',
        message: 'Refresh token is expired or invalid',
        details: {},
      },
    });
    return;
  }

  // PRD 15.2: If usedAt or revokedAt is set, this is token reuse!
  if (existingToken.usedAt !== null || existingToken.revokedAt !== null) {
    logger.warn(
      {
        userId: existingToken.userId,
        familyId: existingToken.familyId,
        ip: req.ip,
      },
      'auth.refresh_reused: Token reuse detected, revoking token family',
    );

    // Revoke every token in the family
    await prisma.refreshToken.updateMany({
      where: { familyId: existingToken.familyId },
      data: { revokedAt: now },
    });

    res.status(401).json({
      error: {
        code: 'REFRESH_REUSED',
        message: 'Refresh token has already been used. Session family revoked.',
        details: {},
      },
    });
    return;
  }

  // PRD 15.2: Valid rotation in transaction
  const newRawRefreshToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRawRefreshToken);
  const newExpiresAt = getRefreshTokenExpiry();

  const user = await prisma.$transaction(async (tx) => {
    // Mark current token as used
    await tx.refreshToken.update({
      where: { id: existingToken.id },
      data: { usedAt: now },
    });

    // Insert new token into same family
    await tx.refreshToken.create({
      data: {
        userId: existingToken.userId,
        familyId: existingToken.familyId,
        tokenHash: newTokenHash,
        deviceId,
        expiresAt: newExpiresAt,
      },
    });

    return tx.user.findUniqueOrThrow({
      where: { id: existingToken.userId },
      select: { id: true, tokenVersion: true },
    });
  });

  const accessToken = signAccessToken({
    userId: user.id,
    familyId: existingToken.familyId,
    tokenVersion: user.tokenVersion,
  });

  res.status(200).json({
    accessToken,
    refreshToken: newRawRefreshToken,
  });
});

// POST /v1/auth/logout
authRouter.post(
  '/logout',
  authenticate,
  validateBody(logoutSchema),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const familyId = req.user!.familyId;
    const { deviceId } = req.body;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Revoke this family's tokens
      await tx.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: now },
      });

      // Delete push device row for this device
      await tx.device.deleteMany({
        where: { userId, id: deviceId },
      });
    });

    res.status(204).send();
  },
);

// POST /v1/auth/logout-all
authRouter.post(
  '/logout-all',
  authenticate,
  validateBody(logoutAllSchema),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Revoke all refresh tokens for the user
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });

      // Increment users.token_version
      await tx.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      });

      // Delete all devices
      await tx.device.deleteMany({
        where: { userId },
      });
    });

    // Delete cached token version in Redis
    try {
      await redis.del(`auth:tv:${userId}`);
    } catch {
      // Redis deletion best effort
    }

    res.status(204).send();
  },
);
