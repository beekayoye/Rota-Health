import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { config } from '../config.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  resolveTeam,
  requireMembership,
  requireRole,
  requireSubscriptionState,
} from '../middleware/team.js';

export const teamRouter = Router();

// Zod schemas
const createTeamSchema = z
  .object({
    name: z.string().min(2).max(80),
    timeZone: z.string().default('Africa/Lagos'),
  })
  .strict();

const patchTeamSchema = z
  .object({
    name: z.string().min(2).max(80).optional(),
    timeZone: z.string().optional(),
  })
  .strict();

const teamParamsSchema = z
  .object({
    teamId: z.string().uuid(),
  })
  .strict();

const memberParamsSchema = z
  .object({
    teamId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict();

const patchMemberSchema = z
  .object({
    role: z.enum(['MANAGER', 'STAFF']),
  })
  .strict();

const createInviteSchema = z
  .object({
    mode: z.literal('LINK').default('LINK'),
    role: z.enum(['MANAGER', 'STAFF']),
    maxUses: z.number().int().min(1).max(40),
  })
  .strict();

const inviteParamsSchema = z
  .object({
    teamId: z.string().uuid(),
    inviteId: z.string().uuid(),
  })
  .strict();

// -------------------------------------------------------------
// POST /v1/teams
// Creates team, Owner membership, and INCOMPLETE subscription row in one transaction (PRD 5.1, 10)
// -------------------------------------------------------------
teamRouter.post(
  '/',
  authenticate,
  validateBody(createTeamSchema),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { name, timeZone } = req.body;
    const teamId = randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create team
      const team = await tx.team.create({
        data: {
          id: teamId,
          name,
          timeZone,
          ownerId: userId,
        },
      });

      // 2. Create Owner membership
      await tx.membership.create({
        data: {
          teamId,
          userId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      // 3. Create initial Subscription row: plan STARTER, seats 5, status INCOMPLETE (PRD 5.1, 6.5)
      const subscription = await tx.subscription.create({
        data: {
          teamId,
          plan: 'STARTER',
          seats: 5,
          status: 'INCOMPLETE',
        },
      });

      return { team, subscription };
    });

    res.status(201).json({
      team: result.team,
      subscription: {
        plan: result.subscription.plan,
        seats: result.subscription.seats,
        status: result.subscription.status,
      },
    });
  },
);

// -------------------------------------------------------------
// Middleware chain for /teams/:teamId routes (PRD 6.2):
// requestId -> authenticate -> resolveTeam -> requireMembership -> requireRole -> requireSubscriptionState -> validate -> handler
// -------------------------------------------------------------

// GET /v1/teams/:teamId
teamRouter.get(
  '/:teamId',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const subscription = await prisma.subscription.findUnique({
      where: { teamId: req.teamId! },
      select: { status: true },
    });

    res.status(200).json({
      team: req.team,
      role: req.role,
      subscription: {
        status: subscription?.status || 'INCOMPLETE',
      },
    });
  },
);

// PATCH /v1/teams/:teamId (Owner only)
teamRouter.patch(
  '/:teamId',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER']),
  requireSubscriptionState,
  validateBody(patchTeamSchema),
  async (req: Request, res: Response) => {
    const { name, timeZone } = req.body;

    const updated = await prisma.team.update({
      where: { id: req.teamId! },
      data: {
        ...(name && { name }),
        ...(timeZone && { timeZone }),
      },
    });

    res.status(200).json({ team: updated });
  },
);

// GET /v1/teams/:teamId/members
teamRouter.get(
  '/:teamId/members',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const memberships = await prisma.membership.findMany({
      where: {
        teamId: req.teamId!,
        status: 'ACTIVE',
      },
      orderBy: { joinedAt: 'asc' },
    });

    const userIds = memberships.map((m) => m.userId);
    const users: Array<{ id: string; name: string; email: string }> = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });

    const userMap = new Map<string, { id: string; name: string; email: string }>(
      users.map((u) => [u.id, u]),
    );

    const members = memberships.map((m) => {
      const u = userMap.get(m.userId);
      return {
        id: m.id,
        userId: m.userId,
        name: u?.name || 'Unknown',
        email: u?.email || '',
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
        user: {
          id: m.userId,
          name: u?.name || 'Unknown',
          email: u?.email || '',
        },
      };
    });

    res.status(200).json({ members });
  },
);

// PATCH /v1/teams/:teamId/members/:userId (Owner only, cannot change Owner role)
teamRouter.patch(
  '/:teamId/members/:userId',
  authenticate,
  validateParams(memberParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER']),
  requireSubscriptionState,
  validateBody(patchMemberSchema),
  async (req: Request, res: Response) => {
    const targetUserId = req.params.userId as string;

    const targetMember = await prisma.membership.findUnique({
      where: {
        teamId_userId: {
          teamId: req.teamId!,
          userId: targetUserId,
        },
      },
    });

    if (!targetMember || targetMember.status !== 'ACTIVE') {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Member not found',
          details: {},
        },
      });
      return;
    }

    // PRD 6.2: Owner cannot be demoted (409 OWNER_IMMUTABLE)
    if (req.team!.ownerId === targetUserId || targetMember.role === 'OWNER') {
      res.status(409).json({
        error: {
          code: 'OWNER_IMMUTABLE',
          message: 'The clinic owner role cannot be changed or demoted',
          details: {},
        },
      });
      return;
    }

    const updated = await prisma.membership.update({
      where: { id: targetMember.id },
      data: { role: req.body.role },
    });

    res.status(200).json({ member: updated });
  },
);

