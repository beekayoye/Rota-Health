import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  resolveTeam,
  requireMembership,
  requireRole,
  requireSubscriptionState,
} from '../middleware/team.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { scheduleSwapExpiry } from '../queues/swap-expiry.js';
import { DateTime } from 'luxon';

export const swapRouter = Router();

const teamParamsSchema = z
  .object({
    teamId: z.string().uuid(),
  })
  .strict();

const swapParamsSchema = z
  .object({
    teamId: z.string().uuid(),
    swapId: z.string().uuid(),
  })
  .strict();

const swapsQuerySchema = z
  .object({
    box: z.enum(['incoming', 'outgoing', 'approval']),
  })
  .strict();

const createSwapSchema = z
  .object({
    requesterShiftId: z.string().uuid(),
    targetShiftId: z.string().uuid(),
  })
  .strict();

const reasonBodySchema = z
  .object({
    reason: z.string().max(280).optional(),
  })
  .strict();

// Helper to format swap response
async function formatSwap(swap: any) {
  const userIds = [swap.requesterId, swap.targetUserId];
  if (swap.decidedBy) userIds.push(swap.decidedBy);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return {
    id: swap.id,
    teamId: swap.teamId,
    requesterId: swap.requesterId,
    requester: userMap.get(swap.requesterId) || { id: swap.requesterId, name: 'Unknown' },
    targetUserId: swap.targetUserId,
    targetUser: userMap.get(swap.targetUserId) || { id: swap.targetUserId, name: 'Unknown' },
    requesterShiftId: swap.requesterShiftId,
    requesterShift: swap.requesterShift,
    targetShiftId: swap.targetShiftId,
    targetShift: swap.targetShift,
    status: swap.status,
    decidedBy: swap.decidedBy,
    decidedByUser: swap.decidedBy ? userMap.get(swap.decidedBy) || null : null,
    reason: swap.reason,
    createdAt: swap.createdAt.toISOString(),
    updatedAt: swap.updatedAt.toISOString(),
  };
}

// ------------------------------------------------------------------
// GET /v1/teams/:teamId/swaps?box=incoming|outgoing|approval
// ------------------------------------------------------------------
swapRouter.get(
  '/:teamId/swaps',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  validateQuery(swapsQuerySchema),
  async (req: Request, res: Response) => {
    const { box } = req.query as { box: 'incoming' | 'outgoing' | 'approval' };

    if (box === 'approval' && req.role === 'STAFF') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Staff members cannot access the approval box',
          details: {},
        },
      });
      return;
    }

    let whereClause: any = { teamId: req.teamId! };

    if (box === 'incoming') {
      whereClause.targetUserId = req.user!.id;
    } else if (box === 'outgoing') {
      whereClause.requesterId = req.user!.id;
    } else if (box === 'approval') {
      whereClause.status = 'ACCEPTED';
    }

    const swaps = await prisma.swapRequest.findMany({
      where: whereClause,
      include: {
        requesterShift: true,
        targetShift: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set([
        ...swaps.map((s) => s.requesterId),
        ...swaps.map((s) => s.targetUserId),
        ...swaps.map((s) => s.decidedBy).filter((id): id is string => Boolean(id)),
      ]),
    ];

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const formattedSwaps = swaps.map((swap) => ({
      id: swap.id,
      teamId: swap.teamId,
      requesterId: swap.requesterId,
      requester: userMap.get(swap.requesterId) || { id: swap.requesterId, name: 'Unknown' },
      targetUserId: swap.targetUserId,
      targetUser: userMap.get(swap.targetUserId) || { id: swap.targetUserId, name: 'Unknown' },
      requesterShiftId: swap.requesterShiftId,
      requesterShift: swap.requesterShift,
      targetShiftId: swap.targetShiftId,
      targetShift: swap.targetShift,
      status: swap.status,
      decidedBy: swap.decidedBy,
      decidedByUser: swap.decidedBy ? userMap.get(swap.decidedBy) || null : null,
      reason: swap.reason,
      createdAt: swap.createdAt.toISOString(),
      updatedAt: swap.updatedAt.toISOString(),
    }));

    res.status(200).json({ swaps: formattedSwaps });
  },
);

