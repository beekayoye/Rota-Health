import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';

export const meRouter = Router();

const deviceParamsSchema = z
  .object({
    deviceId: z.string().uuid(),
  })
  .strict();

const deviceBodySchema = z
  .object({
    expoPushToken: z.string().startsWith('ExponentPushToken['),
    platform: z.literal('android'),
  })
  .strict();

// GET /v1/me
meRouter.get('/', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });

  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  res.status(200).json({
    user,
    clinics: memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      timeZone: m.team.timeZone,
      role: m.role,
    })),
  });
});

const upcomingShiftsQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(14).default(14),
  })
  .strict();

// GET /v1/me/shifts/upcoming?days=14
meRouter.get('/shifts/upcoming', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const parsed = upcomingShiftsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid query parameters',
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  const days = parsed.data.days;
  const now = new Date();
  const futureLimit = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Find all active memberships of this user
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
    },
    select: { teamId: true },
  });

  const activeTeamIds = memberships.map((m) => m.teamId);

  const shifts = await prisma.shift.findMany({
    where: {
      teamId: { in: activeTeamIds },
      assigneeId: userId,
      status: 'PUBLISHED',
      startsAt: { gte: now, lte: futureLimit },
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
    },
    orderBy: { startsAt: 'asc' },
  });

  res.status(200).json({
    shifts: shifts.map((s) => ({
      id: s.id,
      teamId: s.teamId,
      clinicName: s.team.name,
      team: {
        id: s.team.id,
        name: s.team.name,
        timeZone: s.team.timeZone,
      },
      assigneeId: s.assigneeId,
      position: s.position,
      notes: s.notes,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: s.status,
      publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
      version: s.version,
    })),
  });
});

// PUT /v1/me/devices/:deviceId
meRouter.put(
  '/devices/:deviceId',
  authenticate,
  validateParams(deviceParamsSchema),
  validateBody(deviceBodySchema),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const deviceId = req.params.deviceId as string;
    const { expoPushToken, platform } = req.body;
    const now = new Date();

    // PRD 12.5: Replace any older row with same expoPushToken or same deviceId
    await prisma.$transaction(async (tx) => {
      await tx.device.deleteMany({
        where: {
          OR: [{ id: deviceId }, { expoPushToken }],
        },
      });

      await tx.device.create({
        data: {
          id: deviceId,
          userId,
          expoPushToken,
          platform,
          lastSeenAt: now,
        },
      });
    });

    res.status(204).send();
  },
);

// DELETE /v1/me/devices/:deviceId
meRouter.delete(
  '/devices/:deviceId',
  authenticate,
  validateParams(deviceParamsSchema),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const deviceId = req.params.deviceId as string;

    await prisma.device.deleteMany({
      where: {
        id: deviceId,
        userId,
      },
    });

    res.status(204).send();
  },
);
