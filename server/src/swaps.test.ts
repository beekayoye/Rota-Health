import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';
import { expireSwapIfDue } from './queues/swap-expiry.js';

describe('Swaps API (swaps.test.ts)', () => {
  let ownerToken: string;
  let managerToken: string;
  let staff1Token: string;
  let staff2Token: string;

  let ownerId: string;
  let managerId: string;
  let staff1Id: string;
  let staff2Id: string;

  let teamId: string;

  beforeAll(async () => {
    // 1. Owner
    const ownerRes = await request(app).post('/v1/auth/register').send({
      email: `swap_owner_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Owner Adaeze',
      deviceId: randomUUID(),
    });
    ownerToken = ownerRes.body.accessToken;
    ownerId = ownerRes.body.user.id;

    // 2. Manager
    const managerRes = await request(app).post('/v1/auth/register').send({
      email: `swap_mgr_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Manager Halima',
      deviceId: randomUUID(),
    });
    managerToken = managerRes.body.accessToken;
    managerId = managerRes.body.user.id;

    // 3. Staff 1 (Emeka)
    const s1Res = await request(app).post('/v1/auth/register').send({
      email: `swap_s1_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Staff Emeka',
      deviceId: randomUUID(),
    });
    staff1Token = s1Res.body.accessToken;
    staff1Id = s1Res.body.user.id;

    // 4. Staff 2 (Chioma)
    const s2Res = await request(app).post('/v1/auth/register').send({
      email: `swap_s2_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Staff Chioma',
      deviceId: randomUUID(),
    });
    staff2Token = s2Res.body.accessToken;
    staff2Id = s2Res.body.user.id;

    // 5. Team
    const teamRes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Swap Test Clinic',
        timeZone: 'Africa/Lagos',
      });
    expect(teamRes.status).toBe(201);
    teamId = teamRes.body.team.id;

    // 6. Memberships
    await prisma.membership.createMany({
      data: [
        { teamId, userId: managerId, role: 'MANAGER', status: 'ACTIVE' },
        { teamId, userId: staff1Id, role: 'STAFF', status: 'ACTIVE' },
        { teamId, userId: staff2Id, role: 'STAFF', status: 'ACTIVE' },
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
      where: { id: { in: [ownerId, managerId, staff1Id, staff2Id] } },
    });
    await prisma.$disconnect();
    redis.disconnect();
  });

  // Helper to create published future shifts
  async function createPublishedShift(assigneeId: string, daysAhead: number, startHour: number) {
    const d = new Date(Date.now() + daysAhead * 86400000);
    d.setUTCHours(startHour, 0, 0, 0);
    const startsAt = d.toISOString();
    const e = new Date(d.getTime() + 8 * 3600000);
    const endsAt = e.toISOString();

    const shift = await prisma.shift.create({
      data: {
        teamId,
        assigneeId,
        position: 'Nurse',
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        status: 'PUBLISHED',
        publishedAt: new Date(),
        createdBy: managerId,
      },
    });
    return shift;
  }

  it('full happy path: request -> accept -> approve swaps assignees atomically', async () => {
    const shift1 = await createPublishedShift(staff1Id, 2, 8);
    const shift2 = await createPublishedShift(staff2Id, 3, 8);

    // 1. Staff 1 requests swap
    const reqRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        requesterShiftId: shift1.id,
        targetShiftId: shift2.id,
      });
    expect(reqRes.status).toBe(201);
    expect(reqRes.body.swap.status).toBe('REQUESTED');
    const swapId = reqRes.body.swap.id;

    // 2. Staff 2 accepts swap
    const acceptRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps/${swapId}/accept`)
      .set('Authorization', `Bearer ${staff2Token}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.swap.status).toBe('ACCEPTED');

    // 3. Manager approves swap
    const approveRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps/${swapId}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', randomUUID());
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.swap.status).toBe('APPROVED');

    // 4. Verify assignees are swapped in database
    const refreshedShift1 = await prisma.shift.findUnique({ where: { id: shift1.id } });
    const refreshedShift2 = await prisma.shift.findUnique({ where: { id: shift2.id } });

    expect(refreshedShift1!.assigneeId).toBe(staff2Id);
    expect(refreshedShift2!.assigneeId).toBe(staff1Id);
  });

  it('decline flow: target declines requested swap', async () => {
    const shift1 = await createPublishedShift(staff1Id, 4, 8);
    const shift2 = await createPublishedShift(staff2Id, 5, 8);

    const reqRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        requesterShiftId: shift1.id,
        targetShiftId: shift2.id,
      });
    expect(reqRes.status).toBe(201);
    const swapId = reqRes.body.swap.id;

    const declineRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps/${swapId}/decline`)
      .set('Authorization', `Bearer ${staff2Token}`)
      .send({ reason: 'Family event' });
    expect(declineRes.status).toBe(200);
    expect(declineRes.body.swap.status).toBe('DECLINED');
    expect(declineRes.body.swap.reason).toBe('Family event');
  });

  it('cancel flow: requester cancels swap before approval', async () => {
    const shift1 = await createPublishedShift(staff1Id, 6, 8);
    const shift2 = await createPublishedShift(staff2Id, 7, 8);

    const reqRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        requesterShiftId: shift1.id,
        targetShiftId: shift2.id,
      });
    expect(reqRes.status).toBe(201);
    const swapId = reqRes.body.swap.id;

    const cancelRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps/${swapId}/cancel`)
      .set('Authorization', `Bearer ${staff1Token}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.swap.status).toBe('CANCELLED');
  });

  it('enforces one open swap per shift with 409 SWAP_OPEN_EXISTS', async () => {
    const shift1 = await createPublishedShift(staff1Id, 8, 8);
    const shift2 = await createPublishedShift(staff2Id, 9, 8);

    const firstRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        requesterShiftId: shift1.id,
        targetShiftId: shift2.id,
      });
    expect(firstRes.status).toBe(201);

    // Attempt second swap request involving shift1
    const secondRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        requesterShiftId: shift1.id,
        targetShiftId: shift2.id,
      });
    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error.code).toBe('SWAP_OPEN_EXISTS');
  });

  it('two concurrent approvals give one 200 and one 409 SWAP_STATE_CHANGED', async () => {
    const shift1 = await createPublishedShift(staff1Id, 10, 8);
    const shift2 = await createPublishedShift(staff2Id, 11, 8);

    const reqRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        requesterShiftId: shift1.id,
        targetShiftId: shift2.id,
      });
    const swapId = reqRes.body.swap.id;

    await request(app)
      .post(`/v1/teams/${teamId}/swaps/${swapId}/accept`)
      .set('Authorization', `Bearer ${staff2Token}`);

    // Fire two concurrent approval calls with different idempotency keys
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/v1/teams/${teamId}/swaps/${swapId}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('Idempotency-Key', randomUUID()),
      request(app)
        .post(`/v1/teams/${teamId}/swaps/${swapId}/approve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', randomUUID()),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const failed = res1.status === 409 ? res1 : res2;
    expect(failed.body.error.code).toBe('SWAP_STATE_CHANGED');
  });

  it('a Manager cannot approve a swap they are party to (403 FORBIDDEN)', async () => {
    // Shift owned by Manager
    const mgrShift = await createPublishedShift(managerId, 12, 8);
    const staffShift = await createPublishedShift(staff1Id, 13, 8);

    const reqRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        requesterShiftId: mgrShift.id,
        targetShiftId: staffShift.id,
      });
    expect(reqRes.status).toBe(201);
    const swapId = reqRes.body.swap.id;

    await request(app)
      .post(`/v1/teams/${teamId}/swaps/${swapId}/accept`)
      .set('Authorization', `Bearer ${staff1Token}`);

    // Manager attempts to approve their own swap
    const approveRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps/${swapId}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', randomUUID());

    expect(approveRes.status).toBe(403);
    expect(approveRes.body.error.code).toBe('FORBIDDEN');

    // Owner CAN approve it
    const ownerApproveRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps/${swapId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', randomUUID());
    expect(ownerApproveRes.status).toBe(200);
  });

  it('the expiry job marks the swap EXPIRED', async () => {
    const shift1 = await createPublishedShift(staff1Id, 14, 8);
    const shift2 = await createPublishedShift(staff2Id, 15, 8);

    const reqRes = await request(app)
      .post(`/v1/teams/${teamId}/swaps`)
      .set('Authorization', `Bearer ${staff1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        requesterShiftId: shift1.id,
        targetShiftId: shift2.id,
      });
    const swapId = reqRes.body.swap.id;

    // Run expiry handler
    const expired = await expireSwapIfDue(swapId);
    expect(expired).toBe(true);

    const refreshed = await prisma.swapRequest.findUnique({ where: { id: swapId } });
    expect(refreshed!.status).toBe('EXPIRED');
  });
});
