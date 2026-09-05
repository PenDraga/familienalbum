import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireFamilyPermission } from '../plugins/permissions.js';
import { activityQuerySchema, activityResponseSchema } from '../schemas/comment.js';
import { errorResponses, idParamsSchema } from '../schemas/common.js';

const bearer = [{ bearerAuth: [] }];

/** Polling-Endpunkt für Clients ohne Push (Web, Windows) und für den Vordergrund. */
export const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/families/:id/activity',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['push'],
        summary: 'Was ist seit `since` in der Familie passiert? (ohne eigene Beiträge)',
        security: bearer,
        params: idParamsSchema,
        querystring: activityQuerySchema,
        response: { 200: activityResponseSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const since = new Date(request.query.since);
      const serverTime = new Date();
      const familyId = request.params.id;
      const userId = request.user!.id;

      const [newMedia, newComments] = await Promise.all([
        app.prisma.media.count({
          where: { familyId, status: 'READY', deletedAt: null, uploadedAt: { gt: since }, NOT: { uploaderId: userId } },
        }),
        app.prisma.comment.count({
          where: { createdAt: { gt: since }, NOT: { authorId: userId }, media: { familyId, deletedAt: null } },
        }),
      ]);

      return { newMedia, newComments, serverTime: serverTime.toISOString() };
    },
  );
};
