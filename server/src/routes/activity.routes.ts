import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { validateParams, validateQuery } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  resolveTeam,
  requireMembership,
  requireRole,
  requireSubscriptionState,
} from '../middleware/team.js';

export const activityRouter = Router();

const teamParamsSchema = z
  .object({
    teamId: z.string().uuid(),
  })
  .strict();

const feedQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const cursorObjectSchema = z
  .object({
    t: z.string().datetime({ precision: 3 }),
    id: z.string().uuid(),
  })
  .strict();

interface ActivityRow {
  id: string;
  team_id: string;
  type: string;
  actor_id: string;
  subject_id: string | null;
  payload: any;
  created_at: Date;
}

// GET /v1/teams/:teamId/activity
activityRouter.get(
  '/:teamId/activity',
  authenticate,
  validateParams(teamParamsSchema),
  resolveTeam,
  requireMembership,
  requireRole(['OWNER', 'MANAGER', 'STAFF']),
  requireSubscriptionState,
  validateQuery(feedQuerySchema),
  async (req: Request, res: Response) => {
    const limit = (req.query.limit as unknown as number) || 20;
    const cursorParam = req.query.cursor as string | undefined;

    let decodedCursor: { t: string; id: string } | null = null;

    if (cursorParam) {
      try {
        const decodedString = Buffer.from(cursorParam, 'base64url').toString('utf8');
        const parsedJson = JSON.parse(decodedString);
        const parseResult = cursorObjectSchema.safeParse(parsedJson);

        if (!parseResult.success) {
          res.status(400).json({
            error: {
              code: 'CURSOR_INVALID',
              message: 'Invalid cursor format',
              details: parseResult.error.format(),
            },
          });
          return;
        }

        decodedCursor = parseResult.data;
      } catch {
        res.status(400).json({
          error: {
            code: 'CURSOR_INVALID',
            message: 'Failed to decode cursor',
            details: {},
          },
        });
        return;
      }
    }

    const limitPlusOne = limit + 1;
    let rows: ActivityRow[];

    if (!decodedCursor) {
      rows = await prisma.$queryRaw<ActivityRow[]>`
        SELECT id, team_id, type, actor_id, subject_id, payload, created_at
        FROM activities
        WHERE team_id = ${req.teamId!}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ${limitPlusOne};
      `;
    } else {
      const cursorDate = new Date(decodedCursor.t);
      rows = await prisma.$queryRaw<ActivityRow[]>`
        SELECT id, team_id, type, actor_id, subject_id, payload, created_at
        FROM activities
        WHERE team_id = ${req.teamId!}::uuid
          AND (created_at, id) < (${cursorDate}::timestamptz, ${decodedCursor.id}::uuid)
        ORDER BY created_at DESC, id DESC
        LIMIT ${limitPlusOne};
      `;
    }

    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasNext && items.length > 0) {
      const lastItem = items[items.length - 1];
      const nextCursorObj = {
        t: lastItem.created_at.toISOString(),
        id: lastItem.id,
      };
      nextCursor = Buffer.from(JSON.stringify(nextCursorObj)).toString('base64url');
    }

    const formattedItems = items.map((r) => ({
      id: r.id,
      teamId: r.team_id,
      type: r.type,
      actorId: r.actor_id,
      subjectId: r.subject_id,
      payload: r.payload,
      createdAt: r.created_at.toISOString(),
    }));

    res.status(200).json({
      items: formattedItems,
      nextCursor,
    });
  },
);
