import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { resolveTeam, requireMembership, requireRole, requireSubscriptionState } from '../middleware/team.js';
import { validateBody } from '../middleware/validate.js';
import { monthly, prorate, PlanName } from '../billing/proration.js';

export const billingRouter = Router();

const previewSchema = z
  .object({
    plan: z.enum(['STARTER', 'TEAM', 'BUSINESS']),
    seats: z.number().int().min(1).max(500),
  })
  .strict();

/**
 * GET /v1/teams/:teamId/billing (PRD 10, 11)
 * Owner gets plan, seats, status, period dates, monthly price and any pending change.
 * Manager gets the plan name only.
 * Staff get 403 FORBIDDEN.
 * Never cached (PRD 16.5).
 */
billingRouter.get(
  '/:teamId/billing',
  authenticate,
  resolveTeam,
  requireMembership,
  requireRole([Role.OWNER, Role.MANAGER]),
  requireSubscriptionState,
  async (req: Request, res: Response) => {
    // PRD 16.5: Never cached, always fresh from database
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const subscription = await prisma.subscription.findUnique({
      where: { teamId: req.teamId! },
    });

    if (!subscription) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Subscription not found for this clinic',
          details: {},
        },
      });
    }

    // Manager gets plan name only (PRD 10)
    if (req.role === Role.MANAGER) {
      return res.json({
        plan: subscription.plan,
      });
    }

    // Owner gets full billing details
    const seatsUsed = await prisma.membership.count({
      where: { teamId: req.teamId!, status: 'ACTIVE' },
    });

    const monthlyCents = monthly(subscription.plan as PlanName, subscription.seats);

    const pendingChange = subscription.pendingPlan
      ? {
          plan: subscription.pendingPlan,
          seats: subscription.pendingSeats ?? subscription.seats,
          effectiveAt: subscription.currentPeriodEnd,
        }
      : null;

    return res.json({
      plan: subscription.plan,
      seats: subscription.seats,
      seatsUsed,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      monthlyCents,
      monthlyPriceCents: monthlyCents,
      pendingChange,
    });
  },
);

/**
 * POST /v1/teams/:teamId/billing/changes/preview (PRD 10, 11)
 * Owner only.
 * Loads the subscription from database and returns the prorate() result.
 * If subscription is INCOMPLETE, returns the full monthly price as the first payment.
 * Error codes per PRD 10: 409 PLAN_SEAT_CAP, 409 SEAT_LIMIT_EXCEEDED, 409 RENEWAL_IN_PROGRESS, 422 NO_CHANGE.
 */
billingRouter.post(
  '/:teamId/billing/changes/preview',
  authenticate,
  resolveTeam,
  requireMembership,
  requireRole([Role.OWNER]),
  requireSubscriptionState,
  validateBody(previewSchema),
  async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const { plan, seats } = req.body as { plan: PlanName; seats: number };

    // Cap check for STARTER
    if (plan === 'STARTER' && seats > 5) {
      return res.status(409).json({
        error: {
          code: 'PLAN_SEAT_CAP',
          message: 'Starter plan is capped at 5 seats',
          details: {},
        },
      });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { teamId: req.teamId! },
    });

    if (!subscription) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Subscription not found for this clinic',
          details: {},
        },
      });
    }

    // Check active member count vs requested seats
    const activeMembers = await prisma.membership.count({
      where: { teamId: req.teamId!, status: 'ACTIVE' },
    });

    if (seats < activeMembers) {
      return res.status(409).json({
        error: {
          code: 'SEAT_LIMIT_EXCEEDED',
          message: `Cannot decrease seats below current active members (${activeMembers})`,
          details: { activeMembers, requestedSeats: seats },
        },
      });
    }

    // If subscription is INCOMPLETE (never paid, so no period yet), return full monthly price as first payment
    if (subscription.status === 'INCOMPLETE') {
      const fullMonthly = monthly(plan, seats);
      return res.json({
        kind: 'charge',
        daysLeft: 30,
        creditCents: 0,
        costCents: fullMonthly,
        chargeCents: fullMonthly,
        newMonthlyCents: fullMonthly,
      });
    }

    // Subscription has period dates
    const timeZone = req.team?.timeZone || 'Africa/Lagos';
    const now = new Date();
    const currentPeriodStart = subscription.currentPeriodStart ?? now;
    const currentPeriodEnd = subscription.currentPeriodEnd ?? new Date(now.getTime() + 30 * 86400 * 1000);

    const result = prorate({
      current: {
        plan: subscription.plan as PlanName,
        seats: subscription.seats,
      },
      target: {
        plan,
        seats,
      },
      currentPeriodStart,
      currentPeriodEnd,
      now,
      timeZone,
    });

    if (result.kind === 'error') {
      if (result.code === 'PLAN_SEAT_CAP') {
        return res.status(409).json({
          error: {
            code: 'PLAN_SEAT_CAP',
            message: 'Starter plan is capped at 5 seats',
            details: {},
          },
        });
      }

      if (result.code === 'RENEWAL_IN_PROGRESS') {
        return res.status(409).json({
          error: {
            code: 'RENEWAL_IN_PROGRESS',
            message: 'Subscription renewal is currently in progress',
            details: {},
          },
        });
      }

      if (result.code === 'NO_CHANGE') {
        return res.status(422).json({
          error: {
            code: 'NO_CHANGE',
            message: 'Target plan and seats are identical to current configuration',
            details: {},
          },
        });
      }
    }

    return res.json(result);
  },
);
