import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

const ACTIVITY_TYPES = [
  'shift.published',
  'shift.updated',
  'shift.deleted',
  'swap.requested',
  'swap.accepted',
  'swap.declined',
  'swap.approved',
  'swap.rejected',
  'swap.cancelled',
  'swap.expired',
  'member.joined',
  'member.removed',
  'billing.changed',
] as const;

function getSubjectType(type: string): 'shift' | 'swap' | null {
  if (type.startsWith('shift.')) return 'shift';
  if (type.startsWith('swap.')) return 'swap';
  return null;
}

function buildSummary(type: string, actorName: string, dateStr: string): string {
  switch (type) {
    case 'shift.published':
      return `${actorName} published 12 shifts for ${dateStr}`;
    case 'shift.updated':
      return `${actorName} updated a shift for ${dateStr}`;
    case 'shift.deleted':
      return `${actorName} deleted a shift`;
    case 'swap.requested':
      return `${actorName} asked to swap ${dateStr}`;
    case 'swap.accepted':
      return `${actorName} accepted the swap request`;
    case 'swap.declined':
      return `${actorName} declined the swap request`;
    case 'swap.approved':
      return `${actorName} approved the swap`;
    case 'swap.rejected':
      return `${actorName} rejected the swap`;
    case 'swap.cancelled':
      return `${actorName} cancelled the swap request`;
    case 'swap.expired':
      return 'Swap request expired: shift was modified';
    case 'member.joined':
      return `${actorName} joined as staff`;
    case 'member.removed':
      return `${actorName} removed a member from the clinic`;
    case 'billing.changed':
      return `${actorName} changed subscription plan`;
    default:
      return `${actorName} performed an action`;
  }
}

