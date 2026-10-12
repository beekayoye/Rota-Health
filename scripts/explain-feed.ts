import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ExplainRow {
  'QUERY PLAN': string;
}

export async function runExplainFeed() {
  console.log('--- EXPLAIN ANALYZE for Activity Feed (PRD 17.4) ---');

  // 1. Run ANALYZE activities
  console.log('Running ANALYZE activities...');
  await prisma.$executeRawUnsafe('ANALYZE activities;');

  // 2. Find Grace Point Clinic
  const gracePoint = await prisma.team.findFirstOrThrow({
    where: { name: 'Grace Point Clinic' },
  });
  console.log(`Using Grace Point Clinic ID: ${gracePoint.id}`);

  // 3. Page 1 EXPLAIN (ANALYZE, BUFFERS)
  console.log('\n================ PAGE 1 EXPLAIN PLAN ================');
  const page1PlanRows = await prisma.$queryRaw<ExplainRow[]>`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, team_id, type, actor_id, subject_id, payload, created_at
    FROM activities
    WHERE team_id = ${gracePoint.id}::uuid
    ORDER BY created_at DESC, id DESC
    LIMIT 21;
  `;
  const page1Plan = page1PlanRows.map((r) => r['QUERY PLAN']).join('\n');
  console.log(page1Plan);

  // 4. Get cursor from 10,000th row for page 500
  console.log('\nFetching 10,000th row to form cursor for page 500...');
  const cursorRows = await prisma.$queryRaw<{ id: string; created_at: Date }[]>`
    SELECT id, created_at
    FROM activities
    WHERE team_id = ${gracePoint.id}::uuid
    ORDER BY created_at DESC, id DESC
    OFFSET 9999 LIMIT 1;
  `;

  if (cursorRows.length === 0) {
    throw new Error('Not enough activity rows found for Grace Point Clinic to reach row 10,000.');
  }

  const cursorRow = cursorRows[0];
  console.log(`Cursor row: ID=${cursorRow.id}, createdAt=${cursorRow.created_at.toISOString()}`);

  // 5. Page 500 EXPLAIN (ANALYZE, BUFFERS)
  console.log('\n================ PAGE 500 EXPLAIN PLAN ================');
  const page500PlanRows = await prisma.$queryRaw<ExplainRow[]>`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, team_id, type, actor_id, subject_id, payload, created_at
    FROM activities
    WHERE team_id = ${gracePoint.id}::uuid
      AND (created_at, id) < (${cursorRow.created_at}::timestamptz, ${cursorRow.id}::uuid)
    ORDER BY created_at DESC, id DESC
    LIMIT 21;
  `;
  const page500Plan = page500PlanRows.map((r) => r['QUERY PLAN']).join('\n');
  console.log(page500Plan);

  return {
    page1Plan,
    page500Plan,
  };
}

runExplainFeed()
  .catch((err) => {
    console.error('Error running explain:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
