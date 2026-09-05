import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness/Readiness',
        response: {
          200: z.object({ status: z.literal('ok'), database: z.enum(['up', 'down']), time: z.iso.datetime() }),
        },
      },
    },
    async () => {
      let database: 'up' | 'down' = 'up';
      try {
        await app.prisma.$queryRaw`SELECT 1`;
      } catch {
        database = 'down';
      }
      return { status: 'ok' as const, database, time: new Date().toISOString() };
    },
  );
};
