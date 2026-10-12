import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma.js';

/**
 * Team isolation extension (PRD 6.2, 15.5):
 * Ensures all queries on team-scoped tables automatically enforce teamId filtering.
 * Throws immediately if teamId is missing.
 */
export function forTeam(teamId: string, client: PrismaClient = defaultPrisma) {
  if (!teamId || typeof teamId !== 'string' || !teamId.trim()) {
    throw new Error('Team isolation violation: teamId is required');
  }

  const tid = teamId.trim();

  return client.$extends({
    name: 'teamIsolation',
    query: {
      team: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, id: tid };
          }
          return query(args);
        },
      },
      membership: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
      invite: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
      shift: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
      swapRequest: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
      activity: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
      subscription: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
      ledgerEntry: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
      paymentAttempt: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
      outboxEvent: {
        async $allOperations({ args, query }) {
          if ('where' in args && args.where) {
            args.where = { ...args.where, teamId: tid };
          }
          return query(args);
        },
      },
    },
  });
}
