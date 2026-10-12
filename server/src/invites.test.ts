import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';

describe('Invites API (invites.test.ts)', () => {
  let ownerToken: string;
  let ownerId: string;
  let teamId: string;

  const createdUserIds: string[] = [];

  const createUser = async (name: string) => {
    const email = `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    const res = await request(app).post('/v1/auth/register').send({
      email,
      password: 'Password123!',
      name,
      deviceId: randomUUID(),
    });
    createdUserIds.push(res.body.user.id);
    return { token: res.body.accessToken, id: res.body.user.id };
  };

  beforeAll(async () => {
    const owner = await createUser('Clinic Owner');
    ownerToken = owner.token;
    ownerId = owner.id;

    // Create clinic
    const teamRes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Apex Health Centre',
        timeZone: 'Africa/Lagos',
      });
    expect(teamRes.status).toBe(201);
    teamId = teamRes.body.team.id;
  });

  afterAll(async () => {
    if (teamId) {
      await prisma.activity.deleteMany({ where: { teamId } });
      await prisma.invite.deleteMany({ where: { teamId } });
      await prisma.membership.deleteMany({ where: { teamId } });
      await prisma.subscription.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('accept works: creates active membership and returns team', async () => {
    // 1. Owner creates link invite with maxUses = 5
    const inviteRes = await request(app)
      .post(`/v1/teams/${teamId}/invites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        mode: 'LINK',
        role: 'STAFF',
        maxUses: 5,
      });
    expect(inviteRes.status).toBe(201);
    const token = inviteRes.body.token;

    // 2. Check public invite details
    const getRes = await request(app).get(`/v1/invites/${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.clinicName).toBe('Apex Health Centre');
    expect(getRes.body.role).toBe('STAFF');
    expect(getRes.body.seatsAvailable).toBe(4); // 5 total - 1 owner = 4

    // 3. New user accepts
    const joiner = await createUser('Nurse Chisom');
    const acceptRes = await request(app)
      .post(`/v1/invites/${token}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`);

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.team.id).toBe(teamId);
    expect(acceptRes.body.role).toBe('STAFF');

    // 4. Verify membership created
    const member = await prisma.membership.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: joiner.id,
        },
      },
    });
    expect(member).toBeDefined();
    expect(member?.status).toBe('ACTIVE');

    // 5. Verify member.joined activity logged
    const activity = await prisma.activity.findFirst({
      where: {
        teamId,
        type: 'member.joined',
        actorId: joiner.id,
      },
    });
    expect(activity).toBeDefined();
  });

  it('an expired invite returns 410 INVITE_EXPIRED', async () => {
    const inviteRes = await request(app)
      .post(`/v1/teams/${teamId}/invites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        mode: 'LINK',
        role: 'STAFF',
        maxUses: 2,
      });
    const token = inviteRes.body.token;

    // Fast-forward invite expiry in database
    await prisma.invite.update({
      where: { id: inviteRes.body.invite.id },
      data: {
        expiresAt: new Date(Date.now() - 1000 * 60), // 1 minute in the past
      },
    });

    const getRes = await request(app).get(`/v1/invites/${token}`);
    expect(getRes.status).toBe(410);
    expect(getRes.body.error.code).toBe('INVITE_EXPIRED');

    const newUser = await createUser('Expired Joiner');
    const acceptRes = await request(app)
      .post(`/v1/invites/${token}/accept`)
      .set('Authorization', `Bearer ${newUser.token}`);

    expect(acceptRes.status).toBe(410);
    expect(acceptRes.body.error.code).toBe('INVITE_EXPIRED');
  });

  it('using an invite past maxUses returns 410 INVITE_USED', async () => {
    // Invite with maxUses = 1
    const inviteRes = await request(app)
      .post(`/v1/teams/${teamId}/invites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        mode: 'LINK',
        role: 'STAFF',
        maxUses: 1,
      });
    const token = inviteRes.body.token;

    // Use it once
    const user1 = await createUser('First Single Use');
    const accept1 = await request(app)
      .post(`/v1/invites/${token}/accept`)
      .set('Authorization', `Bearer ${user1.token}`);
    expect(accept1.status).toBe(200);

    // Try to use it again with a second user
    const user2 = await createUser('Second Single Use');
    const accept2 = await request(app)
      .post(`/v1/invites/${token}/accept`)
      .set('Authorization', `Bearer ${user2.token}`);

    expect(accept2.status).toBe(410);
    expect(accept2.body.error.code).toBe('INVITE_USED');

    const getRes = await request(app).get(`/v1/invites/${token}`);
    expect(getRes.status).toBe(410);
    expect(getRes.body.error.code).toBe('INVITE_USED');
  });

  it('joining twice returns 409 ALREADY_MEMBER', async () => {
    const inviteRes = await request(app)
      .post(`/v1/teams/${teamId}/invites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        mode: 'LINK',
        role: 'STAFF',
        maxUses: 10,
      });
    const token = inviteRes.body.token;

    const user = await createUser('Double Joiner');
    // First accept succeeds
    const firstRes = await request(app)
      .post(`/v1/invites/${token}/accept`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(firstRes.status).toBe(200);

    // Second accept with same user returns 409 ALREADY_MEMBER
    const secondRes = await request(app)
      .post(`/v1/invites/${token}/accept`)
      .set('Authorization', `Bearer ${user.token}`);

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error.code).toBe('ALREADY_MEMBER');
  });

  it('the sixth member on Starter (5 seats) returns 409 SEAT_LIMIT_EXCEEDED', async () => {
    // 1. Create a fresh clinic with 5 seats (Starter)
    const freshOwner = await createUser('Fresh Owner');
    const freshTeamRes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${freshOwner.token}`)
      .send({
        name: 'Seat Cap Clinic',
        timeZone: 'Africa/Lagos',
      });
    const freshTeamId = freshTeamRes.body.team.id;

    // Currently 1 active member (Owner). Fill up to 5 members:
    // Add 4 more active members directly so team has 5 members
    const membersToFill: string[] = [];
    for (let i = 0; i < 4; i++) {
      const u = await createUser(`Member Fill ${i}`);
      membersToFill.push(u.id);
    }

    await prisma.membership.createMany({
      data: membersToFill.map((uid) => ({
        teamId: freshTeamId,
        userId: uid,
        role: 'STAFF',
        status: 'ACTIVE',
      })),
    });

    const activeCount = await prisma.membership.count({
      where: { teamId: freshTeamId, status: 'ACTIVE' },
    });
    expect(activeCount).toBe(5);

    // 2. Create link invite
    const inviteRes = await request(app)
      .post(`/v1/teams/${freshTeamId}/invites`)
      .set('Authorization', `Bearer ${freshOwner.token}`)
      .send({
        mode: 'LINK',
        role: 'STAFF',
        maxUses: 5,
      });
    const token = inviteRes.body.token;

    // 3. GET /v1/invites/:token should report seatsAvailable = 0
    const getRes = await request(app).get(`/v1/invites/${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.seatsAvailable).toBe(0);

    // 4. A 6th person tries to join -> 409 SEAT_LIMIT_EXCEEDED
    const sixthPerson = await createUser('Sixth Person');
    const acceptRes = await request(app)
      .post(`/v1/invites/${token}/accept`)
      .set('Authorization', `Bearer ${sixthPerson.token}`);

    expect(acceptRes.status).toBe(409);
    expect(acceptRes.body.error.code).toBe('SEAT_LIMIT_EXCEEDED');

    // Clean up fresh team
    await prisma.activity.deleteMany({ where: { teamId: freshTeamId } });
    await prisma.invite.deleteMany({ where: { teamId: freshTeamId } });
    await prisma.membership.deleteMany({ where: { teamId: freshTeamId } });
    await prisma.subscription.deleteMany({ where: { teamId: freshTeamId } });
    await prisma.team.deleteMany({ where: { id: freshTeamId } });
  });

  it('GET /l/invite/:token redirects (302) to rotahealth://invite/:token', async () => {
    const testToken = 'random_invite_token_123';
    const res = await request(app).get(`/l/invite/${testToken}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`rotahealth://invite/${testToken}`);
  });
});
