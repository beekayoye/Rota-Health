import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';
import { forTeam } from './db/isolation.js';

describe('Team Isolation (isolation.test.ts)', () => {
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;

  let teamAId: string;
  let teamBId: string;

  beforeAll(async () => {
    // 1. Create User A
    const resA = await request(app).post('/v1/auth/register').send({
      email: `user_a_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'User A',
      deviceId: randomUUID(),
    });
    userAToken = resA.body.accessToken;
    userAId = resA.body.user.id;

    // 2. Create User B
    const resB = await request(app).post('/v1/auth/register').send({
      email: `user_b_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'User B',
      deviceId: randomUUID(),
    });
    userBToken = resB.body.accessToken;
    userBId = resB.body.user.id;

    // 3. User A creates Clinic A
    const teamARes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'Clinic A',
        timeZone: 'Africa/Lagos',
      });
    teamAId = teamARes.body.team.id;

    // 4. User B creates Clinic B
    const teamBRes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Clinic B',
        timeZone: 'Africa/Lagos',
      });
    teamBId = teamBRes.body.team.id;
  });

  afterAll(async () => {
    for (const tid of [teamAId, teamBId]) {
      if (tid) {
        await prisma.swapRequest.deleteMany({ where: { teamId: tid } });
        await prisma.shift.deleteMany({ where: { teamId: tid } });
        await prisma.activity.deleteMany({ where: { teamId: tid } });
        await prisma.invite.deleteMany({ where: { teamId: tid } });
        await prisma.membership.deleteMany({ where: { teamId: tid } });
        await prisma.subscription.deleteMany({ where: { teamId: tid } });
        await prisma.team.deleteMany({ where: { id: tid } });
      }
    }
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId] } },
    });
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('a member of clinic A gets 404 NOT_FOUND on clinic B team route', async () => {
    const res = await request(app)
      .get(`/v1/teams/${teamBId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a member of clinic A gets 404 NOT_FOUND on clinic B members route', async () => {
    const res = await request(app)
      .get(`/v1/teams/${teamBId}/members`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a member of clinic A gets 404 NOT_FOUND on clinic B invites route', async () => {
    const res = await request(app)
      .get(`/v1/teams/${teamBId}/invites`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a member of clinic A gets 404 NOT_FOUND on clinic B shifts and shift detail routes', async () => {
    // Create a shift in clinic B
    const shift = await prisma.shift.create({
      data: {
        teamId: teamBId,
        assigneeId: userBId,
        position: 'Doctor',
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 86400000 + 8 * 3600000),
        status: 'PUBLISHED',
        createdBy: userBId,
      },
    });

    // Week shifts route
    const listRes = await request(app)
      .get(`/v1/teams/${teamBId}/shifts?weekStart=2026-10-12`)
      .set('Authorization', `Bearer ${userAToken}`);
    expect(listRes.status).toBe(404);
    expect(listRes.body.error.code).toBe('NOT_FOUND');

    // Shift detail route
    const detailRes = await request(app)
      .get(`/v1/teams/${teamBId}/shifts/${shift.id}`)
      .set('Authorization', `Bearer ${userAToken}`);
    expect(detailRes.status).toBe(404);
    expect(detailRes.body.error.code).toBe('NOT_FOUND');
  });

  it('a member of clinic A gets 404 NOT_FOUND on clinic B swaps and swap detail routes', async () => {
    // Create second user in clinic B to have two shifts for a swap
    const userB2Res = await request(app).post('/v1/auth/register').send({
      email: `user_b2_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'User B2',
      deviceId: randomUUID(),
    });
    const userB2Id = userB2Res.body.user.id;
    await prisma.membership.create({
      data: { teamId: teamBId, userId: userB2Id, role: 'STAFF', status: 'ACTIVE' },
    });

    const shiftB1 = await prisma.shift.create({
      data: {
        teamId: teamBId,
        assigneeId: userBId,
        position: 'Doctor',
        startsAt: new Date(Date.now() + 2 * 86400000),
        endsAt: new Date(Date.now() + 2 * 86400000 + 8 * 3600000),
        status: 'PUBLISHED',
        createdBy: userBId,
      },
    });
    const shiftB2 = await prisma.shift.create({
      data: {
        teamId: teamBId,
        assigneeId: userB2Id,
        position: 'Nurse',
        startsAt: new Date(Date.now() + 3 * 86400000),
        endsAt: new Date(Date.now() + 3 * 86400000 + 8 * 3600000),
        status: 'PUBLISHED',
        createdBy: userBId,
      },
    });

    const swapB = await prisma.swapRequest.create({
      data: {
        teamId: teamBId,
        requesterId: userBId,
        targetUserId: userB2Id,
        requesterShiftId: shiftB1.id,
        targetShiftId: shiftB2.id,
        status: 'REQUESTED',
      },
    });

    // Swaps list route
    const listRes = await request(app)
      .get(`/v1/teams/${teamBId}/swaps?box=incoming`)
      .set('Authorization', `Bearer ${userAToken}`);
    expect(listRes.status).toBe(404);
    expect(listRes.body.error.code).toBe('NOT_FOUND');

    // Swap detail route
    const detailRes = await request(app)
      .get(`/v1/teams/${teamBId}/swaps/${swapB.id}`)
      .set('Authorization', `Bearer ${userAToken}`);
    expect(detailRes.status).toBe(404);
    expect(detailRes.body.error.code).toBe('NOT_FOUND');
  });

  it('a member of clinic A gets 404 NOT_FOUND on clinic B activity feed route', async () => {
    const res = await request(app)
      .get(`/v1/teams/${teamBId}/activity`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a member of clinic A gets 404 NOT_FOUND on clinic B billing routes', async () => {
    const getRes = await request(app)
      .get(`/v1/teams/${teamBId}/billing`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('NOT_FOUND');

    const previewRes = await request(app)
      .post(`/v1/teams/${teamBId}/billing/changes/preview`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ plan: 'TEAM', seats: 15 });

    expect(previewRes.status).toBe(404);
    expect(previewRes.body.error.code).toBe('NOT_FOUND');
  });

  it('isolation helper throws when teamId is missing or empty', () => {
    expect(() => forTeam('')).toThrowError(/teamId is required/);
    expect(() => forTeam('   ')).toThrowError(/teamId is required/);
    expect(() => forTeam(undefined as unknown as string)).toThrowError(/teamId is required/);
    expect(() => forTeam(null as unknown as string)).toThrowError(/teamId is required/);
  });
});