// ------------------------------------------------------------------
// GET /v1/teams/:teamId/swaps/:swapId
// ------------------------------------------------------------------
swapRouter.get(
  '/:teamId/swaps/:swapId',
  authenticate,
  validateParams(swapParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const swapId = req.params.swapId as string;

    const swap = await prisma.swapRequest.findFirst({
      where: {
        id: swapId,
        teamId: req.teamId!,
      },
      include: {
        requesterShift: true,
        targetShift: true,
      },
    });

    if (!swap) {
      res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap request not found',
          details: { swapId },
        },
      });
      return;
    }

    // Role check: Swap parties, Manager, Owner (Staff must be party to swap)
    const isParty = swap.requesterId === req.user!.id || swap.targetUserId === req.user!.id;
    if (req.role === 'STAFF' && !isParty) {
      res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap request not found',
          details: {},
        },
      });
      return;
    }

    const formatted = await formatSwap(swap);
    res.status(200).json({ swap: formatted });
  },
);

// ------------------------------------------------------------------
// POST /v1/teams/:teamId/swaps (Member; Idempotent)
// ------------------------------------------------------------------
swapRouter.post(
  '/:teamId/swaps',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  requireIdempotency,
  validateBody(createSwapSchema),
  async (req: Request, res: Response) => {
    const { requesterShiftId, targetShiftId } = req.body as {
      requesterShiftId: string;
      targetShiftId: string;
    };

    if (requesterShiftId === targetShiftId) {
      res.status(409).json({
        error: {
          code: 'SWAP_INVALID',
          message: 'Cannot swap a shift with itself',
          details: {},
        },
      });
      return;
    }

    const [requesterShift, targetShift] = await Promise.all([
      prisma.shift.findFirst({
        where: { id: requesterShiftId, teamId: req.teamId! },
      }),
      prisma.shift.findFirst({
        where: { id: targetShiftId, teamId: req.teamId! },
      }),
    ]);

    if (!requesterShift || !targetShift) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'One or both shifts not found in this clinic',
          details: {},
        },
      });
      return;
    }

    // Both shifts must be PUBLISHED
    if (requesterShift.status !== 'PUBLISHED' || targetShift.status !== 'PUBLISHED') {
      res.status(409).json({
        error: {
          code: 'SWAP_INVALID',
          message: 'Both shifts must be published to request a swap',
          details: {},
        },
      });
      return;
    }

    const now = new Date();
    // Both shifts must start in the future
    if (requesterShift.startsAt <= now || targetShift.startsAt <= now) {
      res.status(409).json({
        error: {
          code: 'SWAP_INVALID',
          message: 'Both shifts must start in the future to request a swap',
          details: {},
        },
      });
      return;
    }

    // Requester must own the first shift
    if (requesterShift.assigneeId !== req.user!.id) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only request swaps for shifts assigned to you',
          details: {},
        },
      });
      return;
    }

    // Target must own the second shift (cannot swap with own other shift)
    if (targetShift.assigneeId === req.user!.id) {
      res.status(409).json({
        error: {
          code: 'SWAP_INVALID',
          message: 'Target shift is already assigned to you',
          details: {},
        },
      });
      return;
    }

    const targetUserId = targetShift.assigneeId;

    // Check no open swap on either shift
    const existingOpenSwap = await prisma.swapRequest.findFirst({
      where: {
        teamId: req.teamId!,
        status: { in: ['REQUESTED', 'ACCEPTED'] },
        OR: [
          { requesterShiftId },
          { targetShiftId },
          { requesterShiftId: targetShiftId },
          { targetShiftId: requesterShiftId },
        ],
      },
    });

    if (existingOpenSwap) {
      res.status(409).json({
        error: {
          code: 'SWAP_OPEN_EXISTS',
          message: 'An open swap already exists for one of the shifts',
          details: { openSwapId: existingOpenSwap.id },
        },
      });
      return;
    }

    // Check no overlap would result:
    // 1. Requester taking targetShift: does targetShift overlap with any other shift of requester?
    const requesterClash = await prisma.shift.findFirst({
      where: {
        teamId: req.teamId!,
        assigneeId: req.user!.id,
        id: { not: requesterShiftId },
        startsAt: { lt: targetShift.endsAt },
        endsAt: { gt: targetShift.startsAt },
      },
    });

    if (requesterClash) {
      res.status(409).json({
        error: {
          code: 'SWAP_INVALID',
          message: 'Swap would cause a shift clash for the requester',
          details: { clashingShiftId: requesterClash.id },
        },
      });
      return;
    }

    // 2. Target taking requesterShift: does requesterShift overlap with any other shift of target?
    const targetClash = await prisma.shift.findFirst({
      where: {
        teamId: req.teamId!,
        assigneeId: targetUserId,
        id: { not: targetShiftId },
        startsAt: { lt: requesterShift.endsAt },
        endsAt: { gt: requesterShift.startsAt },
      },
    });

    if (targetClash) {
      res.status(409).json({
        error: {
          code: 'SWAP_INVALID',
          message: 'Swap would cause a shift clash for the target',
          details: { clashingShiftId: targetClash.id },
        },
      });
      return;
    }

    try {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { name: true },
      });
      const targetUserName = targetUser?.name || 'Colleague';
      const actorName = req.user!.name || 'Staff';
      const clinicZone = req.team!.timeZone || 'Africa/Lagos';
      const shiftTime = DateTime.fromJSDate(targetShift.startsAt, { zone: clinicZone }).toFormat('ccc HH:mm');

      const swap = await prisma.$transaction(async (tx) => {
        const created = await tx.swapRequest.create({
          data: {
            teamId: req.teamId!,
            requesterId: req.user!.id,
            targetUserId,
            requesterShiftId,
            targetShiftId,
            status: 'REQUESTED',
          },
          include: {
            requesterShift: true,
            targetShift: true,
          },
        });

        await tx.activity.create({
          data: {
            teamId: req.teamId!,
            type: 'swap.requested',
            actorId: req.user!.id,
            subjectId: created.id,
            payload: {
              actorName,
              summary: `${actorName} asked ${targetUserName} to swap ${shiftTime}`,
              subjectType: 'swap',
              swapId: created.id,
              requesterId: req.user!.id,
              targetUserId,
              requesterShiftId,
              targetShiftId,
            },
          },
        });

        await tx.outboxEvent.create({
          data: {
            teamId: req.teamId!,
            kind: 'notify',
            payload: {
              type: 'swap.requested',
              refId: created.id,
              teamId: req.teamId!,
              userIds: [targetUserId],
              version: 1,
              requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
            },
          },
        });

        return created;
      });

      // Schedule delayed BullMQ expiry job
      const earliestStartsAt =
        requesterShift.startsAt < targetShift.startsAt
          ? requesterShift.startsAt
          : targetShift.startsAt;
      await scheduleSwapExpiry(swap.id, earliestStartsAt);

      const formatted = await formatSwap(swap);
      res.status(201).json({ swap: formatted });
    } catch (err: any) {
      // Prisma unique violation code for partial indexes one_open_swap_req / one_open_swap_tgt
      if (err.code === 'P2002') {
        res.status(409).json({
          error: {
            code: 'SWAP_OPEN_EXISTS',
            message: 'An open swap already exists for one of the shifts',
            details: {},
          },
        });
        return;
      }
      throw err;
    }
  },
);