// DELETE /v1/teams/:teamId/members/:userId
// Owner, Manager (Staff only). Owner cannot be removed (409 OWNER_IMMUTABLE).
// Blocked if member has future shifts (409 MEMBER_HAS_FUTURE_SHIFTS).
teamRouter.delete(
  '/:teamId/members/:userId',
  authenticate,
  validateParams(memberParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const targetUserId = req.params.userId as string;

    const targetMember = await prisma.membership.findUnique({
      where: {
        teamId_userId: {
          teamId: req.teamId!,
          userId: targetUserId,
        },
      },
    });

    if (!targetMember || targetMember.status !== 'ACTIVE') {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Member not found',
          details: {},
        },
      });
      return;
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { name: true },
    });
    const targetName = targetUser?.name || 'Member';

    // PRD 6.2: Owner cannot be removed (409 OWNER_IMMUTABLE)
    if (req.team!.ownerId === targetUserId || targetMember.role === 'OWNER') {
      res.status(409).json({
        error: {
          code: 'OWNER_IMMUTABLE',
          message: 'The clinic owner cannot be removed',
          details: {},
        },
      });
      return;
    }

    // PRD 7: Manager can remove Staff only
    if (req.role === 'MANAGER' && targetMember.role !== 'STAFF') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Managers can remove staff members only',
          details: {},
        },
      });
      return;
    }

    // PRD 6.2: Blocked while they have future shifts
    const now = new Date();
    const futureShiftsCount = await prisma.shift.count({
      where: {
        teamId: req.teamId!,
        assigneeId: targetUserId,
        startsAt: { gt: now },
      },
    });

    if (futureShiftsCount > 0) {
      res.status(409).json({
        error: {
          code: 'MEMBER_HAS_FUTURE_SHIFTS',
          message: 'Cannot remove member with upcoming shifts scheduled',
          details: { count: futureShiftsCount },
        },
      });
      return;
    }

    // Transaction: cancel open swaps, mark member REMOVED, record activity
    await prisma.$transaction(async (tx) => {
      // Cancel open swaps involving this member
      await tx.swapRequest.updateMany({
        where: {
          teamId: req.teamId!,
          status: { in: ['REQUESTED', 'ACCEPTED'] },
          OR: [{ requesterId: targetUserId }, { targetUserId }],
        },
        data: { status: 'CANCELLED' },
      });

      // Set membership status to REMOVED
      await tx.membership.update({
        where: { id: targetMember.id },
        data: { status: 'REMOVED' },
      });

      // Write member.removed activity
      const actorName = req.user!.name || 'Manager';
      await tx.activity.create({
        data: {
          teamId: req.teamId!,
          type: 'member.removed',
          actorId: req.user!.id,
          subjectId: targetUserId,
          payload: {
            actorName,
            summary: `${actorName} removed ${targetName} from the clinic`,
            subjectType: null,
            removedUserId: targetUserId,
          },
        },
      });
    });

    res.status(204).send();
  },
);

// GET /v1/teams/:teamId/invites (Owner, Manager)
teamRouter.get(
  '/:teamId/invites',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const invites = await prisma.invite.findMany({
      where: {
        teamId: req.teamId!,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        mode: true,
        email: true,
        role: true,
        uses: true,
        maxUses: true,
        expiresAt: true,
      },
      orderBy: { expiresAt: 'desc' },
    });

    res.status(200).json({ invites });
  },
);

// POST /v1/teams/:teamId/invites (Owner, Manager; only Owner can invite Manager)
teamRouter.post(
  '/:teamId/invites',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  validateBody(createInviteSchema),
  async (req: Request, res: Response) => {
    const { mode, role, maxUses } = req.body;

    // PRD 7 / Prompt #4: Only the Owner invites a Manager
    if (req.role === 'MANAGER' && role === 'MANAGER') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the clinic Owner can invite Managers',
          details: {},
        },
      });
      return;
    }

    // Generate 32-byte secure random token
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = await prisma.invite.create({
      data: {
        teamId: req.teamId!,
        mode,
        role,
        tokenHash,
        maxUses,
        uses: 0,
        invitedBy: req.user!.id,
        expiresAt,
        status: 'PENDING',
      },
    });

      const inviteUrl = `${config.PUBLIC_BASE_URL}/l/invite/${rawToken}`;

      res.status(201).json({
        invite: {
          id: invite.id,
          mode: invite.mode,
          role: invite.role,
          maxUses: invite.maxUses,
          uses: invite.uses,
          expiresAt: invite.expiresAt,
        },
        inviteUrl,
        token: rawToken,
      });
    },
  );

// DELETE /v1/teams/:teamId/invites/:inviteId (Owner, Manager)
teamRouter.delete(
  '/:teamId/invites/:inviteId',
  authenticate,
  validateParams(inviteParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER']),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    const inviteId = req.params.inviteId as string;
    const invite = await prisma.invite.findFirst({
      where: {
        id: inviteId,
        teamId: req.teamId!,
      },
    });

    if (!invite) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Invite not found',
          details: {},
        },
      });
      return;
    }

    // PRD 7: Manager can revoke Staff invites only
    if (req.role === 'MANAGER' && invite.role !== 'STAFF') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Managers can only revoke staff invites',
          details: {},
        },
      });
      return;
    }

    await prisma.invite.update({
      where: { id: invite.id },
      data: { status: 'REVOKED' },
    });

    res.status(204).send();
  },
);
