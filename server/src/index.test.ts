import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';

describe('GET /v1/healthz', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 when database and redis are healthy', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ '?column?': 1 }]);
    vi.spyOn(redis, 'connect').mockResolvedValue(undefined as never);
    vi.spyOn(redis, 'ping').mockResolvedValueOnce('PONG');

    const res = await request(app).get('/v1/healthz');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(res.body.redis).toBe('connected');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['servertime']).toBeDefined();
  });

  it('returns 503 when dependencies are down', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('Connection refused'));
    vi.spyOn(redis, 'connect').mockRejectedValueOnce(new Error('Redis unreachable'));
    vi.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('Redis unreachable'));

    const res = await request(app).get('/v1/healthz');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TRY_AGAIN');
    expect(res.body.error.details.database.status).toBe('disconnected');
    expect(res.body.error.details.redis.status).toBe('disconnected');
  });
});
