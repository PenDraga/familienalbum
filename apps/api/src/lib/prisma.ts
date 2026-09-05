import { PrismaClient } from '@prisma/client';

export function createPrismaClient(databaseUrl: string, logQueries = false): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}
