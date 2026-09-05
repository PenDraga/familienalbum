import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponses } from '../schemas/common.js';
import { familySchema, membershipFlagsSchema } from '../schemas/family.js';
import { userPublicSchema } from '../schemas/user.js';
import { UserService } from '../services/user.service.js';

export const meResponseSchema = userPublicSchema
  .extend({
    families: z.array(
      familySchema.extend({
        membership: membershipFlagsSchema.extend({
          joinedAt: z.iso.datetime(),
          lastSeenAt: z.iso.datetime().nullable(),
        }),
      }),
    ),
  })
  .meta({ id: 'Me' });

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const users = new UserService(app.prisma);

  app.get(
    '/me',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['me'],
        summary: 'Eigenes Profil inkl. Familien und Rechten',
        security: [{ bearerAuth: [] }],
        response: { 200: meResponseSchema, ...errorResponses(401, 403) },
      },
    },
    async (request) => users.getMe(request.user!.id),
  );
};
