import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFamilyPermission } from '../plugins/permissions.js';
import { commentFamilyResolver, mediaFamilyResolver } from '../plugins/resolvers.js';
import { commentSchema, createCommentBodySchema } from '../schemas/comment.js';
import { emptyResponse, errorResponses, idParamsSchema } from '../schemas/common.js';
import { CommentService } from '../services/comment.service.js';

const bearer = [{ bearerAuth: [] }];

export const commentRoutes: FastifyPluginAsyncZod = async (app) => {
  const comments = new CommentService(app.prisma);
  const ctx = (request: FastifyRequest) => ({ userId: request.user!.id, isFamilyAdmin: request.membership!.isFamilyAdmin });

  app.get(
    '/media/:id/comments',
    {
      preHandler: requireFamilyPermission('member', mediaFamilyResolver),
      schema: {
        tags: ['comments'],
        summary: 'Kommentare eines Mediums (älteste zuerst)',
        security: bearer,
        params: idParamsSchema,
        response: { 200: z.array(commentSchema), ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => comments.list(request.params.id, ctx(request)),
  );

  app.post(
    '/media/:id/comments',
    {
      preHandler: requireFamilyPermission('canComment', mediaFamilyResolver),
      schema: {
        tags: ['comments'],
        summary: 'Kommentar schreiben (canComment)',
        security: bearer,
        params: idParamsSchema,
        body: createCommentBodySchema,
        response: { 201: commentSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const comment = await comments.create(request.media!, request.user!.id, request.body.body, ctx(request));
      // Push im Hintergrund – der Request wartet nicht darauf
      app.notifications.notifyNewComment(comment.id).catch((err) => request.log.warn({ err }, 'comment push failed'));
      return reply.code(201).send(comment);
    },
  );

  app.delete(
    '/comments/:id',
    {
      preHandler: requireFamilyPermission('member', commentFamilyResolver),
      schema: {
        tags: ['comments'],
        summary: 'Kommentar löschen (Autor oder Familien-Admin)',
        security: bearer,
        params: idParamsSchema,
        response: { 204: emptyResponse, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      await comments.delete(request.params.id, ctx(request));
      return reply.code(204).send(null);
    },
  );
};
