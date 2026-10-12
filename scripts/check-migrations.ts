import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const migrations = await prisma.$queryRaw`SELECT * FROM _prisma_migrations;`;
  console.log('Applied migrations:', migrations);
}

main().finally(() => prisma.$disconnect());
