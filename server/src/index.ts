import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';

export const app = express();

app.use(express.json());

// Request tracking & timing headers (PRD 10)
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', requestId);
  res.setHeader('serverTime', new Date().toISOString());
  next();
});

// GET /v1/healthz - Health check route verifying database and Redis connectivity
app.get('/v1/healthz', async (_req: Request, res: Response) => {
  const serverTime = new Date().toISOString();
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';
  let dbError: string | null = null;
  let redisError: string | null = null;

  try {
    // Run simple raw query to verify database connection
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err: unknown) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  try {
    // Ping Redis
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }
    const pong = await redis.ping();
    if (pong === 'PONG') {
      redisStatus = 'connected';
    }
  } catch (err: unknown) {
    redisError = err instanceof Error ? err.message : String(err);
  }

  const isHealthy = dbStatus === 'connected' && redisStatus === 'connected';

  if (!isHealthy) {
    return res.status(503).json({
      error: {
        code: 'TRY_AGAIN',
        message: 'Service dependencies unhealthy',
        details: {
          database: { status: dbStatus, error: dbError },
          redis: { status: redisStatus, error: redisError },
        },
      },
      serverTime,
    });
  }

  return res.status(200).json({
    status: 'ok',
    database: dbStatus,
    redis: redisStatus,
    serverTime,
  });
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Rota Health API server listening on port ${PORT}`);
  });
}
