import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { signAccessToken } from './auth/jwt.js';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';
import { seedActivities } from '../prisma/seed-activity.js';

describe('Activity Feed (feed.test.ts)', () => {
  let teamId: string;
  let userToken: string;

  beforeAll(async () => {
    // 1. Find or seed Grace Point Clinic
    let gpTeam = await prisma.team.findFirst({
      where: { name: 'Grace Point Clinic' },
    });

    const gpCount = gpTeam
      ? await prisma.activity.count({ where: { teamId: gpTeam.id } })
      : 0;

    if (!gpTeam || gpCount !== 12000) {
      console.log('Seeding activities for feed test...');
      await seedActivities();
      gpTeam = await prisma.team.findFirstOrThrow({
        where: { name: 'Grace Point Clinic' },
      });
    }

    teamId = gpTeam.id;

    // 2. Find an active member of Grace Point to create token
    const member = await prisma.membership.findFirstOrThrow({
      where: { teamId, status: 'ACTIVE' },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: member.userId },
    });

    userToken = signAccessToken({
      userId: user.id,
      familyId: randomUUID(),
      tokenVersion: user.tokenVersion,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('an invalid cursor returns 400 CURSOR_INVALID', async () => {
    // Non-base64 / corrupt string
    const res1 = await request(app)
      .get(`/v1/teams/${teamId}/activity?cursor=!!!not-base64url!!!`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('CURSOR_INVALID');

    // Base64url of invalid JSON
    const notJson = Buffer.from('this is not json').toString('base64url');
    const res2 = await request(app)
      .get(`/v1/teams/${teamId}/activity?cursor=${notJson}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('CURSOR_INVALID');

    // Base64url of valid JSON but invalid schema (bad timestamp & id)
    const badFields = Buffer.from(
      JSON.stringify({ t: 'not-a-date', id: 'not-a-uuid' }),
    ).toString('base64url');
    const res3 = await request(app)
      .get(`/v1/teams/${teamId}/activity?cursor=${badFields}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res3.status).toBe(400);
    expect(res3.body.error.code).toBe('CURSOR_INVALID');
  });

  it(
    'pages through all 12,000 Grace Point rows with limit 20 and asserts strictly descending (created_at, id) order with no gaps or duplicates',
    async () => {
      let cursor: string | null = null;
      const seenIds = new Set<string>();
      let previousRow: { createdAt: string; id: string } | null = null;
      let pageCount = 0;
      let totalItems = 0;

      while (true) {
        const url = cursor
          ? `/v1/teams/${teamId}/activity?limit=20&cursor=${encodeURIComponent(cursor)}`
          : `/v1/teams/${teamId}/activity?limit=20`;

        const res = await request(app)
          .get(url)
          .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);

        const items: Array<{ id: string; createdAt: string; payload: any }> = res.body.items;
        pageCount++;
        totalItems += items.length;

        expect(items.length).toBeLessThanOrEqual(20);

        for (const item of items) {
          // Assert uniqueness (no duplicates)
          expect(seenIds.has(item.id)).toBe(false);
          seenIds.add(item.id);

          // Assert strictly descending (created_at, id) order
          if (previousRow) {
            const prevTime = new Date(previousRow.createdAt).getTime();
            const currTime = new Date(item.createdAt).getTime();

            if (prevTime === currTime) {
              // Tie-break on UUID descending
              expect(previousRow.id > item.id).toBe(true);
            } else {
              expect(prevTime > currTime).toBe(true);
            }
          }

          previousRow = {
            createdAt: item.createdAt,
            id: item.id,
          };
        }

        if (res.body.nextCursor === null) {
          // Last page must have nextCursor: null
          expect(res.body.nextCursor).toBeNull();
          break;
        }

        cursor = res.body.nextCursor;
      }

      // Assert exactly 12,000 unique IDs collected
      expect(totalItems).toBe(12000);
      expect(seenIds.size).toBe(12000);
      expect(pageCount).toBe(600); // 12,000 / 20 = 600 pages
    },
    120000, // 2-minute timeout for 600 requests
  );
});
