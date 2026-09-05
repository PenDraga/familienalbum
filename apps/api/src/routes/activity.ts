import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Errors } from '../lib/errors.js';
import { requireFamilyPermission } from '../plugins/permissions.js';
import {
  activityQuerySchema,
  activityResponseSchema,
  feedQuerySchema,
  feedResponseSchema,
  seenResponseSchema,
} from '../schemas/activity.js';
import { errorResponses, idParamsSchema } from '../schemas/common.js';
import { ActivityService } from '../services/activity.service.js';

const bearer = [{ bearerAuth: [] }];

/** Aktivität einer Familie: Zähler für Ungelesenes (Polling/Badge), Verlauf und „gesehen“-Markierung. */
export const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  const activity = new ActivityService(app.prisma, app.signer);

  app.get(
    '/families/:id/activity',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['activity'],
        summary: 'Was ist seit `since` in der Familie passiert? (ohne eigene Beiträge)',
        description: 'Ohne `since` zählt ab dem zuletzt gesehenen Zeitpunkt (POST …/activity/seen) bzw. dem Beitritt – für den Ungelesen-Zähler.',
        security: bearer,
        params: idParamsSchema,
        querystring: activityQuerySchema,
        response: { 200: activityResponseSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const since = request.query.since ? new Date(request.query.since) : activity.seenSince(request.membership!);
      const serverTime = new Date();
      const counts = await activity.unread(request.params.id, request.user!.id, since);
      return { newMedia: counts.media, newComments: counts.comments, since: since.toISOString(), serverTime: serverTime.toISOString() };
    },
  );

  app.get(
    '/families/:id/activity/feed',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['activity'],
        summary: 'Verlauf: Upload-Serien und Kommentare, neueste zuerst',
        description: 'Uploads derselben Person mit höchstens einer Stunde Abstand bilden eine Serie. Cursor = Zeitpunkt des letzten Eintrags.',
        security: bearer,
        params: idParamsSchema,
        querystring: feedQuerySchema,
        response: { 200: feedResponseSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      try {
        return await activity.feed(request.params.id, request.membership!, request.query);
      } catch (e) {
        if (e instanceof Error && e.message === 'Ungültiger Cursor') throw Errors.badRequest('Ungültiger Cursor.', 'INVALID_CURSOR');
        throw e;
      }
    },
  );

  app.post(
    '/families/:id/activity/seen',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['activity'],
        summary: 'Aktivität bis jetzt als gesehen markieren',
        security: bearer,
        params: idParamsSchema,
        response: { 200: seenResponseSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => ({ seenAt: (await activity.markSeen(request.params.id, request.user!.id)).toISOString() }),
  );
};
