import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';

describe('Idempotency Middleware (idempotency.test.ts)', () => {
  let ownerToken: string;
  let ownerId: string;
  let teamId: string;
  let shiftId: string;

  beforeAll(async () => {
    // Register owner
    const ownerRes = await request(app).post('/v1/auth/register').send({
      email: `idempotency_owner_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Owner Adaeze',
      deviceId: randomUUID(),
    });
    ownerToken = ownerRes.body.accessToken;
    ownerId = ownerRes.body.user.id;

    // Create clinic
    const teamRes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Idempotency Clinic',
        timeZone: 'Africa/Lagos',
      });
    teamId = teamRes.body.team.id;

    // Create a draft shift
    const shiftRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        assigneeId: ownerId,
        position: 'Doctor',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 86400000 + 8 * 3600000).toISOString(),
      });
    shiftId = shiftRes.body.shift.id;
  });

  afterAll(async () => {
    if (teamId) {
      await prisma.outboxEvent.deleteMany({ where: { teamId } });
      await prisma.idempotencyKey.deleteMany({ where: { userId: ownerId } });
      await prisma.activity.deleteMany({ where: { teamId } });
      await prisma.shift.deleteMany({ where: { teamId } });
      await prisma.membership.deleteMany({ where: { teamId } });
      await prisma.subscription.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
    }
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('replays stored response with header Idempotent-Replay: true when key and body match', async () => {
    const idempotencyKey = randomUUID();
    const body = { shiftIds: [shiftId] };

    // 1. Initial request
    const firstRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts/publish`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.publishedCount).toBe(1);
    expect(firstRes.headers['idempotent-replay']).toBeUndefined();

    // 2. Replay request with exact same key and body
    const replayRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts/publish`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    expect(replayRes.status).toBe(200);
    expect(replayRes.body.publishedCount).toBe(1);
    expect(replayRes.headers['idempotent-replay']).toBe('true');
  });

  it('returns 422 IDEMPOTENCY_KEY_REUSED when the same key is sent with a different body', async () => {
    const idempotencyKey = randomUUID();

    // 1. First request
    const firstRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts/publish`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ shiftIds: [shiftId] });

    expect(firstRes.status).toBe(200);

    // 2. Second request with different body
    const differentRes = await request(app)
      .post(`/v1/teams/${teamId}/shifts/publish`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ shiftIds: [shiftId, randomUUID()] });

    expect(differentRes.status).toBe(422);
    expect(differentRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});
