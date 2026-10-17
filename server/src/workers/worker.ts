import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../db/prisma.js';
import { redis } from '../lib/redis.js';
import { startOutboxRelay, notificationsQueue, pushReceiptsQueue } from './outbox-relay.js';
import { createNotificationWorker, createPushReceiptsWorker } from './notification-worker.js';
import { createSwapExpiryWorker } from '../queues/swap-expiry.js';

logger.info('Initializing BullMQ workers & transactional outbox relay...');

// Start outbox relay loop (2s interval, not BullMQ repeatable job - PRD 22 risk 2)
const outboxRelayTimer = startOutboxRelay();

// Start notification and push-receipts workers
const notificationWorker = createNotificationWorker();
const pushReceiptsWorker = createPushReceiptsWorker();
const swapExpiryWorker = createSwapExpiryWorker();

notificationWorker.on('error', (err) => {
  logger.error({ err }, 'Notification worker error');
});

pushReceiptsWorker.on('error', (err) => {
  logger.error({ err }, 'Push receipts worker error');
});

swapExpiryWorker.on('error', (err) => {
  logger.error({ err }, 'Swap expiry worker error');
});

logger.info('BullMQ workers and Outbox Relay running successfully');

// Graceful shutdown on SIGTERM and SIGINT
let isShuttingDown = false;
const shutdownWorker = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}, initiating graceful worker shutdown...`);

  const forceTimeout = setTimeout(() => {
    logger.error('Worker shutdown deadline exceeded (10s), forcing process exit.');
    process.exit(1);
  }, 10000);
  forceTimeout.unref();

  clearInterval(outboxRelayTimer);
  logger.info('Outbox relay interval stopped');

  try {
    await Promise.all([
      notificationWorker.close(),
      pushReceiptsWorker.close(),
      swapExpiryWorker.close(),
    ]);
    logger.info('BullMQ workers closed');
  } catch (err) {
    logger.error({ err }, 'Error closing BullMQ workers');
  }

  try {
    await Promise.all([
      notificationsQueue.close(),
      pushReceiptsQueue.close(),
    ]);
    logger.info('BullMQ queues closed');
  } catch (err) {
    logger.error({ err }, 'Error closing BullMQ queues');
  }

  try {
    await prisma.$disconnect();
    logger.info('Prisma disconnected');
  } catch (err) {
    logger.error({ err }, 'Error disconnecting Prisma');
  }

  try {
    await redis.quit();
    logger.info('Redis connection closed');
  } catch (err) {
    logger.error({ err }, 'Error closing Redis connection');
  }

  clearTimeout(forceTimeout);
  logger.info('Worker shutdown completed cleanly');
  process.exit(0);
};

process.on('SIGTERM', () => shutdownWorker('SIGTERM'));
process.on('SIGINT', () => shutdownWorker('SIGINT'));
