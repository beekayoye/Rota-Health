import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';

describe('Authentication API (auth.test.ts)', () => {
  const deviceId = randomUUID();
  const testEmail = `nurse_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const testName = 'Nurse Joy';

  beforeAll(async () => {
    // Ensure clean state for test email
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

  it('registers a new user successfully', async () => {
    const res = await request(app).post('/v1/auth/register').send({
      email: testEmail,
      password: testPassword,
      name: testName,
      deviceId,
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testEmail.toLowerCase());
    expect(res.body.user.name).toBe(testName);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['servertime']).toBeDefined();
  });

  it('rejects duplicate email with 409 EMAIL_TAKEN', async () => {
    const res = await request(app).post('/v1/auth/register').send({
      email: testEmail,
      password: testPassword,
      name: 'Another Joy',
      deviceId: randomUUID(),
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in successfully with valid credentials', async () => {
    const loginDeviceId = randomUUID();
    const res = await request(app).post('/v1/auth/login').send({
      email: testEmail,
      password: testPassword,
      deviceId: loginDeviceId,
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testEmail.toLowerCase());
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('rejects wrong password with 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app).post('/v1/auth/login').send({
      email: testEmail,
      password: 'WrongPassword999!',
      deviceId: randomUUID(),
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects unknown email with 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({
        email: `nonexistent_${Date.now()}@example.com`,
        password: 'Password123!',
        deviceId: randomUUID(),
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects request with unknown field via Zod .strict() with 400 VALIDATION_FAILED', async () => {
    const res = await request(app).post('/v1/auth/login').send({
      email: testEmail,
      password: testPassword,
      deviceId: randomUUID(),
      extraSneakyField: 'malicious_input',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