// ------------------------------------------------------------------
// POST /v1/teams/:teamId/swaps/:swapId/accept (Target only)
// ------------------------------------------------------------------
swapRouter.post(
  '/:teamId/swaps/:swapId/accept',
  authenticate,
  validateParams(swapParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const swapId = req.params.swapId as string;

    const swap = await prisma.swapRequest.findFirst({
      where: {
        id: swapId,
        teamId: req.teamId!,
      },
    });

    if (!swap) {
      res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap not found',
          details: {},
        },
      });
      return;
    }

    if (swap.targetUserId !== req.user!.id) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the target of the swap can accept it',
          details: {},
        },
      });
      return;
    }

    let updatedSwap: any = null;
    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.swapRequest.updateMany({
        where: {
          id: swapId,
          teamId: req.teamId!,
          status: 'REQUESTED',
        },
        data: {
          status: 'ACCEPTED',
        },
      });

      if (updateResult.count === 0) {
        return;
      }

      updatedSwap = await tx.swapRequest.findUnique({
        where: { id: swapId },
        include: { requesterShift: true, targetShift: true },
      });

      const actorName = req.user!.name || 'Staff';
      const managersAndOwner = await tx.membership.findMany({
        where: {
          teamId: req.teamId!,
          status: 'ACTIVE',
          role: { in: ['MANAGER', 'OWNER'] },
        },
        select: { userId: true },
      });
      const managerAndOwnerUserIds = managersAndOwner.map((m) => m.userId);

      await tx.outboxEvent.create({
        data: {
          teamId: req.teamId!,
          kind: 'notify',
          payload: {
            type: 'swap.accepted',
            refId: swapId,
            teamId: req.teamId!,
            userIds: managerAndOwnerUserIds,
            version: 2,
            requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
          },
        },
      });
    });

    if (!updatedSwap) {
      res.status(409).json({
        error: {
          code: 'SWAP_STATE_CHANGED',
          message: 'Swap status has already changed',
          details: {},
        },
      });
      return;
    }

    const formatted = await formatSwap(updatedSwap);
    res.status(200).json({ swap: formatted });
  },
);

