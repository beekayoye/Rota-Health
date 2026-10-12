import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';
import { authRouter } from './routes/auth.routes.js';
import { meRouter } from './routes/me.routes.js';
import { teamRouter } from './routes/team.routes.js';
import { inviteRouter } from './routes/invite.routes.js';
import { shiftRouter } from './routes/shift.routes.js';
import { swapRouter } from './routes/swap.routes.js';
import { activityRouter } from './routes/activity.routes.js';
import { billingRouter } from './routes/billing.routes.js';

export const app = express();

app.use(express.json());

// Request tracking & timing headers (PRD 10)
app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  req.requestId = requestId;
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

// Mount routes
app.use('/v1/auth', authRouter);
app.use('/v1/me', meRouter);
app.use('/v1/teams', teamRouter);
app.use('/v1/teams', shiftRouter);
app.use('/v1/teams', swapRouter);
app.use('/v1/teams', activityRouter);
app.use('/v1/teams', billingRouter);
app.use('/v1', inviteRouter);
app.use('/', inviteRouter);

// Global error handler matching PRD 10 error shape
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled request error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    },
  });
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Rota Health API server listening on port ${PORT}`);
  });
}
