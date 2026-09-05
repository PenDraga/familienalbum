import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Errors } from '../lib/errors.js';
import { errorResponses } from '../schemas/common.js';
import {
  acceptInviteBodySchema,
  acceptInviteResponseSchema,
  inviteCodeParamsSchema,
  invitePreviewSchema,
} from '../schemas/invite.js';
import { AuthService } from '../services/auth.service.js';
import { InviteService } from '../services/invite.service.js';

export const inviteRoutes: FastifyPluginAsyncZod = async (app) => {
  const invites = new InviteService(app.prisma, new AuthService(app.prisma, app.tokens, app.config));

  app.get(
    '/invites/:code',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['invites'],
        summary: 'Einladung ansehen (ohne Login)',
        params: inviteCodeParamsSchema,
        response: { 200: invitePreviewSchema, ...errorResponses(404, 429) },
      },
    },
    async (request) => invites.preview(request.params.code.toUpperCase()),
  );

  app.post(
    '/invites/:code/accept',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['invites'],
        summary: 'Einladung annehmen',
        description:
          'Angemeldet (Bearer-Token, leerer Body): der Benutzer wird Mitglied. ' +
          'Nicht angemeldet: Body mit email/password/displayName legt ein neues Konto an und gibt Tokens zurück.',
        security: [{ bearerAuth: [] }, {}],
        params: inviteCodeParamsSchema,
        body: acceptInviteBodySchema,
        response: { 200: acceptInviteResponseSchema, ...errorResponses(400, 401, 403, 404, 409, 410, 429) },
      },
    },
    async (request, reply) => {
      const code = request.params.code.toUpperCase();
      const userAgent = request.headers['user-agent'];

      if (request.headers.authorization) {
        await app.authenticate(request, reply);
        return invites.accept(code, { userId: request.user!.id }, userAgent);
      }
      if (!request.body) {
        throw Errors.badRequest(
          'Ohne Anmeldung müssen email, password und displayName angegeben werden.',
          'REGISTRATION_REQUIRED',
        );
      }
      return invites.accept(code, { registration: request.body }, userAgent);
    },
  );
};