// ------------------------------------------------------------------
// POST /v1/teams/:teamId/swaps/:swapId/decline (Target only)
// ------------------------------------------------------------------
swapRouter.post(
  '/:teamId/swaps/:swapId/decline',
  authenticate,
  validateParams(swapParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  validateBody(reasonBodySchema),
  async (req: Request, res: Response) => {
    const swapId = req.params.swapId as string;
    const { reason } = req.body as { reason?: string };

    const swap = await prisma.swapRequest.findFirst({
      where: {
        id: swapId,
        teamId: req.teamId!,
      },
    });

    if (!swap) {
      res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap not found',
          details: {},
        },
      });
      return;
    }

    if (swap.targetUserId !== req.user!.id) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the target of the swap can decline it',
          details: {},
        },
      });
      return;
    }

    let updatedSwap: any = null;
    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.swapRequest.updateMany({
        where: {
          id: swapId,
          teamId: req.teamId!,
          status: 'REQUESTED',
        },
        data: {
          status: 'DECLINED',
          reason: reason || null,
        },
      });

      if (updateResult.count === 0) {
        return;
      }

      updatedSwap = await tx.swapRequest.findUnique({
        where: { id: swapId },
        include: { requesterShift: true, targetShift: true },
      });

      const actorName = req.user!.name || 'Staff';
      await tx.outboxEvent.create({
        data: {
          teamId: req.teamId!,
          kind: 'notify',
          payload: {
            type: 'swap.decided',
            refId: swapId,
            teamId: req.teamId!,
            userIds: [swap.requesterId, swap.targetUserId],
            version: 2,
            requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
          },
        },
      });
    });

    if (!updatedSwap) {
      res.status(409).json({
        error: {
          code: 'SWAP_STATE_CHANGED',
          message: 'Swap status has already changed',
          details: {},
        },
      });
      return;
    }

    const formatted = await formatSwap(updatedSwap);
    res.status(200).json({ swap: formatted });
  },
);

// ------------------------------------------------------------------
// POST /v1/teams/:teamId/swaps/:swapId/cancel (Requester only)
// ------------------------------------------------------------------
swapRouter.post(
  '/:teamId/swaps/:swapId/cancel',
  authenticate,
  validateParams(swapParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const swapId = req.params.swapId as string;

    const swap = await prisma.swapRequest.findFirst({
      where: {
        id: swapId,
        teamId: req.teamId!,
      },
    });

    if (!swap) {
      res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap not found',
          details: {},
        },
      });
      return;
    }

    if (swap.requesterId !== req.user!.id) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the requester can cancel the swap',
          details: {},
        },
      });
      return;
    }

    let updatedSwap: any = null;
    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.swapRequest.updateMany({
        where: {
          id: swapId,
          teamId: req.teamId!,
          status: { in: ['REQUESTED', 'ACCEPTED'] },
        },
        data: {
          status: 'CANCELLED',
        },
      });

      if (updateResult.count === 0) {
        return;
      }

      updatedSwap = await tx.swapRequest.findUnique({
        where: { id: swapId },
        include: { requesterShift: true, targetShift: true },
      });

      const actorName = req.user!.name || 'Staff';
      await tx.outboxEvent.create({
        data: {
          teamId: req.teamId!,
          kind: 'notify',
          payload: {
            type: 'swap.decided',
            refId: swapId,
            teamId: req.teamId!,
            userIds: [swap.requesterId, swap.targetUserId],
            version: 2,
            requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
          },
        },
      });
    });

    if (!updatedSwap) {
      res.status(409).json({
        error: {
          code: 'SWAP_STATE_CHANGED',
          message: 'Swap status has already changed or cannot be cancelled',
          details: {},
        },
      });
      return;
    }

    const formatted = await formatSwap(updatedSwap);
    res.status(200).json({ swap: formatted });
  },
);

