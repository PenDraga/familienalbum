import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Errors } from '../lib/errors.js';
import {
  loginBodySchema,
  loginResponseSchema,
  logoutBodySchema,
  passwordResetConfirmBodySchema,
  passwordResetConfirmResponseSchema,
  passwordResetRequestBodySchema,
  refreshBodySchema,
} from '../schemas/auth.js';
import { emptyResponse, errorResponses } from '../schemas/common.js';
import { AuthService } from '../services/auth.service.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const auth = new AuthService(app.prisma, app.tokens, app.config);

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Anmelden mit E-Mail und Passwort',
        body: loginBodySchema,
        response: { 200: loginResponseSchema, ...errorResponses(400, 401, 403, 429) },
      },
    },
    async (request) => auth.login(request.body.email, request.body.password, request.headers['user-agent']),
  );

  app.post(
    '/auth/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Neues Token-Paar mit Refresh-Token holen (Rotation)',
        body: refreshBodySchema,
        response: { 200: loginResponseSchema, ...errorResponses(400, 401, 403, 429) },
      },
    },
    async (request) => auth.refresh(request.body.refreshToken, request.headers['user-agent']),
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Abmelden (Refresh-Token widerrufen)',
        description:
          'Ohne Access-Token wird nur das übergebene Refresh-Token widerrufen. Mit Access-Token und `all: true` werden alle Sitzungen des Benutzers beendet.',
        body: logoutBodySchema,
        security: [{ bearerAuth: [] }, {}],
        response: { 204: emptyResponse, ...errorResponses(400, 401) },
      },
    },
    async (request, reply) => {
      if (request.body.all) {
        await app.authenticate(request, reply);
        await auth.logoutAll(request.user!.id);
      } else if (request.body.refreshToken) {
        await auth.logout(request.body.refreshToken);
      } else {
        throw Errors.badRequest('refreshToken oder all:true angeben.', 'LOGOUT_TARGET_MISSING');
      }
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/auth/password-reset',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Passwort vergessen: Link per E-Mail anfordern',
        description:
          'Antwortet immer mit 204, auch für unbekannte Adressen (keine Rückschlüsse auf Konten). 503, wenn der Server keinen Mail-Versand hat.',
        body: passwordResetRequestBodySchema,
        response: { 204: emptyResponse, ...errorResponses(400, 429, 503) },
      },
    },
    async (request, reply) => {
      await app.passwordReset.request(request.body.email);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/auth/password-reset/confirm',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Neues Passwort mit dem Link-Token setzen',
        description: 'Verbraucht das Token und beendet alle Sitzungen des Benutzers.',
        body: passwordResetConfirmBodySchema,
        response: { 200: passwordResetConfirmResponseSchema, ...errorResponses(400, 403, 429) },
      },
    },
    async (request) => app.passwordReset.confirm(request.body.token, request.body.password),
  );
};
