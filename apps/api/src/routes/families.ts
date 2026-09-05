import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import { requireFamilyPermission } from '../plugins/permissions.js';
import { emptyResponse, errorResponses, idParamsSchema } from '../schemas/common.js';
import {
  createFamilyBodySchema,
  createMemberAccountBodySchema,
  familySchema,
  familyWithMembershipSchema,
  memberParamsSchema,
  memberSchema,
  updateFamilyBodySchema,
  updateMemberBodySchema,
} from '../schemas/family.js';
import { createInviteBodySchema, inviteIdParamsSchema, inviteSchema } from '../schemas/invite.js';
import { AuthService } from '../services/auth.service.js';
import { FamilyService } from '../services/family.service.js';
import { InviteService } from '../services/invite.service.js';

const bearer = [{ bearerAuth: [] }];

export const familyRoutes: FastifyPluginAsyncZod = async (app) => {
  const families = new FamilyService(app.prisma);
  const invites = new InviteService(app.prisma, new AuthService(app.prisma, app.tokens, app.config));

  // ---------- Familien ----------

  app.get(
    '/families',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['families'],
        summary: 'Eigene Familien',
        security: bearer,
        response: { 200: z.array(familyWithMembershipSchema), ...errorResponses(401) },
      },
    },
    async (request) => families.listForUser(request.user!.id),
  );

  app.post(
    '/families',
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ['families', 'admin'],
        summary: 'Familie anlegen (globaler Admin)',
        security: bearer,
        body: createFamilyBodySchema,
        response: { 201: familySchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => reply.code(201).send(await families.create(request.body)),
  );

  app.get(
    '/families/:id',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['families'],
        summary: 'Familie (nur Mitglieder)',
        security: bearer,
        params: idParamsSchema,
        response: { 200: familyWithMembershipSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => families.getForMember(request.params.id, request.user!.id),
  );

  app.patch(
    '/families/:id',
    {
      preHandler: requireFamilyPermission('isFamilyAdmin'),
      schema: {
        tags: ['families'],
        summary: 'Familie umbenennen (Familien-Admin)',
        security: bearer,
        params: idParamsSchema,
        body: updateFamilyBodySchema,
        response: { 200: familySchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => families.rename(request.params.id, request.body.name),
  );

  app.delete(
    '/families/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ['families', 'admin'],
        summary: 'Familie löschen (globaler Admin)',
        security: bearer,
        params: idParamsSchema,
        response: { 204: emptyResponse, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      await families.delete(request.params.id);
      return reply.code(204).send(null);
    },
  );

  // ---------- Mitglieder ----------

  app.get(
    '/families/:id/members',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['families'],
        summary: 'Mitglieder einer Familie',
        security: bearer,
        params: idParamsSchema,
        response: { 200: z.array(memberSchema), ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => families.listMembers(request.params.id),
  );

  app.post(
    '/families/:id/members',
    {
      preHandler: requireFamilyPermission('isFamilyAdmin'),
      schema: {
        tags: ['families'],
        summary: 'Neues Konto anlegen und als Mitglied aufnehmen (Familien-Admin)',
        description: 'Alternative zur Einladung, z.B. für Grosseltern. Bestehende Konten → 409, dafür Einladungscode nutzen.',
        security: bearer,
        params: idParamsSchema,
        body: createMemberAccountBodySchema,
        response: { 201: memberSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => reply.code(201).send(await families.createMemberAccount(request.params.id, request.body)),
  );

  app.patch(
    '/families/:id/members/:userId',
    {
      preHandler: requireFamilyPermission('isFamilyAdmin'),
      schema: {
        tags: ['families'],
        summary: 'Rechte eines Mitglieds ändern (Familien-Admin)',
        security: bearer,
        params: memberParamsSchema,
        body: updateMemberBodySchema,
        response: { 200: memberSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => families.updateMember(request.params.id, request.params.userId, request.body),
  );

  app.delete(
    '/families/:id/members/:userId',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['families'],
        summary: 'Mitglied entfernen (Familien-Admin) oder selbst austreten',
        security: bearer,
        params: memberParamsSchema,
        response: { 204: emptyResponse, ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const isSelf = request.params.userId === request.user!.id;
      if (!isSelf && !request.membership!.isFamilyAdmin) {
        throw Errors.forbidden('Nur Familien-Administratoren dürfen andere Mitglieder entfernen.', 'PERMISSION_ISFAMILYADMIN');
      }
      await families.removeMember(request.params.id, request.params.userId);
      return reply.code(204).send(null);
    },
  );

  // ---------- Einladungen (Verwaltung) ----------

  app.post(
    '/families/:id/invites',
    {
      preHandler: requireFamilyPermission('isFamilyAdmin'),
      schema: {
        tags: ['invites'],
        summary: 'Einladung erzeugen (Familien-Admin)',
        security: bearer,
        params: idParamsSchema,
        body: createInviteBodySchema,
        response: { 201: inviteSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await invites.create(request.params.id, request.user!.id, request.body)),
  );

  app.get(
    '/families/:id/invites',
    {
      preHandler: requireFamilyPermission('isFamilyAdmin'),
      schema: {
        tags: ['invites'],
        summary: 'Aktive Einladungen (Familien-Admin)',
        security: bearer,
        params: idParamsSchema,
        response: { 200: z.array(inviteSchema), ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => invites.listActive(request.params.id),
  );

  app.delete(
    '/families/:id/invites/:inviteId',
    {
      preHandler: requireFamilyPermission('isFamilyAdmin'),
      schema: {
        tags: ['invites'],
        summary: 'Einladung widerrufen (Familien-Admin)',
        security: bearer,
        params: inviteIdParamsSchema,
        response: { 204: emptyResponse, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      await invites.revoke(request.params.id, request.params.inviteId);
      return reply.code(204).send(null);
    },
  );
};