// ------------------------------------------------------------------
// POST /v1/teams/:teamId/swaps/:swapId/approve (Owner, Manager; Idempotent)
// ------------------------------------------------------------------
swapRouter.post(
  '/:teamId/swaps/:swapId/approve',
  authenticate,
  validateParams(swapParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  requireIdempotency,
  async (req: Request, res: Response) => {
    const swapId = req.params.swapId as string;

    const swap = await prisma.swapRequest.findFirst({
      where: {
        id: swapId,
        teamId: req.teamId!,
      },
    });

    if (!swap) {
      res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap not found',
          details: {},
        },
      });
      return;
    }

    // A Manager cannot approve a swap they are party to (PRD 6.4 & PRD 7)
    if (
      req.role === 'MANAGER' &&
      (swap.requesterId === req.user!.id || swap.targetUserId === req.user!.id)
    ) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Managers cannot approve swaps they are party to',
          details: {},
        },
      });
      return;
    }

    // Must be in ACCEPTED state
    if (swap.status !== 'ACCEPTED') {
      res.status(409).json({
        error: {
          code: 'SWAP_STATE_CHANGED',
          message: `Swap cannot be approved from status ${swap.status}`,
          details: { currentStatus: swap.status },
        },
      });
      return;
    }

    try {
      let finalSwap: any = null;

      await prisma.$transaction(async (tx) => {
        // 1. Lock both shift rows FOR UPDATE
        await tx.$queryRawUnsafe(
          'SELECT id FROM shifts WHERE id IN ($1::uuid, $2::uuid) FOR UPDATE',
          swap.requesterShiftId,
          swap.targetShiftId,
        );

        // 2. Re-check swap status in transaction
        const freshSwap = await tx.swapRequest.findUnique({
          where: { id: swapId },
        });

        if (!freshSwap || freshSwap.status !== 'ACCEPTED') {
          throw new Error('SWAP_STATE_CHANGED');
        }

        // 3. Fetch current state of shifts
        const s1 = await tx.shift.findUnique({
          where: { id: swap.requesterShiftId },
        });
        const s2 = await tx.shift.findUnique({
          where: { id: swap.targetShiftId },
        });

        if (!s1 || !s2) {
          throw new Error('SWAP_STALE');
        }

        // Check if stale: both must still be PUBLISHED, assignees must still match original, start times in future
        const now = new Date();
        if (
          s1.status !== 'PUBLISHED' ||
          s2.status !== 'PUBLISHED' ||
          s1.assigneeId !== swap.requesterId ||
          s2.assigneeId !== swap.targetUserId ||
          s1.startsAt <= now ||
          s2.startsAt <= now
        ) {
          throw new Error('SWAP_STALE');
        }

        // 4. Re-check overlaps!
        // Requester taking s2: does s2 overlap with any shift of requester (except s1)?
        const requesterClash = await tx.shift.findFirst({
          where: {
            teamId: req.teamId!,
            assigneeId: swap.requesterId,
            id: { not: s1.id },
            startsAt: { lt: s2.endsAt },
            endsAt: { gt: s2.startsAt },
          },
        });

        if (requesterClash) {
          throw new Error('SHIFT_OVERLAP');
        }

        // Target taking s1: does s1 overlap with any shift of target (except s2)?
        const targetClash = await tx.shift.findFirst({
          where: {
            teamId: req.teamId!,
            assigneeId: swap.targetUserId,
            id: { not: s2.id },
            startsAt: { lt: s1.endsAt },
            endsAt: { gt: s1.startsAt },
          },
        });

        if (targetClash) {
          throw new Error('SHIFT_OVERLAP');
        }

        // 5. Conditional update on swap: status -> APPROVED
        const updateResult = await tx.swapRequest.updateMany({
          where: {
            id: swapId,
            teamId: req.teamId!,
            status: 'ACCEPTED',
          },
          data: {
            status: 'APPROVED',
            decidedBy: req.user!.id,
          },
        });

        if (updateResult.count === 0) {
          throw new Error('SWAP_STATE_CHANGED');
        }

        // 6. Swap assignees on both shifts, increment versions
        await tx.shift.update({
          where: { id: s1.id },
          data: {
            assigneeId: swap.targetUserId,
            version: { increment: 1 },
          },
        });

        await tx.shift.update({
          where: { id: s2.id },
          data: {
            assigneeId: swap.requesterId,
            version: { increment: 1 },
          },
        });

        // 7. Write activity swap.approved
        const actorName = req.user!.name || 'Manager';
        await tx.activity.create({
          data: {
            teamId: req.teamId!,
            type: 'swap.approved',
            actorId: req.user!.id,
            subjectId: swapId,
            payload: {
              actorName,
              summary: `${actorName} approved the swap`,
              subjectType: 'swap',
              swapId,
              requesterId: swap.requesterId,
              targetUserId: swap.targetUserId,
              requesterShiftId: s1.id,
              targetShiftId: s2.id,
            },
          },
        });

        await tx.outboxEvent.create({
          data: {
            teamId: req.teamId!,
            kind: 'notify',
            payload: {
              type: 'swap.decided',
              refId: swap.id,
              teamId: req.teamId!,
              userIds: [swap.requesterId, swap.targetUserId],
              version: 3,
              requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
            },
          },
        });

        finalSwap = await tx.swapRequest.findUnique({
          where: { id: swapId },
          include: { requesterShift: true, targetShift: true },
        });
      });

      const formatted = await formatSwap(finalSwap);
      res.status(200).json({ swap: formatted });
    } catch (err: any) {
      if (err.message === 'SWAP_STATE_CHANGED') {
        res.status(409).json({
          error: {
            code: 'SWAP_STATE_CHANGED',
            message: 'Swap has already been approved or modified',
            details: {},
          },
        });
        return;
      }
      if (err.message === 'SWAP_STALE') {
        res.status(409).json({
          error: {
            code: 'SWAP_STALE',
            message: 'One or both shifts have changed or started',
            details: {},
          },
        });
        return;
      }
      if (err.message === 'SHIFT_OVERLAP') {
        res.status(409).json({
          error: {
            code: 'SHIFT_OVERLAP',
            message: 'Swap cannot be approved because it would cause a shift clash',
            details: {},
          },
        });
        return;
      }
      throw err;
    }
  },
);

