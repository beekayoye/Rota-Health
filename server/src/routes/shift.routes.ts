import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
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

export const shiftRouter = Router();

const teamParamsSchema = z
  .object({
    teamId: z.string().uuid(),
  })
  .strict();

const shiftParamsSchema = z
  .object({
    teamId: z.string().uuid(),
    shiftId: z.string().uuid(),
  })
  .strict();

const weekQuerySchema = z
  .object({
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  })
  .strict();

const createShiftSchema = z
  .object({
    assigneeId: z.string().uuid(),
    position: z.string().min(1).max(40),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    notes: z.string().max(500).optional().nullable(),
  })
  .strict();

const patchShiftSchema = z
  .object({
    assigneeId: z.string().uuid().optional(),
    position: z.string().min(1).max(40).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    notes: z.string().max(500).optional().nullable(),
    version: z.number().int().min(1),
  })
  .strict();

const publishShiftsSchema = z
  .object({
    shiftIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();

// ------------------------------------------------------------------
// GET /v1/teams/:teamId/shifts?weekStart=YYYY-MM-DD
// ------------------------------------------------------------------
shiftRouter.get(
  '/:teamId/shifts',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  validateQuery(weekQuerySchema),
  async (req: Request, res: Response) => {
    const { weekStart } = req.query as { weekStart: string };
    const clinicZone = req.team!.timeZone || 'Africa/Lagos';

    const parsedWeek = DateTime.fromISO(weekStart, { zone: clinicZone });
    if (!parsedWeek.isValid) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid weekStart date',
          details: { weekStart },
        },
      });
      return;
    }

    // ISO week: starts Monday 00:00:00, ends Sunday 23:59:59.999
    const startOfWeek = parsedWeek.startOf('week');
    const endOfWeek = parsedWeek.endOf('week');

    const startUtc = startOfWeek.toUTC().toJSDate();
    const endUtc = endOfWeek.toUTC().toJSDate();

    const isStaff = req.role === 'STAFF';

    const shifts = await prisma.shift.findMany({
      where: {
        teamId: req.teamId!,
        startsAt: { lt: endUtc },
        endsAt: { gt: startUtc },
        ...(isStaff ? { status: 'PUBLISHED' } : {}),
      },
      include: {
        assignee: {
          select: {
            id: true,
            userId: true,
            role: true,
          },
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    // Populate user names and emails
    const userIds = Array.from(new Set<string>(shifts.map((s: any) => s.assigneeId)));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map<string, { id: string; name: string; email: string }>(
      users.map((u: { id: string; name: string; email: string }) => [u.id, u]),
    );

    const formattedShifts = shifts.map((s: any) => {
      const u = userMap.get(s.assigneeId);
      return {
        id: s.id,
        teamId: s.teamId,
        assigneeId: s.assigneeId,
        assignee: {
          id: s.assignee.id,
          userId: s.assignee.userId,
          name: u?.name || 'Unknown',
          email: u?.email || '',
          role: s.assignee.role,
        },
        position: s.position,
        notes: s.notes,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        status: s.status,
        publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
        version: s.version,
        createdBy: s.createdBy,
        updatedAt: s.updatedAt.toISOString(),
      };
    });

    res.status(200).json({
      shifts: formattedShifts,
      weekStart: startOfWeek.toISODate(),
      weekEnd: endOfWeek.toISODate(),
      timeZone: clinicZone,
    });
  },
);

// ------------------------------------------------------------------
// GET /v1/teams/:teamId/shifts/:shiftId
// ------------------------------------------------------------------
shiftRouter.get(
  '/:teamId/shifts/:shiftId',
  authenticate,
  validateParams(shiftParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const shiftId = req.params.shiftId as string;

    const shift = await prisma.shift.findFirst({
      where: {
        id: shiftId,
        teamId: req.teamId!,
      },
      include: {
        assignee: {
          select: {
            id: true,
            userId: true,
            role: true,
          },
        },
      },
    });

    // Staff only ever see PUBLISHED shifts
    if (!shift || (req.role === 'STAFF' && shift.status !== 'PUBLISHED')) {
      res.status(404).json({
        error: {
          code: 'SHIFT_NOT_FOUND',
          message: 'This shift was removed or not found',
          details: { shiftId },
        },
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: shift.assigneeId },
      select: { name: true, email: true },
    });

    res.status(200).json({
      shift: {
        id: shift.id,
        teamId: shift.teamId,
        assigneeId: shift.assigneeId,
        assignee: {
          id: shift.assignee.id,
          userId: shift.assignee.userId,
          name: user?.name || 'Unknown',
          email: user?.email || '',
          role: shift.assignee.role,
        },
        position: shift.position,
        notes: shift.notes,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        status: shift.status,
        publishedAt: shift.publishedAt ? shift.publishedAt.toISOString() : null,
        version: shift.version,
        createdBy: shift.createdBy,
        updatedAt: shift.updatedAt.toISOString(),
      },
    });
  },
);

// ------------------------------------------------------------------
// POST /v1/teams/:teamId/shifts (Owner, Manager)
// ------------------------------------------------------------------
shiftRouter.post(
  '/:teamId/shifts',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  validateBody(createShiftSchema),
  async (req: Request, res: Response) => {
    const { assigneeId, position, startsAt, endsAt, notes } = req.body;

    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);

    // Rule: endsAt must be after startsAt (400)
    if (endDate <= startDate) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'endsAt must be after startsAt',
          details: { startsAt, endsAt },
        },
      });
      return;
    }

    // Rule: Shift is at most 24 hours (400)
    const durationHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    if (durationHours > 24) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Shift duration cannot exceed 24 hours',
          details: { durationHours },
        },
      });
      return;
    }

    // Rule: Assignee must be an active member (422 ASSIGNEE_NOT_MEMBER)
    const membership = await prisma.membership.findUnique({
      where: {
        teamId_userId: {
          teamId: req.teamId!,
          userId: assigneeId,
        },
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      res.status(422).json({
        error: {
          code: 'ASSIGNEE_NOT_MEMBER',
          message: 'Assignee is not an active member of this clinic',
          details: { assigneeId },
        },
      });
      return;
    }

    // Rule: No overlapping shifts for the same person within this clinic (409 SHIFT_OVERLAP)
    const overlappingCount = await prisma.shift.count({
      where: {
        teamId: req.teamId!,
        assigneeId,
        startsAt: { lt: endDate },
        endsAt: { gt: startDate },
      },
    });

    if (overlappingCount > 0) {
      res.status(409).json({
        error: {
          code: 'SHIFT_OVERLAP',
          message: 'Assignee already has an overlapping shift during this time',
          details: { assigneeId, startsAt, endsAt },
        },
      });
      return;
    }

    const shift = await prisma.shift.create({
      data: {
        teamId: req.teamId!,
        assigneeId,
        position,
        startsAt: startDate,
        endsAt: endDate,
        notes: notes || null,
        status: 'DRAFT',
        version: 1,
        createdBy: req.user!.id,
      },
    });

    res.status(201).json({
      shift: {
        id: shift.id,
        teamId: shift.teamId,
        assigneeId: shift.assigneeId,
        position: shift.position,
        notes: shift.notes,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        status: shift.status,
        publishedAt: null,
        version: shift.version,
        createdBy: shift.createdBy,
        updatedAt: shift.updatedAt.toISOString(),
      },
    });
  },
);