export async function seedActivities() {
  console.log('--- Starting Activity Feed Seed (PRD 17.5) ---');

  // 1. Ensure Grace Point Clinic exists
  let gracePoint = await prisma.team.findFirst({
    where: { name: 'Grace Point Clinic' },
  });

  const dummyPasswordHash = '$argon2id$v=19$m=65536,t=3,p=4$dummy_hash_for_seeded_members';

  // Ensure Owner
  let owner = await prisma.user.findFirst({
    where: { email: 'adaeze@gracepoint.ng' },
  });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: 'adaeze@gracepoint.ng',
        name: 'Mrs. Adaeze Okafor',
        passwordHash: dummyPasswordHash,
      },
    });
  }

  if (!gracePoint) {
    gracePoint = await prisma.team.create({
      data: {
        id: randomUUID(),
        name: 'Grace Point Clinic',
        timeZone: 'Africa/Lagos',
        ownerId: owner.id,
      },
    });

    await prisma.subscription.create({
      data: {
        teamId: gracePoint.id,
        plan: 'STARTER',
        seats: 15,
        status: 'ACTIVE',
      },
    });
  }

  // Ensure 11 distinct members for Grace Point Clinic
  const memberConfigs = [
    { email: 'adaeze@gracepoint.ng', name: 'Mrs. Adaeze Okafor', role: 'OWNER' as const },
    { email: 'halima@gracepoint.ng', name: 'Halima Bello', role: 'MANAGER' as const },
    { email: 'fatima@gracepoint.ng', name: 'Fatima Dangote', role: 'MANAGER' as const },
    { email: 'emeka@gracepoint.ng', name: 'Emeka Nwosu', role: 'STAFF' as const },
    { email: 'chioma@gracepoint.ng', name: 'Chioma Eze', role: 'STAFF' as const },
    { email: 'babatunde@gracepoint.ng', name: 'Babatunde Raji', role: 'STAFF' as const },
    { email: 'ngozi@gracepoint.ng', name: 'Ngozi Okonjo', role: 'STAFF' as const },
    { email: 'chinedu@gracepoint.ng', name: 'Chinedu Ibe', role: 'STAFF' as const },
    { email: 'oluwaseun@gracepoint.ng', name: 'Oluwaseun Adeleke', role: 'STAFF' as const },
    { email: 'blessing@gracepoint.ng', name: 'Blessing Umeh', role: 'STAFF' as const },
    { email: 'yusuf@gracepoint.ng', name: 'Yusuf Danjuma', role: 'STAFF' as const },
  ];

  const gpMembers: { id: string; name: string }[] = [];

  for (const mc of memberConfigs) {
    let u = await prisma.user.findFirst({ where: { email: mc.email } });
    if (!u) {
      u = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: mc.email,
          name: mc.name,
          passwordHash: dummyPasswordHash,
        },
      });
    }
    await prisma.membership.upsert({
      where: {
        teamId_userId: {
          teamId: gracePoint.id,
          userId: u.id,
        },
      },
      update: { role: mc.role, status: 'ACTIVE' },
      create: {
        teamId: gracePoint.id,
        userId: u.id,
        role: mc.role,
        status: 'ACTIVE',
      },
    });
    gpMembers.push({ id: u.id, name: u.name });
  }

  console.log(`Grace Point Clinic (${gracePoint.id}) ready with ${gpMembers.length} members.`);

  // 2. Ensure 30 other clinics exist (for cross-clinic indexing test)
  const otherClinics: { id: string; ownerId: string; ownerName: string }[] = [];
  for (let i = 1; i <= 30; i++) {
    const clinicName = `Clinic Seed ${i.toString().padStart(2, '0')}`;
    let cTeam = await prisma.team.findFirst({ where: { name: clinicName } });
    if (!cTeam) {
      const cOwnerEmail = `owner_seed_${i}@clinicseed.ng`;
      let cOwner = await prisma.user.findFirst({ where: { email: cOwnerEmail } });
      if (!cOwner) {
        cOwner = await prisma.user.create({
          data: {
            id: randomUUID(),
            email: cOwnerEmail,
            name: `Dr. Seed Owner ${i}`,
            passwordHash: dummyPasswordHash,
          },
        });
      }
      cTeam = await prisma.team.create({
        data: {
          id: randomUUID(),
          name: clinicName,
          timeZone: 'Africa/Lagos',
          ownerId: cOwner.id,
        },
      });
      await prisma.subscription.create({
        data: {
          teamId: cTeam.id,
          plan: 'STARTER',
          seats: 5,
          status: 'ACTIVE',
        },
      });
      await prisma.membership.create({
        data: {
          teamId: cTeam.id,
          userId: cOwner.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      otherClinics.push({ id: cTeam.id, ownerId: cOwner.id, ownerName: cOwner.name });
    } else {
      const cOwner = await prisma.user.findUniqueOrThrow({ where: { id: cTeam.ownerId } });
      otherClinics.push({ id: cTeam.id, ownerId: cOwner.id, ownerName: cOwner.name });
    }
  }

  // 3. Delete previous seeded activity rows (idempotent re-run per PRD 17.5)
  console.log('Cleaning up previous seeded activities...');
  await prisma.$executeRawUnsafe(
    `DELETE FROM activities WHERE team_id = '${gracePoint.id}'::uuid OR (payload->>'seed')::boolean = true;`
  );

  // 4. Generate 12,000 activity rows for Grace Point Clinic
  console.log('Generating 12,000 activities for Grace Point Clinic...');
  const now = DateTime.now().setZone('Africa/Lagos');
  const totalDays = 180;

  // PRD 17.5: "500 of those rows share 25 identical timestamps (20 rows each) to prove the tie-break."
  const tieBreakTimestamps: Date[] = [];
  for (let i = 0; i < 25; i++) {
    // 25 points scattered across 180 days
    const dayOffset = Math.floor((i + 1) * (totalDays / 26));
    const tiedDate = now.minus({ days: dayOffset, hours: (i * 3) % 24, minutes: (i * 11) % 60 }).toJSDate();
    tieBreakTimestamps.push(tiedDate);
  }

  type ActivityInsert = {
    id: string;
    teamId: string;
    type: string;
    actorId: string;
    subjectId: string | null;
    payload: any;
    createdAt: Date;
  };

  const gpActivities: ActivityInsert[] = [];

  // Generate the 500 tied rows (25 timestamps * 20 rows each)
  let tieIdx = 0;
  for (const tiedTime of tieBreakTimestamps) {
    for (let j = 0; j < 20; j++) {
      const actor = gpMembers[(tieIdx + j) % gpMembers.length];
      const type = ACTIVITY_TYPES[(tieIdx + j) % ACTIVITY_TYPES.length];
      const subjectType = getSubjectType(type);
      const subjectId = subjectType ? randomUUID() : null;
      const dateStr = DateTime.fromJSDate(tiedTime).toFormat('d MMM HH:mm');
      const summary = buildSummary(type, actor.name, dateStr);

      gpActivities.push({
        id: randomUUID(),
        teamId: gracePoint.id,
        type,
        actorId: actor.id,
        subjectId,
        payload: {
          seed: true,
          actorName: actor.name,
          summary,
          subjectType,
          tieGroup: tieIdx,
        },
        createdAt: tiedTime,
      });
    }
    tieIdx++;
  }

  // Generate remaining 11,500 rows with monotonically descending or spread timestamps
  const remainingCount = 12000 - 500; // 11,500
  for (let k = 0; k < remainingCount; k++) {
    const fraction = k / remainingCount;
    // Spread evenly across 180 days
    const msOffset = fraction * totalDays * 24 * 3600 * 1000;
    const itemDate = new Date(now.toMillis() - msOffset - (k % 1000));

    const actor = gpMembers[k % gpMembers.length];
    const type = ACTIVITY_TYPES[k % ACTIVITY_TYPES.length];
    const subjectType = getSubjectType(type);
    const subjectId = subjectType ? randomUUID() : null;
    const dateStr = DateTime.fromJSDate(itemDate).toFormat('d MMM HH:mm');
    const summary = buildSummary(type, actor.name, dateStr);

    gpActivities.push({
      id: randomUUID(),
      teamId: gracePoint.id,
      type,
      actorId: actor.id,
      subjectId,
      payload: {
        seed: true,
        actorName: actor.name,
        summary,
        subjectType,
      },
      createdAt: itemDate,
    });
  }

  // Insert Grace Point activities in batches of 1,000
  const BATCH_SIZE = 1000;
  for (let i = 0; i < gpActivities.length; i += BATCH_SIZE) {
    const batch = gpActivities.slice(i, i + BATCH_SIZE);
    await prisma.activity.createMany({ data: batch });
    process.stdout.write(`Inserted Grace Point activities ${i + batch.length}/${gpActivities.length}\r`);
  }
  console.log(`\nSuccessfully inserted ${gpActivities.length} Grace Point activities.`);

  // 5. Generate 1,000 activities for each of the 30 other clinics (30,000 rows total)
  console.log('Generating 1,000 activities for each of the 30 other clinics (30,000 total)...');
  for (let c = 0; c < otherClinics.length; c++) {
    const clinic = otherClinics[c];
    const clinicActivities: ActivityInsert[] = [];

    for (let k = 0; k < 1000; k++) {
      const fraction = k / 1000;
      const msOffset = fraction * totalDays * 24 * 3600 * 1000;
      const itemDate = new Date(now.toMillis() - msOffset - (k % 500));
      const type = ACTIVITY_TYPES[k % ACTIVITY_TYPES.length];
      const subjectType = getSubjectType(type);
      const subjectId = subjectType ? randomUUID() : null;
      const dateStr = DateTime.fromJSDate(itemDate).toFormat('d MMM');
      const summary = buildSummary(type, clinic.ownerName, dateStr);

      clinicActivities.push({
        id: randomUUID(),
        teamId: clinic.id,
        type,
        actorId: clinic.ownerId,
        subjectId,
        payload: {
          seed: true,
          actorName: clinic.ownerName,
          summary,
          subjectType,
        },
        createdAt: itemDate,
      });
    }

    await prisma.activity.createMany({ data: clinicActivities });
    process.stdout.write(`Inserted other clinic activities: clinic ${c + 1}/${otherClinics.length}\r`);
  }
  console.log('\nAll 30 other clinics seeded (30,000 rows). Total seeded rows: 42,000.');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  seedActivities()
    .catch((err) => {
      console.error('Error seeding activities:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
