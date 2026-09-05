import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listUsersQuerySchema, statsSchema } from '../schemas/admin.js';
import { errorResponses, idParamsSchema } from '../schemas/common.js';
import { addMemberBodySchema, familyAdminSchema, familySchema, memberSchema, membershipFlagsSchema } from '../schemas/family.js';
import { createUserBodySchema, updateUserBodySchema, userPublicSchema } from '../schemas/user.js';
import { FamilyService } from '../services/family.service.js';
import { UserService } from '../services/user.service.js';

const bearer = [{ bearerAuth: [] }];

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  const users = new UserService(app.prisma);
  const families = new FamilyService(app.prisma);

  // Alle Routen in diesem Plugin verlangen globalen Admin.
  app.addHook('preHandler', app.requireAdmin);

  app.get(
    '/admin/users',
    {
      schema: {
        tags: ['admin'],
        summary: 'Benutzer auflisten',
        security: bearer,
        querystring: listUsersQuerySchema,
        response: {
          200: z.object({ items: z.array(userPublicSchema), total: z.number().int() }),
          ...errorResponses(401, 403),
        },
      },
    },
    async (request) => users.list(request.query),
  );

  app.get(
    '/admin/users/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'Benutzer mit Familien und Rechten',
        security: bearer,
        params: idParamsSchema,
        response: {
          200: userPublicSchema.extend({
            deviceCount: z.number().int(),
            families: z.array(
              familySchema.extend({
                membership: membershipFlagsSchema.extend({ joinedAt: z.iso.datetime(), lastSeenAt: z.iso.datetime().nullable() }),
              }),
            ),
          }),
          ...errorResponses(401, 403, 404),
        },
      },
    },
    async (request) => users.getWithMemberships(request.params.id),
  );

  app.get(
    '/admin/families',
    {
      schema: {
        tags: ['admin'],
        summary: 'Alle Familien mit Mitglieder- und Medienzahl',
        security: bearer,
        response: { 200: z.array(familyAdminSchema), ...errorResponses(401, 403) },
      },
    },
    async () => families.listAll(),
  );

  app.post(
    '/admin/users',
    {
      schema: {
        tags: ['admin'],
        summary: 'Benutzer anlegen',
        security: bearer,
        body: createUserBodySchema,
        response: { 201: userPublicSchema, ...errorResponses(400, 401, 403, 409) },
      },
    },
    async (request, reply) => reply.code(201).send(await users.create(request.body)),
  );

  app.patch(
    '/admin/users/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'Benutzer ändern (Name, Admin, Sperre, Passwort)',
        security: bearer,
        params: idParamsSchema,
        body: updateUserBodySchema,
        response: { 200: userPublicSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => users.update(request.params.id, request.body, request.user!.id),
  );

  app.post(
    '/admin/families/:id/members',
    {
      schema: {
        tags: ['admin'],
        summary: 'Bestehenden Benutzer direkt einer Familie hinzufügen',
        description: 'So fügt sich ein globaler Admin selbst (oder andere) einer Familie hinzu – Admins umgehen Familienrechte nicht automatisch.',
        security: bearer,
        params: idParamsSchema,
        body: addMemberBodySchema,
        response: { 201: memberSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const { userId, ...flags } = request.body;
      return reply.code(201).send(await families.addMember(request.params.id, userId, flags));
    },
  );

  app.get(
    '/admin/stats',
    {
      schema: {
        tags: ['admin'],
        summary: 'Statistik (Benutzer, Familien, Medien, Speicher)',
        security: bearer,
        response: { 200: statsSchema, ...errorResponses(401, 403) },
      },
    },
    async () => users.stats(),
  );
};
