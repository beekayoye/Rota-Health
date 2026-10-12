import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';

describe('Permissions Matrix (permissions.test.ts)', () => {
  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;

  let ownerId: string;
  let managerId: string;
  let staffId: string;
  let otherManagerId: string;

  let teamId: string;

  beforeAll(async () => {
    // 1. Create Owner user & login
    const ownerEmail = `owner_${Date.now()}@example.com`;
    const ownerRes = await request(app).post('/v1/auth/register').send({
      email: ownerEmail,
      password: 'Password123!',
      name: 'Owner Adaeze',
      deviceId: randomUUID(),
    });
    ownerToken = ownerRes.body.accessToken;
    ownerId = ownerRes.body.user.id;

    // 2. Create Manager user
    const managerEmail = `manager_${Date.now()}@example.com`;
    const managerRes = await request(app).post('/v1/auth/register').send({
      email: managerEmail,
      password: 'Password123!',
      name: 'Manager Halima',
      deviceId: randomUUID(),
    });
    managerToken = managerRes.body.accessToken;
    managerId = managerRes.body.user.id;

    // 3. Create another Manager user
    const otherManagerEmail = `other_manager_${Date.now()}@example.com`;
    const otherManagerRes = await request(app).post('/v1/auth/register').send({
      email: otherManagerEmail,
      password: 'Password123!',
      name: 'Manager Bello',
      deviceId: randomUUID(),
    });
    otherManagerId = otherManagerRes.body.user.id;

    // 4. Create Staff user
    const staffEmail = `staff_${Date.now()}@example.com`;
    const staffRes = await request(app).post('/v1/auth/register').send({
      email: staffEmail,
      password: 'Password123!',
      name: 'Staff Emeka',
      deviceId: randomUUID(),
    });
    staffToken = staffRes.body.accessToken;
    staffId = staffRes.body.user.id;

    // 5. Owner creates team
    const teamRes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Grace Point Clinic',
        timeZone: 'Africa/Lagos',
      });
    expect(teamRes.status).toBe(201);
    teamId = teamRes.body.team.id;

    // 6. Add members to team
    await prisma.membership.createMany({
      data: [
        { teamId, userId: managerId, role: 'MANAGER', status: 'ACTIVE' },
        { teamId, userId: otherManagerId, role: 'MANAGER', status: 'ACTIVE' },
        { teamId, userId: staffId, role: 'STAFF', status: 'ACTIVE' },
      ],
    });
  });

  afterAll(async () => {
    if (teamId) {
      await prisma.swapRequest.deleteMany({ where: { teamId } });
      await prisma.shift.deleteMany({ where: { teamId } });
      await prisma.activity.deleteMany({ where: { teamId } });
      await prisma.invite.deleteMany({ where: { teamId } });
      await prisma.membership.deleteMany({ where: { teamId } });
      await prisma.subscription.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
    }
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, managerId, otherManagerId, staffId] } },
    });
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('Staff calling DELETE /v1/teams/:teamId/shifts/:shiftId gets 403 FORBIDDEN and shift still exists', async () => {
    // 1. Owner creates a shift
    const startsAt = new Date(Date.now() + 86400000).toISOString();
    const endsAt = new Date(Date.now() + 86400000 + 8 * 3600000).toISOString();
    const createRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        assigneeId: staffId,
        position: 'Nurse',
        startsAt,
        endsAt,
      });
    expect(createRes.status).toBe(201);
    const shiftId = createRes.body.shift.id;

    // 2. Staff tries to delete shift
    const deleteRes = await request(app)
      .delete(`/v1/teams/${teamId}/shifts/${shiftId}`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.error.code).toBe('FORBIDDEN');

    // 3. Shift still exists
    const checkShift = await prisma.shift.findUnique({ where: { id: shiftId } });
    expect(checkShift).not.toBeNull();
  });

  it('Staff cannot create, edit or publish shifts (403 FORBIDDEN)', async () => {
    const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
    const endsAt = new Date(Date.now() + 2 * 86400000 + 8 * 3600000).toISOString();

    // Create attempt
    const createRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        assigneeId: staffId,
        position: 'Nurse',
        startsAt,
        endsAt,
      });
    expect(createRes.status).toBe(403);
    expect(createRes.body.error.code).toBe('FORBIDDEN');

    // Edit attempt on existing shift
    const ownerShiftRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        assigneeId: staffId,
        position: 'Nurse',
        startsAt,
        endsAt,
      });
    const shiftId = ownerShiftRes.body.shift.id;

    const editRes = await request(app)
      .patch(`/v1/teams/${teamId}/shifts/${shiftId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        position: 'Doctor',
        version: 1,
      });
    expect(editRes.status).toBe(403);
    expect(editRes.body.error.code).toBe('FORBIDDEN');

    // Publish attempt
    const publishRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts/publish`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        shiftIds: [shiftId],
      });
    expect(publishRes.status).toBe(403);
    expect(publishRes.body.error.code).toBe('FORBIDDEN');
  });

  it('Manager inviting a Manager returns 403 FORBIDDEN', async () => {
    const res = await request(app)
      .post(`/v1/teams/${teamId}/invites`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        mode: 'LINK',
        role: 'MANAGER',
        maxUses: 5,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Manager changing a role returns 403 FORBIDDEN', async () => {
    const res = await request(app)
      .patch(`/v1/teams/${teamId}/members/${staffId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        role: 'MANAGER',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Staff removing a member returns 403 FORBIDDEN', async () => {
    const res = await request(app)
      .delete(`/v1/teams/${teamId}/members/${managerId}`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Manager removing a Manager returns 403 FORBIDDEN', async () => {
    const res = await request(app)
      .delete(`/v1/teams/${teamId}/members/${otherManagerId}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Anyone (Manager or Staff) removing the Owner returns 409 OWNER_IMMUTABLE', async () => {
    const managerRemoveOwner = await request(app)
      .delete(`/v1/teams/${teamId}/members/${ownerId}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(managerRemoveOwner.status).toBe(409);
    expect(managerRemoveOwner.body.error.code).toBe('OWNER_IMMUTABLE');

    const ownerRemoveSelf = await request(app)
      .delete(`/v1/teams/${teamId}/members/${ownerId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(ownerRemoveSelf.status).toBe(409);
    expect(ownerRemoveSelf.body.error.code).toBe('OWNER_IMMUTABLE');
  });

  it('Owner gets full billing, Manager gets plan name only, Staff gets 403', async () => {
    const ownerBilling = await request(app)
      .get(`/v1/teams/${teamId}/billing`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(ownerBilling.status).toBe(200);
    expect(ownerBilling.body).toHaveProperty('plan');
    expect(ownerBilling.body).toHaveProperty('seats');
    expect(ownerBilling.body).toHaveProperty('status');
    expect(ownerBilling.body).toHaveProperty('monthlyCents');

    const managerBilling = await request(app)
      .get(`/v1/teams/${teamId}/billing`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(managerBilling.status).toBe(200);
    expect(managerBilling.body).toEqual({ plan: 'STARTER' });

    const staffBilling = await request(app)
      .get(`/v1/teams/${teamId}/billing`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(staffBilling.status).toBe(403);
    expect(staffBilling.body.error.code).toBe('FORBIDDEN');
  });

  it('Manager preview is 403 FORBIDDEN, Staff preview is 403 FORBIDDEN', async () => {
    const managerPreview = await request(app)
      .post(`/v1/teams/${teamId}/billing/changes/preview`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ plan: 'TEAM', seats: 15 });

    expect(managerPreview.status).toBe(403);
    expect(managerPreview.body.error.code).toBe('FORBIDDEN');

    const staffPreview = await request(app)
      .post(`/v1/teams/${teamId}/billing/changes/preview`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ plan: 'TEAM', seats: 15 });

    expect(staffPreview.status).toBe(403);
    expect(staffPreview.body.error.code).toBe('FORBIDDEN');
  });
});
