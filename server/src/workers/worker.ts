import { logger } from '../lib/logger.js';
import { startOutboxRelay } from './outbox-relay.js';
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Stopping BullMQ workers & outbox relay...');
  clearInterval(outboxRelayTimer);
  await notificationWorker.close();
  await pushReceiptsWorker.close();
  await swapExpiryWorker.close();
  process.exit(0);
});