// ------------------------------------------------------------------
// PATCH /v1/teams/:teamId/shifts/:shiftId (Owner, Manager)
// ------------------------------------------------------------------
shiftRouter.patch(
  '/:teamId/shifts/:shiftId',
  authenticate,
  validateParams(shiftParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  validateBody(patchShiftSchema),
  async (req: Request, res: Response) => {
    const shiftId = req.params.shiftId as string;
    const { assigneeId, position, startsAt, endsAt, notes, version } = req.body;

    const existingShift = await prisma.shift.findFirst({
      where: {
        id: shiftId,
        teamId: req.teamId!,
      },
    });

    if (!existingShift) {
      res.status(404).json({
        error: {
          code: 'SHIFT_NOT_FOUND',
          message: 'Shift not found',
          details: { shiftId },
        },
      });
      return;
    }

    // Rule: PATCH with an old version returns 409 VERSION_CONFLICT
    if (existingShift.version !== version) {
      res.status(409).json({
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Shift was modified by another request. Please refresh and try again.',
          details: { currentVersion: existingShift.version, providedVersion: version },
        },
      });
      return;
    }

    const nextAssigneeId = assigneeId ?? existingShift.assigneeId;
    const nextStartDate = startsAt ? new Date(startsAt) : existingShift.startsAt;
    const nextEndDate = endsAt ? new Date(endsAt) : existingShift.endsAt;

    if (nextEndDate <= nextStartDate) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'endsAt must be after startsAt',
          details: { startsAt: nextStartDate, endsAt: nextEndDate },
        },
      });
      return;
    }

    const durationHours = (nextEndDate.getTime() - nextStartDate.getTime()) / (1000 * 60 * 60);
    if (durationHours > 24) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Shift duration cannot exceed 24 hours',
          details: { durationHours },
        },
      });
      return;
    }

    // If assignee changed, verify active membership
    if (assigneeId && assigneeId !== existingShift.assigneeId) {
      const membership = await prisma.membership.findUnique({
        where: {
          teamId_userId: {
            teamId: req.teamId!,
            userId: assigneeId,
          },
        },
      });

      if (!membership || membership.status !== 'ACTIVE') {
        res.status(422).json({
          error: {
            code: 'ASSIGNEE_NOT_MEMBER',
            message: 'Assignee is not an active member of this clinic',
            details: { assigneeId },
          },
        });
        return;
      }
    }

    // Check overlap excluding current shift
    const overlappingCount = await prisma.shift.count({
      where: {
        teamId: req.teamId!,
        assigneeId: nextAssigneeId,
        id: { not: shiftId },
        startsAt: { lt: nextEndDate },
        endsAt: { gt: nextStartDate },
      },
    });

    if (overlappingCount > 0) {
      res.status(409).json({
        error: {
          code: 'SHIFT_OVERLAP',
          message: 'Assignee already has an overlapping shift during this time',
          details: { assigneeId: nextAssigneeId },
        },
      });
      return;
    }

    const isPublished = existingShift.status === 'PUBLISHED';

    const updatedShift = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.shift.update({
        where: { id: shiftId },
        data: {
          assigneeId: nextAssigneeId,
          position: position ?? existingShift.position,
          startsAt: nextStartDate,
          endsAt: nextEndDate,
          notes: notes !== undefined ? notes : existingShift.notes,
          version: existingShift.version + 1,
        },
      });

      // Rule: Editing a PUBLISHED shift writes a shift.updated activity row.
      // Any open swap on that shift becomes EXPIRED with reason SHIFT_CHANGED.
      if (isPublished) {
        const actor = await prisma.user.findUnique({
          where: { id: req.user!.id },
          select: { name: true },
        });
        const actorName = actor?.name || 'Manager';
        await tx.activity.create({
          data: {
            teamId: req.teamId!,
            type: 'shift.updated',
            actorId: req.user!.id,
            subjectId: shiftId,
            payload: {
              actorName,
              summary: `${actorName} updated a shift`,
              subjectType: 'shift',
              shiftId,
              assigneeId: nextAssigneeId,
              startsAt: nextStartDate.toISOString(),
              endsAt: nextEndDate.toISOString(),
            },
          },
        });

        const openSwaps = await tx.swapRequest.findMany({
          where: {
            teamId: req.teamId!,
            status: { in: ['REQUESTED', 'ACCEPTED'] },
            OR: [{ requesterShiftId: shiftId }, { targetShiftId: shiftId }],
          },
        });

        if (openSwaps.length > 0) {
          await tx.swapRequest.updateMany({
            where: {
              id: { in: openSwaps.map((s: any) => s.id) },
            },
            data: {
              status: 'EXPIRED',
              reason: 'SHIFT_CHANGED',
            },
          });

          for (const swap of openSwaps) {
            await tx.activity.create({
              data: {
                teamId: req.teamId!,
                type: 'swap.expired',
                actorId: req.user!.id,
                subjectId: swap.id,
                payload: {
                  actorName,
                  summary: 'Swap request expired: shift was modified',
                  subjectType: 'swap',
                  swapId: swap.id,
                  reason: 'SHIFT_CHANGED',
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
          }
        }

        const recipientUserIds = Array.from(new Set([existingShift.assigneeId, nextAssigneeId]));
        await tx.outboxEvent.create({
          data: {
            teamId: req.teamId!,
            kind: 'notify',
            payload: {
              type: 'shift.updated',
              refId: shiftId,
              teamId: req.teamId!,
              userIds: recipientUserIds,
              version: updated.version,
              requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
              startsAt: updated.startsAt.toISOString(),
            },
          },
        });
      }

      return updated;
    });

    res.status(200).json({
      shift: {
        id: updatedShift.id,
        teamId: updatedShift.teamId,
        assigneeId: updatedShift.assigneeId,
        position: updatedShift.position,
        notes: updatedShift.notes,
        startsAt: updatedShift.startsAt.toISOString(),
        endsAt: updatedShift.endsAt.toISOString(),
        status: updatedShift.status,
        publishedAt: updatedShift.publishedAt ? updatedShift.publishedAt.toISOString() : null,
        version: updatedShift.version,
        createdBy: updatedShift.createdBy,
        updatedAt: updatedShift.updatedAt.toISOString(),
      },
    });
  },
);

