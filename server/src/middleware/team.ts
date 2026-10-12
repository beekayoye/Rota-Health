import { Request, Response, NextFunction } from 'express';
import { Team, Membership, Role } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { forTeam } from '../db/isolation.js';
import { logger } from '../lib/logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      teamId?: string;
      team?: Team;
      membership?: Membership;
      role?: Role;
      teamDb?: ReturnType<typeof forTeam>;
      requestId?: string;
    }
  }
}

/**
 * resolveTeam middleware (PRD 6.2):
 * Resolves the team by ID and attaches it to req.
 * If not found, returns 404 NOT_FOUND.
 */
export async function resolveTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  const teamId = req.params.teamId as string;
  if (!teamId) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Clinic not found',
        details: {},
      },
    });
    return;
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
  });

  if (!team) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Clinic not found',
        details: {},
      },
    });
    return;
  }

  req.teamId = team.id;
  req.team = team;
  req.teamDb = forTeam(team.id);

  // PRD 6.2 / Prompt #7: Add teamId to request log context
  const reqId = (res.getHeader('x-request-id') as string) || '';
  logger.info({ requestId: reqId, teamId: team.id }, 'Team request resolved');

  next();
}

/**
 * requireMembership middleware (PRD 6.2, 15.5):
 * Verifies that the caller has an active membership in the resolved team.
 * If caller is not an active member, returns 404 NOT_FOUND (never 403) to prevent clinic ID leaking.
 */
export async function requireMembership(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.teamId || !req.user) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Clinic not found',
        details: {},
      },
    });
    return;
  }

  const membership = await prisma.membership.findUnique({
    where: {
      teamId_userId: {
        teamId: req.teamId,
        userId: req.user.id,
      },
    },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Clinic not found',
        details: {},
      },
    });
    return;
  }

  req.membership = membership;
  req.role = membership.role;
  next();
}

/**
 * requireRole middleware (PRD 6.2, 7):
 * Role is checked on every request based on freshly resolved membership from DB.
 */
export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions for this action',
          details: {},
        },
      });
      return;
    }
    next();
  };
}

/**
 * requireSubscriptionState middleware (PRD 6.2, 6.5):
 * For now requireSubscriptionState only passes the request through.
 * TODO: Enforce INCOMPLETE and RESTRICTED later (PRD 6.5)
 */
export async function requireSubscriptionState(
  _req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  // TODO: Enforce INCOMPLETE and RESTRICTED later (PRD 6.5)
  next();
}
