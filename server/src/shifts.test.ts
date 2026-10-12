import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';

describe('Shifts API (shifts.test.ts)', () => {
  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;
  let outsiderToken: string;

  let ownerId: string;
  let managerId: string;
  let staffId: string;
  let outsiderId: string;

  let teamId: string;

  beforeAll(async () => {
    // 1. Owner
    const ownerRes = await request(app).post('/v1/auth/register').send({
      email: `shift_owner_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Owner Adaeze',
      deviceId: randomUUID(),
    });
    ownerToken = ownerRes.body.accessToken;
    ownerId = ownerRes.body.user.id;

    // 2. Manager
    const managerRes = await request(app).post('/v1/auth/register').send({
      email: `shift_mgr_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Manager Halima',
      deviceId: randomUUID(),
    });
    managerToken = managerRes.body.accessToken;
    managerId = managerRes.body.user.id;

    // 3. Staff
    const staffRes = await request(app).post('/v1/auth/register').send({
      email: `shift_staff_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Staff Emeka',
      deviceId: randomUUID(),
    });
    staffToken = staffRes.body.accessToken;
    staffId = staffRes.body.user.id;

    // 4. Outsider
    const outsiderRes = await request(app).post('/v1/auth/register').send({
      email: `shift_outsider_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Outsider Person',
      deviceId: randomUUID(),
    });
    outsiderToken = outsiderRes.body.accessToken;
    outsiderId = outsiderRes.body.user.id;

    // 5. Create Team
    const teamRes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Shift Test Clinic',
        timeZone: 'Africa/Lagos',
      });
    expect(teamRes.status).toBe(201);
    teamId = teamRes.body.team.id;

    // 6. Add manager and staff memberships
    await prisma.membership.createMany({
      data: [
        { teamId, userId: managerId, role: 'MANAGER', status: 'ACTIVE' },
        { teamId, userId: staffId, role: 'STAFF', status: 'ACTIVE' },
      ],
    });
  });

  afterAll(async () => {
    if (teamId) {
      await prisma.outboxEvent.deleteMany({ where: { teamId } });
      await prisma.swapRequest.deleteMany({ where: { teamId } });
      await prisma.shift.deleteMany({ where: { teamId } });
      await prisma.activity.deleteMany({ where: { teamId } });
      await prisma.invite.deleteMany({ where: { teamId } });
      await prisma.membership.deleteMany({ where: { teamId } });
      await prisma.subscription.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
    }
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, managerId, staffId, outsiderId] } },
    });
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('rejects shift creation if assignee is not a team member with 422 ASSIGNEE_NOT_MEMBER', async () => {
    const startsAt = '2026-10-15T08:00:00.000Z';
    const endsAt = '2026-10-15T16:00:00.000Z';

    const res = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        assigneeId: outsiderId,
        position: 'Doctor',
        startsAt,
        endsAt,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ASSIGNEE_NOT_MEMBER');
  });

  it('rejects overlapping shift for same assignee on create and edit with 409 SHIFT_OVERLAP', async () => {
    const shift1Starts = '2026-10-16T08:00:00.000Z';
    const shift1Ends = '2026-10-16T16:00:00.000Z';

    // 1. Create first shift
    const createRes1 = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        assigneeId: staffId,
        position: 'Nurse',
        startsAt: shift1Starts,
        endsAt: shift1Ends,
      });
    expect(createRes1.status).toBe(201);
    const shift1Id = createRes1.body.shift.id;

    // 2. Attempt to create overlapping shift for staffId (starts within shift 1)
    const overlapCreateRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        assigneeId: staffId,
        position: 'Nurse Assistant',
        startsAt: '2026-10-16T12:00:00.000Z',
        endsAt: '2026-10-16T20:00:00.000Z',
      });
    expect(overlapCreateRes.status).toBe(409);
    expect(overlapCreateRes.body.error.code).toBe('SHIFT_OVERLAP');

    // 3. Create non-overlapping shift on a different day
    const createRes2 = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        assigneeId: staffId,
        position: 'Nurse',
        startsAt: '2026-10-17T08:00:00.000Z',
        endsAt: '2026-10-17T16:00:00.000Z',
      });
    expect(createRes2.status).toBe(201);
    const shift2Id = createRes2.body.shift.id;

    // 4. Attempt to edit shift 2 to overlap with shift 1
    const overlapEditRes = await request(app)
      .patch(`/v1/teams/${teamId}/shifts/${shift2Id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        startsAt: '2026-10-16T14:00:00.000Z',
        endsAt: '2026-10-16T22:00:00.000Z',
        version: 1,
      });
    expect(overlapEditRes.status).toBe(409);
    expect(overlapEditRes.body.error.code).toBe('SHIFT_OVERLAP');
  });

  it('handles midnight-crossing shift and displays properly in week query', async () => {
    // Night shift crossing midnight in Lagos (UTC+1): 2026-10-19 22:00 Lagos (21:00 UTC) to 2026-10-20 06:00 Lagos (05:00 UTC)
    const startsAt = '2026-10-19T21:00:00.000Z';
    const endsAt = '2026-10-20T05:00:00.000Z';

    const createRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        assigneeId: staffId,
        position: 'Night Nurse',
        startsAt,
        endsAt,
      });
    expect(createRes.status).toBe(201);

    // Query ISO week containing 2026-10-19 (Monday)
    const weekRes = await request(app)
      .get(`/v1/teams/${teamId}/shifts?weekStart=2026-10-19`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(weekRes.status).toBe(200);

    const found = weekRes.body.shifts.find((s: any) => s.id === createRes.body.shift.id);
    expect(found).toBeDefined();
    expect(found.startsAt).toBe(startsAt);
    expect(found.endsAt).toBe(endsAt);
  });

  it('Staff never receive draft shifts across shift endpoints', async () => {
    // Create a draft shift
    const startsAt = '2026-10-21T08:00:00.000Z';
    const endsAt = '2026-10-21T16:00:00.000Z';

    const draftRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        assigneeId: staffId,
        position: 'Draft Position',
        startsAt,
        endsAt,
      });
    expect(draftRes.status).toBe(201);
    const draftId = draftRes.body.shift.id;

    // 1. Staff queries week shifts: draft must not be in list
    const weekRes = await request(app)
      .get(`/v1/teams/${teamId}/shifts?weekStart=2026-10-19`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(weekRes.status).toBe(200);
    const inWeek = weekRes.body.shifts.some((s: any) => s.id === draftId);
    expect(inWeek).toBe(false);

    // 2. Staff queries specific draft shift detail: returns 404 NOT_FOUND
    const detailRes = await request(app)
      .get(`/v1/teams/${teamId}/shifts/${draftId}`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(detailRes.status).toBe(404);
    expect(detailRes.body.error.code).toBe('SHIFT_NOT_FOUND');

    // 3. Manager CAN see the draft
    const mgrDetailRes = await request(app)
      .get(`/v1/teams/${teamId}/shifts/${draftId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(mgrDetailRes.status).toBe(200);
    expect(mgrDetailRes.body.shift.id).toBe(draftId);
  });

  it('member removal is blocked while they have future shifts with 409 MEMBER_HAS_FUTURE_SHIFTS', async () => {
    // Create a new staff member to test removal guard
    const userToRemoveRes = await request(app).post('/v1/auth/register').send({
      email: `remove_test_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'To Remove',
      deviceId: randomUUID(),
    });
    const removeUserId = userToRemoveRes.body.user.id;
    await prisma.membership.create({
      data: { teamId, userId: removeUserId, role: 'STAFF', status: 'ACTIVE' },
    });

    // Assign a future shift
    const futureStarts = new Date(Date.now() + 5 * 86400000).toISOString();
    const futureEnds = new Date(Date.now() + 5 * 86400000 + 8 * 3600000).toISOString();
    const futureShiftRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        assigneeId: removeUserId,
        position: 'Future Nurse',
        startsAt: futureStarts,
        endsAt: futureEnds,
      });
    expect(futureShiftRes.status).toBe(201);

    // Attempt removal by manager
    const removeRes = await request(app)
      .delete(`/v1/teams/${teamId}/members/${removeUserId}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(removeRes.status).toBe(409);
    expect(removeRes.body.error.code).toBe('MEMBER_HAS_FUTURE_SHIFTS');
    expect(removeRes.body.error.details.count).toBeGreaterThanOrEqual(1);

    // Delete future shift and verify member can now be removed
    await prisma.shift.delete({ where: { id: futureShiftRes.body.shift.id } });
    const successRemoveRes = await request(app)
      .delete(`/v1/teams/${teamId}/members/${removeUserId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(successRemoveRes.status).toBe(204);
  });
});
