import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../server/src/auth/argon2.js';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123!';

async function main() {
  console.log('Seeding demo data for Grace Point Clinic...');

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // 1. Create or update demo users
  const usersData = [
    { email: 'adaeze@gracepoint.ng', name: 'Mrs. Adaeze Okafor', role: 'OWNER' as const },
    { email: 'halima@gracepoint.ng', name: 'Halima Bello', role: 'MANAGER' as const },
    { email: 'emeka@gracepoint.ng', name: 'Emeka Nwosu', role: 'STAFF' as const },
    { email: 'chioma@gracepoint.ng', name: 'Chioma Eze', role: 'STAFF' as const },
    { email: 'babatunde@gracepoint.ng', name: 'Babatunde Raji', role: 'STAFF' as const },
  ];

  const createdUsers: Record<string, any> = {};

  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        passwordHash,
      },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
      },
    });
    createdUsers[u.email] = { ...user, teamRole: u.role };
  }

  const owner = createdUsers['adaeze@gracepoint.ng'];
  const manager = createdUsers['halima@gracepoint.ng'];
  const emeka = createdUsers['emeka@gracepoint.ng'];
  const chioma = createdUsers['chioma@gracepoint.ng'];
  const babatunde = createdUsers['babatunde@gracepoint.ng'];

  // 2. Create or find Grace Point Clinic
  let team = await prisma.team.findFirst({
    where: { name: 'Grace Point Clinic' },
  });

  if (!team) {
    team = await prisma.team.create({
      data: {
        id: randomUUID(),
        name: 'Grace Point Clinic',
        timeZone: 'Africa/Lagos',
        ownerId: owner.id,
      },
    });
  }

  // Grace Point's subscription ACTIVE on STARTER with 5 seats,
  // currentPeriodStart = now minus 10 days, currentPeriodEnd = currentPeriodStart plus 30 days, periodNumber 1
  const periodStart = DateTime.utc().minus({ days: 10 }).toJSDate();
  const periodEnd = DateTime.fromJSDate(periodStart).plus({ days: 30 }).toJSDate();

  await prisma.subscription.upsert({
    where: { teamId: team.id },
    create: {
      teamId: team.id,
      plan: 'STARTER',
      seats: 5,
      status: 'ACTIVE',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      periodNumber: 1,
    },
    update: {
      plan: 'STARTER',
      seats: 5,
      status: 'ACTIVE',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      periodNumber: 1,
      pendingPlan: null,
      pendingSeats: null,
    },
  });

  // Plus one matching CHARGE ledger row of 2000 cents
  const existingCharge = await prisma.ledgerEntry.findFirst({
    where: {
      teamId: team.id,
      type: 'CHARGE',
      periodNumber: 1,
    },
  });

  if (!existingCharge) {
    await prisma.ledgerEntry.create({
      data: {
        teamId: team.id,
        type: 'CHARGE',
        amountCents: 2000,
        currency: 'USD',
        plan: 'STARTER',
        seats: 5,
        periodNumber: 1,
        meta: { description: 'Initial Starter plan charge' },
      },
    });
  }

  // 3. Ensure memberships for all 5 users
  for (const u of usersData) {
    const user = createdUsers[u.email];
    await prisma.membership.upsert({
      where: {
        teamId_userId: {
          teamId: team.id,
          userId: user.id,
        },
      },
      update: {
        role: u.role,
        status: 'ACTIVE',
      },
      create: {
        teamId: team.id,
        userId: user.id,
        role: u.role,
        status: 'ACTIVE',
      },
    });
  }

  // 4. Create two weeks of published shifts
  // Clean up any existing shifts for this clinic to keep seed idempotent & fresh
  await prisma.swapRequest.deleteMany({ where: { teamId: team.id } });
  await prisma.shift.deleteMany({ where: { teamId: team.id } });

  const lagosZone = 'Africa/Lagos';
  const nowInLagos = DateTime.now().setZone(lagosZone);
  const startOfThisWeek = nowInLagos.startOf('week'); // Monday

  const staffList = [emeka, chioma, babatunde, manager];
  const positions = ['Morning Nurse', 'Afternoon Nurse', 'Lead Nurse', 'Triage Officer'];

  const createdShifts: any[] = [];

  // Generate shifts for 14 days (this week and next week)
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const currentDay = startOfThisWeek.plus({ days: dayOffset });

    // 2 shifts per day: Morning (07:00 - 15:00) and Afternoon (15:00 - 23:00)
    // Morning shift
    const morningAssignee = staffList[dayOffset % staffList.length];
    const morningStart = currentDay.set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
    const morningEnd = currentDay.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });

    const s1 = await prisma.shift.create({
      data: {
        teamId: team.id,
        assigneeId: morningAssignee.id,
        position: positions[dayOffset % positions.length],
        startsAt: morningStart.toUTC().toJSDate(),
        endsAt: morningEnd.toUTC().toJSDate(),
        status: 'PUBLISHED',
        publishedAt: nowInLagos.toUTC().toJSDate(),
        createdBy: manager.id,
        notes: `Ward A coverage - ${morningAssignee.name}`,
      },
    });
    createdShifts.push(s1);

    // Afternoon shift
    const afternoonAssignee = staffList[(dayOffset + 1) % staffList.length];
    const afternoonStart = currentDay.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
    const afternoonEnd = currentDay.set({ hour: 23, minute: 0, second: 0, millisecond: 0 });

    const s2 = await prisma.shift.create({
      data: {
        teamId: team.id,
        assigneeId: afternoonAssignee.id,
        position: positions[(dayOffset + 1) % positions.length],
        startsAt: afternoonStart.toUTC().toJSDate(),
        endsAt: afternoonEnd.toUTC().toJSDate(),
        status: 'PUBLISHED',
        publishedAt: nowInLagos.toUTC().toJSDate(),
        createdBy: manager.id,
        notes: `Ward B coverage - ${afternoonAssignee.name}`,
      },
    });
    createdShifts.push(s2);
  }

  // 5. Create 1 open swap in the future between Emeka and Chioma
  // Find a future shift for Emeka and a future shift for Chioma on different future days
  const futureShiftsEmeka = createdShifts.filter(
    (s) => s.assigneeId === emeka.id && s.startsAt.getTime() > Date.now() + 24 * 3600000,
  );
  const futureShiftsChioma = createdShifts.filter(
    (s) => s.assigneeId === chioma.id && s.startsAt.getTime() > Date.now() + 24 * 3600000,
  );

  let openSwapId: string | null = null;
  if (futureShiftsEmeka.length > 0 && futureShiftsChioma.length > 0) {
    const emekaShift = futureShiftsEmeka[0];
    const chiomaShift = futureShiftsChioma[0];

    const openSwap = await prisma.swapRequest.create({
      data: {
        teamId: team.id,
        requesterId: emeka.id,
        targetUserId: chioma.id,
        requesterShiftId: emekaShift.id,
        targetShiftId: chiomaShift.id,
        status: 'REQUESTED',
      },
    });
    openSwapId = openSwap.id;

    await prisma.activity.create({
      data: {
        teamId: team.id,
        type: 'swap.requested',
        actorId: emeka.id,
        subjectId: openSwap.id,
        payload: {
          swapId: openSwap.id,
          requesterId: emeka.id,
          targetUserId: chioma.id,
          requesterShiftId: emekaShift.id,
          targetShiftId: chiomaShift.id,
        },
      },
    });
  }

  console.log('\n======================================================');
  console.log(' DEMO DATA SEEDED SUCCESSFULLY');
  console.log(' Clinic Name: Grace Point Clinic (Lagos, Nigeria)');
  console.log(` Clinic ID:   ${team.id}`);
  console.log(` Shifts:      ${createdShifts.length} published shifts across 2 weeks`);
  console.log(` Open Swap:   ${openSwapId ? `ID: ${openSwapId} (Emeka -> Chioma)` : 'None'}`);
  console.log('======================================================');
  console.log(' DEMO LOGINS (Password for all users: Password123!)');
  console.log('------------------------------------------------------');
  console.log(' 1. Owner:   adaeze@gracepoint.ng    (Mrs. Adaeze Okafor)');
  console.log(' 2. Manager: halima@gracepoint.ng    (Halima Bello)');
  console.log(' 3. Staff:   emeka@gracepoint.ng     (Emeka Nwosu)');
  console.log(' 4. Staff:   chioma@gracepoint.ng    (Chioma Eze)');
  console.log(' 5. Staff:   babatunde@gracepoint.ng (Babatunde Raji)');
  console.log('======================================================\n');
}

main()
  .catch((e) => {
    console.error('Error seeding demo data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
