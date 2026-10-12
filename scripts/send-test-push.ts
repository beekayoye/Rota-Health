import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/send-test-push.ts <email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.error(`User with email "${email}" not found in database.`);
    process.exit(1);
  }

  const devices = await prisma.device.findMany({
    where: { userId: user.id },
  });

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { team: true },
  });

  const team = membership?.team;
  const teamId = team?.id || randomUUID();
  const teamName = team?.name || 'Grace Point Clinic';

  console.log(`Found user: ${user.name} (${user.id})`);
  console.log(`Registered devices: ${devices.length}`);
  devices.forEach((d) => console.log(`  - ${d.platform}: ${d.expoPushToken}`));

  const queue = new Queue('notifications', {
    connection: { url: redisUrl },
  });

  const testRefId = randomUUID();
  const jobId = `test-push__${testRefId}__${user.id}__${Date.now()}`;

  const job = await queue.add(
    'notify-user',
    {
      type: 'shift.published',
      refId: testRefId,
      teamId,
      userId: user.id,
      version: 1,
      requestId: randomUUID(),
      startsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), // 2 hours from now (urgent)
    },
    {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 86400 },
    },
  );

  console.log(`Enqueued test notification job ${job.id} for ${email} in team "${teamName}".`);
  console.log(`Check worker output to verify delivery to Expo push service.`);

  await queue.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error running send-test-push script:', err);
  process.exit(1);
});
