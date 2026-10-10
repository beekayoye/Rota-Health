import { Worker } from 'bullmq';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

logger.info('Initializing BullMQ workers...');

// Empty worker placeholder for future outbox/relay/notification workers
export const outboxWorker = new Worker(
  'outbox',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Processing outbox job placeholder');
  },
  {
    connection: redis,
    autorun: false,
  },
);

outboxWorker.on('error', (err) => {
  logger.error({ err }, 'Worker error encountered');
});

logger.info('BullMQ worker entry point initialized (idle)');
