import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import { sendFile } from '../lib/send-file.js';
import { MIME_EXTENSIONS } from '../lib/storage.js';
import { requireFamilyPermission, type FamilyPermission } from '../plugins/permissions.js';
import { mediaFamilyResolver } from '../plugins/resolvers.js';
import { emptyResponse, errorResponses, idParamsSchema } from '../schemas/common.js';
import {
  batchTakenAtBodySchema,
  batchTakenAtResponseSchema,
  mediaInfoSchema,
  mediaSchema,
  monthSummarySchema,
  thumbParamsSchema,
  timelineQuerySchema,
  timelineResponseSchema,
  updateMediaBodySchema,
} from '../schemas/media.js';
import { MediaService } from '../services/media.service.js';

const bearer = [{ bearerAuth: [] }];

/**
 * Datei-Routen akzeptieren entweder eine gültige Signatur (?exp=&sig=, aus den `urls` im Media-DTO)
 * oder ein Bearer-Token mit der nötigen Familienberechtigung.
 */
function signedOrPermission(permission: FamilyPermission) {
  const hook = requireFamilyPermission(permission, mediaFamilyResolver);
  return async function fileAccessHook(this: unknown, request: FastifyRequest, reply: FastifyReply) {
    const { exp, sig } = request.query as { exp?: string; sig?: string };
    const path = request.url.split('?')[0]!;
    if (exp !== undefined && sig !== undefined) {
      if (!request.server.signer.verify(path, exp, sig)) {
        throw Errors.unauthorized('Der Link ist ungültig oder abgelaufen.', 'SIGNATURE_INVALID');
      }
      await mediaFamilyResolver(request);
      return;
    }
    await hook.call(request.server, request, reply);
  };
}

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  const media = new MediaService(app.prisma, app.storage, app.signer);
  const ctx = (request: FastifyRequest) => ({ membership: request.membership! });

  // ---------- Timeline ----------

  app.get(
    '/families/:id/timeline',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['media'],
        summary: 'Timeline (neueste zuerst, nach Monat gruppiert, cursor-paginiert)',
        security: bearer,
        params: idParamsSchema,
        querystring: timelineQuerySchema,
        response: { 200: timelineResponseSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => media.timeline(request.params.id, ctx(request), request.query),
  );

  app.get(
    '/families/:id/timeline/months',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['media'],
        summary: 'Anzahl Medien pro Monat',
        security: bearer,
        params: idParamsSchema,
        response: { 200: z.array(monthSummarySchema), ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => media.months(request.params.id),
  );

  // ---------- Einzelnes Medium ----------

  app.get(
    '/media/:id',
    {
      preHandler: requireFamilyPermission('member', mediaFamilyResolver),
      schema: {
        tags: ['media'],
        summary: 'Medium mit signierten URLs',
        security: bearer,
        params: idParamsSchema,
        response: { 200: mediaSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => media.get(request.params.id, ctx(request)),
  );

  app.patch(
    '/media/:id',
    {
      preHandler: requireFamilyPermission('member', mediaFamilyResolver),
      schema: {
        tags: ['media'],
        summary: 'Beschreibung oder Aufnahmedatum ändern (Uploader oder Familien-Admin)',
        security: bearer,
        params: idParamsSchema,
        body: updateMediaBodySchema,
        response: { 200: mediaSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) =>
      media.update(
        request.media!,
        { caption: request.body.caption, takenAt: request.body.takenAt ? new Date(request.body.takenAt) : undefined },
        ctx(request),
      ),
  );

  app.get(
    '/media/:id/info',
    {
      preHandler: requireFamilyPermission('member', mediaFamilyResolver),
      schema: {
        tags: ['media'],
        summary: 'Aufnahme-Metadaten (Kamera, Belichtung, GPS) und Dateiinfos',
        security: bearer,
        params: idParamsSchema,
        response: { 200: mediaInfoSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => media.info(request.media!),
  );

  app.post(
    '/families/:id/media/taken-at',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['media'],
        summary: 'Aufnahmedatum mehrerer Medien setzen oder verschieben',
        description: 'Nur eigene Medien bzw. alle als Familien-Admin; nicht erlaubte IDs werden in `skipped` zurückgegeben.',
        security: bearer,
        params: idParamsSchema,
        body: batchTakenAtBodySchema,
        response: { 200: batchTakenAtResponseSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) =>
      media.batchUpdateTakenAt(
        request.params.id,
        request.body.ids,
        { takenAt: request.body.takenAt ? new Date(request.body.takenAt) : undefined, shiftSeconds: request.body.shiftSeconds },
        ctx(request),
      ),
  );

  app.delete(
    '/media/:id',
    {
      preHandler: requireFamilyPermission('member', mediaFamilyResolver),
      schema: {
        tags: ['media'],
        summary: 'Medium löschen (Uploader oder Familien-Admin, Soft-Delete)',
        security: bearer,
        params: idParamsSchema,
        response: { 204: emptyResponse, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      await media.softDelete(request.media!, ctx(request));
      return reply.code(204).send(null);
    },
  );

  // ---------- Dateien ----------

  app.get(
    '/media/:id/thumb/:size',
    {
      preHandler: signedOrPermission('member'),
      schema: {
        tags: ['media'],
        summary: 'Thumbnail (WebP, 400 oder 1600 px Kante)',
        description: 'Zugriff per signierter URL (aus `urls`) oder Bearer-Token (Mitglied).',
        security: [{ bearerAuth: [] }, {}],
        params: thumbParamsSchema,
        produces: ['image/webp'],
      },
    },
    async (request, reply) => {
      const m = request.media!;
      if (m.status !== 'READY') throw Errors.notFound('Das Medium wird noch verarbeitet.', 'MEDIA_NOT_READY');
      const size = request.params.size === '400' ? 400 : 1600;
      return sendFile(request, reply, app.storage.thumbPath(m.familyId, m.id, size), {
        contentType: 'image/webp',
        cacheSeconds: 7 * 86400,
        etag: `${m.id}-t${size}`,
      });
    },
  );

  app.get(
    '/media/:id/preview',
    {
      preHandler: signedOrPermission('member'),
      schema: {
        tags: ['media'],
        summary: 'Video-Preview (MP4 H.264, max. 1080p, Range-Requests)',
        security: [{ bearerAuth: [] }, {}],
        params: idParamsSchema,
        produces: ['video/mp4'],
      },
    },
    async (request, reply) => {
      const m = request.media!;
      if (m.type !== 'VIDEO') throw Errors.notFound('Nur Videos haben eine Preview.', 'NOT_A_VIDEO');
      if (m.status !== 'READY') throw Errors.notFound('Das Video wird noch verarbeitet.', 'MEDIA_NOT_READY');
      return sendFile(request, reply, app.storage.previewPath(m.familyId, m.id), {
        contentType: 'video/mp4',
        cacheSeconds: 7 * 86400,
        etag: `${m.id}-p`,
      });
    },
  );

  app.get(
    '/media/:id/original',
    {
      preHandler: signedOrPermission('canDownload'),
      schema: {
        tags: ['media'],
        summary: 'Original herunterladen (canDownload)',
        description: 'Per Bearer-Token nur mit canDownload; signierte Links werden nur an Mitglieder mit canDownload ausgegeben.',
        security: [{ bearerAuth: [] }, {}],
        params: idParamsSchema,
        produces: ['application/octet-stream'],
      },
    },
    async (request, reply) => {
      const m = request.media!;
      const ext = MIME_EXTENSIONS[m.mimeType]?.ext ?? 'bin';
      return sendFile(request, reply, app.storage.originalPath(m.familyId, m.id, ext), {
        contentType: m.mimeType,
        downloadName: m.originalName,
        cacheSeconds: 3600,
        etag: `${m.id}-o`,
      });
    },
  );
};
