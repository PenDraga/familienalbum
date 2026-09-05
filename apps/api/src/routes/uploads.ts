import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Readable } from 'node:stream';
import { requireFamilyPermission } from '../plugins/permissions.js';
import { emptyResponse, errorResponses, idParamsSchema } from '../schemas/common.js';
import { mediaSchema } from '../schemas/media.js';
import { chunkParamsSchema, createUploadBodySchema, uploadSessionSchema } from '../schemas/upload.js';
import { MediaService } from '../services/media.service.js';
import { UploadService } from '../services/upload.service.js';

const bearer = [{ bearerAuth: [] }];

/**
 * Chunk-Upload:
 *   1. POST /families/:id/uploads  → Session (409 bei Duplikat)
 *   2. PUT  /uploads/:id/chunks/:index  (application/octet-stream, ≤ chunkSize)
 *   3. POST /uploads/:id/complete  → Media (PROCESSING), Job eingereiht
 */
export const uploadRoutes: FastifyPluginAsyncZod = async (app) => {
  const uploads = new UploadService(app.prisma, app.storage, app.mediaQueue, app.config);
  const mediaService = new MediaService(app.prisma, app.storage, app.signer);

  // Rohdaten als Stream durchreichen (nur in diesem Plugin-Kontext)
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));

  app.post(
    '/families/:id/uploads',
    {
      preHandler: requireFamilyPermission('canUpload'),
      schema: {
        tags: ['media'],
        summary: 'Upload-Session anlegen (canUpload)',
        description: 'Antwort 409 mit `mediaId`, wenn die Datei (SHA-256) in der Familie schon existiert. Eine offene Session derselben Datei wird zurückgegeben (Resume).',
        security: bearer,
        params: idParamsSchema,
        body: createUploadBodySchema,
        response: { 201: uploadSessionSchema, ...errorResponses(400, 401, 403, 404, 409, 413, 415) },
      },
    },
    async (request, reply) => reply.code(201).send(await uploads.createSession(request.params.id, request.user!.id, request.body)),
  );

  app.get(
    '/uploads/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['media'],
        summary: 'Upload-Session abfragen (für Wiederaufnahme)',
        security: bearer,
        params: idParamsSchema,
        response: { 200: uploadSessionSchema, ...errorResponses(401, 404, 410) },
      },
    },
    async (request) => {
      const { toUploadSessionDto } = await import('../services/upload.service.js');
      return toUploadSessionDto(await uploads.getOwnSession(request.params.id, request.user!.id));
    },
  );

  app.put(
    '/uploads/:id/chunks/:index',
    {
      preHandler: app.authenticate,
      bodyLimit: app.config.chunkSize + 1024,
      schema: {
        tags: ['media'],
        summary: 'Chunk hochladen (application/octet-stream)',
        description: `Chunk-Grösse: ${app.config.chunkSize} Bytes (letzter Chunk kleiner). Reihenfolge egal, wiederholbar.`,
        security: bearer,
        params: chunkParamsSchema,
        consumes: ['application/octet-stream'],
        response: { 200: uploadSessionSchema, ...errorResponses(400, 401, 404, 410, 413) },
      },
    },
    async (request) => uploads.putChunk(request.params.id, request.user!.id, request.params.index, request.body as Readable),
  );

  app.post(
    '/uploads/:id/complete',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['media'],
        summary: 'Upload abschliessen → Medium (Status PROCESSING)',
        security: bearer,
        params: idParamsSchema,
        response: { 201: mediaSchema, ...errorResponses(400, 401, 404, 409, 410) },
      },
    },
    async (request, reply) => {
      const media = await uploads.complete(request.params.id, request.user!.id);
      const membership = await app.prisma.familyMember.findUniqueOrThrow({
        where: { userId_familyId: { userId: request.user!.id, familyId: media.familyId } },
      });
      return reply.code(201).send(mediaService.toDto(media, { membership }));
    },
  );

  app.delete(
    '/uploads/:id',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['media'],
        summary: 'Upload abbrechen',
        security: bearer,
        params: idParamsSchema,
        response: { 204: emptyResponse, ...errorResponses(401, 404) },
      },
    },
    async (request, reply) => {
      await uploads.abort(request.params.id, request.user!.id);
      return reply.code(204).send(null);
    },
  );
};
