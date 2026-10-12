import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';

describe('Refresh Token Rotation & Reuse (refresh-reuse.test.ts)', () => {
  const deviceId = randomUUID();
  const testEmail = `doctor_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const testName = 'Dr. Hibbert';

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: testEmail },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: testEmail },
    });
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('rotates refresh token returning a new pair, and reuse revokes the whole family', async () => {
    // 1. Register to get initial tokens
    const regRes = await request(app).post('/v1/auth/register').send({
      email: testEmail,
      password: testPassword,
      name: testName,
      deviceId,
    });

    expect(regRes.status).toBe(201);
    const initialAccessToken = regRes.body.accessToken;
    const initialRefreshToken = regRes.body.refreshToken;
    expect(initialAccessToken).toBeDefined();

    // 2. Rotate refresh token once
    const rotateRes = await request(app).post('/v1/auth/refresh').send({
      refreshToken: initialRefreshToken,
      deviceId,
    });

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.accessToken).toBeDefined();
    expect(rotateRes.body.refreshToken).toBeDefined();
    expect(rotateRes.body.refreshToken).not.toBe(initialRefreshToken);

    const newRefreshToken = rotateRes.body.refreshToken;

    // 3. Reusing the old initialRefreshToken triggers reuse detection
    const reuseRes = await request(app).post('/v1/auth/refresh').send({
      refreshToken: initialRefreshToken,
      deviceId,
    });

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe('REFRESH_REUSED');

    // 4. The whole family was revoked, so newRefreshToken is now also dead!
    const deadRes = await request(app).post('/v1/auth/refresh').send({
      refreshToken: newRefreshToken,
      deviceId,
    });

    expect(deadRes.status).toBe(401);
    expect(deadRes.body.error.code).toBe('REFRESH_REUSED');
  });

  it('logout-all revokes access tokens and causes 401 TOKEN_REVOKED', async () => {
    // Log in to get fresh tokens
    const loginRes = await request(app).post('/v1/auth/login').send({
      email: testEmail,
      password: testPassword,
      deviceId: randomUUID(),
    });

    expect(loginRes.status).toBe(200);
    const validAccessToken = loginRes.body.accessToken;

    // Access /v1/me successfully
    const meResBefore = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${validAccessToken}`);

    expect(meResBefore.status).toBe(200);
    expect(meResBefore.body.user.email).toBe(testEmail.toLowerCase());

    // Perform logout-all
    const logoutAllRes = await request(app)
      .post('/v1/auth/logout-all')
      .set('Authorization', `Bearer ${validAccessToken}`)
      .send({});

    expect(logoutAllRes.status).toBe(204);

    // Using the unexpired access token must now return 401 TOKEN_REVOKED
    const meResAfter = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${validAccessToken}`);

    expect(meResAfter.status).toBe(401);
    expect(meResAfter.body.error.code).toBe('TOKEN_REVOKED');
  });
});
