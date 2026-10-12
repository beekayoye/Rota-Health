import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { authenticate } from '../middleware/authenticate.js';

export const inviteRouter = Router();

// GET /v1/invites/:token (Public)
// Returns clinic name, role, status, seatsAvailable (PRD 5.2, 10)
inviteRouter.get('/invites/:token', async (req: Request, res: Response) => {
  const token = req.params.token as string;
  if (!token) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Invite token is required',
        details: {},
      },
    });
    return;
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');

  const invite = await prisma.invite.findUnique({
    where: { tokenHash },
    include: {
      team: {
        include: {
          subscription: true,
          _count: {
            select: {
              memberships: {
                where: { status: 'ACTIVE' },
              },
            },
          },
        },
      },
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

  if (invite.status === 'REVOKED') {
    res.status(410).json({
      error: {
        code: 'INVITE_USED',
        message: 'This invite is no longer active',
        details: {},
      },
    });
    return;
  }

  if (new Date() > invite.expiresAt) {
    res.status(410).json({
      error: {
        code: 'INVITE_EXPIRED',
        message: 'Invite has expired',
        details: {},
      },
    });
    return;
  }

  if (invite.uses >= invite.maxUses) {
    res.status(410).json({
      error: {
        code: 'INVITE_USED',
        message: 'Invite has reached maximum uses',
        details: {},
      },
    });
    return;
  }

  const seats = invite.team.subscription?.seats ?? 5;
  const activeMembers = invite.team._count.memberships;
  const seatsAvailable = Math.max(0, seats - activeMembers);

  res.status(200).json({
    clinicName: invite.team.name,
    role: invite.role,
    status: invite.status,
    seatsAvailable,
  });
});

// POST /v1/invites/:token/accept (Authenticated)
// Locks subscription row (SELECT FOR UPDATE), checks seat capacity, creates membership, increments uses, writes activity row
inviteRouter.post('/invites/:token/accept', authenticate, async (req: Request, res: Response) => {
  const token = req.params.token as string;
  const userId = req.user!.id;

  const tokenHash = createHash('sha256').update(token).digest('hex');

  const invite = await prisma.invite.findUnique({
    where: { tokenHash },
    include: {
      team: true,
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

  if (invite.status === 'REVOKED') {
    res.status(410).json({
      error: {
        code: 'INVITE_USED',
        message: 'This invite is no longer active',
        details: {},
      },
    });
    return;
  }

  if (new Date() > invite.expiresAt) {
    res.status(410).json({
      error: {
        code: 'INVITE_EXPIRED',
        message: 'Invite has expired',
        details: {},
      },
    });
    return;
  }

  if (invite.uses >= invite.maxUses) {
    res.status(410).json({
      error: {
        code: 'INVITE_USED',
        message: 'Invite has reached maximum uses',
        details: {},
      },
    });
    return;
  }

  // PRD 6.1: Check if already an active member of this team
  const existingMembership = await prisma.membership.findUnique({
    where: {
      teamId_userId: {
        teamId: invite.teamId,
        userId,
      },
    },
  });

  if (existingMembership && existingMembership.status === 'ACTIVE') {
    res.status(409).json({
      error: {
        code: 'ALREADY_MEMBER',
        message: 'You are already a member of this clinic',
        details: {},
      },
    });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Lock subscription row with SELECT ... FOR UPDATE (PRD 5.2, 11)
      const subRows = await tx.$queryRaw<Array<{ id: string; seats: number; status: string }>>`
        SELECT id, seats, status FROM subscriptions WHERE team_id = ${invite.teamId}::uuid FOR UPDATE
      `;
      const seats = subRows[0]?.seats ?? 5;

      // 2. Check active members capacity
      const activeMembers = await tx.membership.count({
        where: {
          teamId: invite.teamId,
          status: 'ACTIVE',
        },
      });

      if (activeMembers + 1 > seats) {
        const error = new Error('SEAT_LIMIT_EXCEEDED');
        (error as any).code = 'SEAT_LIMIT_EXCEEDED';
        throw error;
      }

      // 3. Create or reactivate membership
      await tx.membership.upsert({
        where: {
          teamId_userId: {
            teamId: invite.teamId,
            userId,
          },
        },
        update: {
          role: invite.role,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
        create: {
          teamId: invite.teamId,
          userId,
          role: invite.role,
          status: 'ACTIVE',
        },
      });

      // 4. Increment uses and update status if max uses reached
      const newUses = invite.uses + 1;
      await tx.invite.update({
        where: { id: invite.id },
        data: {
          uses: { increment: 1 },
          status: newUses >= invite.maxUses ? 'ACCEPTED' : 'PENDING',
        },
      });

      // 5. Fetch user name for activity
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      // 6. Write member.joined activity row
      const memberName = user?.name || 'Staff Member';
      await tx.activity.create({
        data: {
          teamId: invite.teamId,
          type: 'member.joined',
          actorId: userId,
          subjectId: userId,
          payload: {
            actorName: memberName,
            summary: `${memberName} joined as ${invite.role.toLowerCase()}`,
            subjectType: null,
            role: invite.role,
            memberName,
          },
        },
      });

      // 7. Return team info
      const team = await tx.team.findUniqueOrThrow({
        where: { id: invite.teamId },
      });

      return { team, role: invite.role };
    });

    res.status(200).json(result);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && (err as any).code === 'SEAT_LIMIT_EXCEEDED') {
      res.status(409).json({
        error: {
          code: 'SEAT_LIMIT_EXCEEDED',
          message: 'Clinic has reached its member seat limit',
          details: {},
        },
      });
      return;
    }
    throw err;
  }
});

// GET /l/invite/:token (Public redirect to deep link rotahealth://invite/:token)
inviteRouter.get('/l/invite/:token', (req: Request, res: Response) => {
  const token = req.params.token;
  res.redirect(302, `rotahealth://invite/${token}`);
});
