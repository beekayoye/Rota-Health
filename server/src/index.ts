import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from './db/prisma.js';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';
import { config } from './config.js';
import { authRouter } from './routes/auth.routes.js';
import { meRouter } from './routes/me.routes.js';
import { teamRouter } from './routes/team.routes.js';
import { inviteRouter } from './routes/invite.routes.js';
import { shiftRouter } from './routes/shift.routes.js';
import { swapRouter } from './routes/swap.routes.js';
import { activityRouter } from './routes/activity.routes.js';
import { billingRouter } from './routes/billing.routes.js';

export const app = express();

app.set('trust proxy', 1);

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

const PORT = config.PORT;

if (config.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    logger.info(`Rota Health API server listening on port ${PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful API shutdown...`);
    const forceExitTimeout = setTimeout(() => {
      logger.error('Shutdown deadline exceeded (10s), forcing process exit.');
      process.exit(1);
    }, 10000);
    forceExitTimeout.unref();

    if (server) {
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err) logger.error({ err }, 'Error closing HTTP server');
          else logger.info('HTTP server stopped accepting new connections');
          resolve();
        });
      });
    }

    try {
      await prisma.$disconnect();
      logger.info('Prisma database client disconnected');
    } catch (err) {
      logger.error({ err }, 'Error disconnecting Prisma client');
    }

    try {
      await redis.quit();
      logger.info('Redis connection closed');
    } catch (err) {
      logger.error({ err }, 'Error closing Redis connection');
    }

    clearTimeout(forceExitTimeout);
    logger.info('API shutdown completed cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