// ------------------------------------------------------------------
// POST /v1/teams/:teamId/swaps/:swapId/reject (Owner, Manager)
// ------------------------------------------------------------------
swapRouter.post(
  '/:teamId/swaps/:swapId/reject',
  authenticate,
  validateParams(swapParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  validateBody(reasonBodySchema),
  async (req: Request, res: Response) => {
    const swapId = req.params.swapId as string;
    const { reason } = req.body as { reason?: string };

    const swap = await prisma.swapRequest.findFirst({
      where: {
        id: swapId,
        teamId: req.teamId!,
      },
    });

    if (!swap) {
      res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap not found',
          details: {},
        },
      });
      return;
    }

    // A Manager cannot reject a swap they are party to (PRD 6.4 & PRD 7)
    if (
      req.role === 'MANAGER' &&
      (swap.requesterId === req.user!.id || swap.targetUserId === req.user!.id)
    ) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Managers cannot reject swaps they are party to',
          details: {},
        },
      });
      return;
    }

    let updatedSwap: any = null;
    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.swapRequest.updateMany({
        where: {
          id: swapId,
          teamId: req.teamId!,
          status: 'ACCEPTED',
        },
        data: {
          status: 'REJECTED',
          reason: reason || null,
          decidedBy: req.user!.id,
        },
      });

      if (updateResult.count === 0) {
        return;
      }

      updatedSwap = await tx.swapRequest.findUnique({
        where: { id: swapId },
        include: { requesterShift: true, targetShift: true },
      });

      const actorName = req.user!.name || 'Manager';
      await tx.outboxEvent.create({
        data: {
          teamId: req.teamId!,
          kind: 'notify',
          payload: {
            type: 'swap.decided',
            refId: swapId,
            teamId: req.teamId!,
            userIds: [swap.requesterId, swap.targetUserId],
            version: 3,
            requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
          },
        },
      });
    });

    if (!updatedSwap) {
      res.status(409).json({
        error: {
          code: 'SWAP_STATE_CHANGED',
          message: 'Swap status has already changed or is not awaiting approval',
          details: {},
        },
      });
      return;
    }

    const formatted = await formatSwap(updatedSwap);
    res.status(200).json({ swap: formatted });
  },
);
