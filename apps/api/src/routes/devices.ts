import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { deleteDeviceBodySchema, deviceBodySchema } from '../schemas/comment.js';
import { emptyResponse, errorResponses } from '../schemas/common.js';

const bearer = [{ bearerAuth: [] }];

/** FCM-Token pro Gerät. Ein Token gehört immer genau einem Benutzer (wird bei Kontowechsel umgehängt). */
export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/devices',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['push'],
        summary: 'Push-Token registrieren oder aktualisieren',
        security: bearer,
        body: deviceBodySchema,
        response: { 204: emptyResponse, ...errorResponses(400, 401) },
      },
    },
    async (request, reply) => {
      const { fcmToken, platform } = request.body;
      await app.prisma.device.upsert({
        where: { fcmToken },
        create: { fcmToken, platform, userId: request.user!.id },
        update: { platform, userId: request.user!.id, lastError: null },
      });
      return reply.code(204).send(null);
    },
  );

  app.delete(
    '/devices',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['push'],
        summary: 'Push-Token entfernen (z.B. beim Abmelden)',
        security: bearer,
        body: deleteDeviceBodySchema,
        response: { 204: emptyResponse, ...errorResponses(400, 401) },
      },
    },
    async (request, reply) => {
      await app.prisma.device.deleteMany({ where: { fcmToken: request.body.fcmToken, userId: request.user!.id } });
      return reply.code(204).send(null);
    },
  );
};