// ------------------------------------------------------------------
// DELETE /v1/teams/:teamId/shifts/:shiftId (Owner, Manager)
// ------------------------------------------------------------------
shiftRouter.delete(
  '/:teamId/shifts/:shiftId',
  authenticate,
  validateParams(shiftParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const shiftId = req.params.shiftId as string;

    const existingShift = await prisma.shift.findFirst({
      where: {
        id: shiftId,
        teamId: req.teamId!,
      },
    });

    if (!existingShift) {
      res.status(404).json({
        error: {
          code: 'SHIFT_NOT_FOUND',
          message: 'Shift not found',
          details: { shiftId },
        },
      });
      return;
    }

    const isPublished = existingShift.status === 'PUBLISHED';

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (isPublished) {
        const actor = await prisma.user.findUnique({
          where: { id: req.user!.id },
          select: { name: true },
        });
        const actorName = actor?.name || 'Manager';
        await tx.activity.create({
          data: {
            teamId: req.teamId!,
            type: 'shift.deleted',
            actorId: req.user!.id,
            subjectId: shiftId,
            payload: {
              actorName,
              summary: `${actorName} deleted a shift`,
              subjectType: 'shift',
              shiftId,
              assigneeId: existingShift.assigneeId,
            },
          },
        });

        const openSwaps = await tx.swapRequest.findMany({
          where: {
            teamId: req.teamId!,
            status: { in: ['REQUESTED', 'ACCEPTED'] },
            OR: [{ requesterShiftId: shiftId }, { targetShiftId: shiftId }],
          },
        });

        if (openSwaps.length > 0) {
          await tx.swapRequest.updateMany({
            where: { id: { in: openSwaps.map((s: any) => s.id) } },
            data: {
              status: 'EXPIRED',
              reason: 'SHIFT_CHANGED',
            },
          });

          for (const swap of openSwaps) {
            await tx.activity.create({
              data: {
                teamId: req.teamId!,
                type: 'swap.expired',
                actorId: req.user!.id,
                subjectId: swap.id,
                payload: {
                  actorName,
                  summary: 'Swap request expired: shift was deleted',
                  subjectType: 'swap',
                  swapId: swap.id,
                  reason: 'SHIFT_CHANGED',
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
          }
        }

        await tx.outboxEvent.create({
          data: {
            teamId: req.teamId!,
            kind: 'notify',
            payload: {
              type: 'shift.deleted',
              refId: shiftId,
              teamId: req.teamId!,
              userIds: [existingShift.assigneeId],
              version: existingShift.version,
              requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
              startsAt: existingShift.startsAt.toISOString(),
            },
          },
        });
      }

      await tx.shift.delete({
        where: { id: shiftId },
      });
    });

    res.status(204).send();
  },
);

// ------------------------------------------------------------------
// POST /v1/teams/:teamId/shifts/publish (Owner, Manager; Idempotent)
// ------------------------------------------------------------------
shiftRouter.post(
  '/:teamId/shifts/publish',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  requireIdempotency,
  validateBody(publishShiftsSchema),
  async (req: Request, res: Response) => {
    const { shiftIds } = req.body as { shiftIds: string[] };

    // Verify all shiftIds belong to this team
    const foundShifts = await prisma.shift.findMany({
      where: {
        id: { in: shiftIds },
        teamId: req.teamId!,
      },
    });

    if (foundShifts.length !== shiftIds.length) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'One or more shifts were not found in this clinic',
          details: {
            requestedCount: shiftIds.length,
            foundCount: foundShifts.length,
          },
        },
      });
      return;
    }

    const now = new Date();
    const affectedUserIds: string[] = Array.from(new Set<string>(foundShifts.map((s: any) => s.assigneeId)));

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.shift.updateMany({
        where: {
          id: { in: shiftIds },
          teamId: req.teamId!,
        },
        data: {
          status: 'PUBLISHED',
          publishedAt: now,
        },
      });

      const actor = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });
      const actorName = actor?.name || 'Manager';
      // Write one shift.published activity row per shift
      for (const shift of foundShifts) {
        await tx.activity.create({
          data: {
            teamId: req.teamId!,
            type: 'shift.published',
            actorId: req.user!.id,
            subjectId: shift.id,
            payload: {
              actorName,
              summary:
                foundShifts.length > 1
                  ? `${actorName} published ${foundShifts.length} shifts`
                  : `${actorName} published a ${shift.position} shift`,
              subjectType: 'shift',
              shiftId: shift.id,
              assigneeId: shift.assigneeId,
              startsAt: shift.startsAt.toISOString(),
              endsAt: shift.endsAt.toISOString(),
            },
          },
        });

        await tx.outboxEvent.create({
          data: {
            teamId: req.teamId!,
            kind: 'notify',
            payload: {
              type: 'shift.published',
              refId: shift.id,
              teamId: req.teamId!,
              userIds: [shift.assigneeId],
              version: shift.version,
              requestId: req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID(),
              startsAt: shift.startsAt.toISOString(),
            },
          },
        });
      }
    });

    res.status(200).json({ publishedCount: shiftIds.length });
  },
);
