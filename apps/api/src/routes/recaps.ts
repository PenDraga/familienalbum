import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import { requestLanguage } from '../lib/messages.en.js';
import { sendFile } from '../lib/send-file.js';
import { requireFamilyPermission } from '../plugins/permissions.js';
import { emptyResponse, errorResponses, idParamsSchema } from '../schemas/common.js';
import { createRecapBodySchema, onThisDaySchema, recapSchema } from '../schemas/recap.js';
import { MediaService } from '../services/media.service.js';
import { RecapService } from '../services/recap.service.js';

const bearer = [{ bearerAuth: [] }];

/** Familie über die Rückblick-ID in params.id (für den Rechte-Hook). */
async function recapFamilyResolver(request: FastifyRequest) {
  const id = (request.params as { id: string }).id;
  const recap = await request.server.prisma.recap.findUnique({ where: { id } });
  if (!recap) throw Errors.notFound('Rückblick nicht gefunden.', 'RECAP_NOT_FOUND');
  return recap.familyId;
}

/** Video/Poster: signierter Link aus dem DTO oder Bearer eines Mitglieds. */
function signedOrMember() {
  const hook = requireFamilyPermission('member', recapFamilyResolver);
  return async function recapFileHook(this: unknown, request: FastifyRequest, reply: FastifyReply) {
    const { exp, sig } = request.query as { exp?: string; sig?: string };
    if (exp !== undefined && sig !== undefined) {
      const path = request.url.split('?')[0]!;
      if (!request.server.signer.verify(path, exp, sig)) throw Errors.unauthorized('Der Link ist ungültig oder abgelaufen.', 'SIGNATURE_INVALID');
      return;
    }
    await hook.call(request.server, request, reply);
  };
}

export const recapRoutes: FastifyPluginAsyncZod = async (app) => {
  const recaps = new RecapService(app.prisma, app.storage, app.signer, app.mediaQueue);
  const media = new MediaService(app.prisma, app.storage, app.signer);

  app.get(
    '/families/:id/recaps',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['recaps'],
        summary: 'Rückblick-Videos der Familie (neueste zuerst)',
        security: bearer,
        params: idParamsSchema,
        response: { 200: z.array(recapSchema), ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => recaps.list(request.params.id, requestLanguage(request.headers['accept-language'])),
  );

  app.post(
    '/families/:id/recaps',
    {
      preHandler: requireFamilyPermission('canUpload'),
      schema: {
        tags: ['recaps'],
        summary: 'Rückblick anlegen oder neu bauen (canUpload) – Monat/Jahr/Sekunden-Film',
        description: 'Läuft im Hintergrund; fertige Videos melden sich per Push. 409 RECAP_EMPTY ohne Medien im Zeitraum.',
        security: bearer,
        params: idParamsSchema,
        body: createRecapBodySchema,
        response: { 202: recapSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const dto = await recaps.create(request.params.id, request.body.kind, request.body.period, requestLanguage(request.headers['accept-language']));
      return reply.code(202).send(dto);
    },
  );

  app.get(
    '/families/:id/on-this-day',
    {
      preHandler: requireFamilyPermission('member'),
      schema: {
        tags: ['recaps'],
        summary: '«An diesem Tag»: Medien vom selben Kalendertag vor 1–12 Monaten und vor 1–10 Jahren',
        security: bearer,
        params: idParamsSchema,
        response: { 200: onThisDaySchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request) => recaps.onThisDay(request.params.id, { membership: request.membership! }, media, new Date(), requestLanguage(request.headers['accept-language'])),
  );

  app.delete(
    '/recaps/:id',
    {
      preHandler: requireFamilyPermission('isFamilyAdmin', recapFamilyResolver),
      schema: {
        tags: ['recaps'],
        summary: 'Rückblick löschen (Familien-Admin)',
        security: bearer,
        params: idParamsSchema,
        response: { 204: emptyResponse, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      await recaps.remove(await recaps.get(request.params.id));
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/recaps/:id/video',
    {
      preHandler: signedOrMember(),
      schema: { tags: ['recaps'], summary: 'Rückblick-Video (MP4, 1080p)', security: [{ bearerAuth: [] }, {}], params: idParamsSchema, produces: ['video/mp4'] },
    },
    async (request, reply) => {
      const r = await recaps.get(request.params.id);
      if (r.status !== 'READY') throw Errors.notFound('Das Video ist noch nicht fertig.', 'RECAP_NOT_READY');
      return sendFile(request, reply, app.storage.recapVideoPath(r.familyId, r.id), {
        contentType: 'video/mp4',
        downloadName: `Familienalbum ${r.title}.mp4`,
        cacheSeconds: 7 * 24 * 3600,
        etag: `${r.id}-${r.readyAt?.getTime() ?? 0}`,
      });
    },
  );

  app.get(
    '/recaps/:id/poster',
    {
      preHandler: signedOrMember(),
      schema: { tags: ['recaps'], summary: 'Vorschaubild des Rückblicks', security: [{ bearerAuth: [] }, {}], params: idParamsSchema, produces: ['image/jpeg'] },
    },
    async (request, reply) => {
      const r = await recaps.get(request.params.id);
      if (r.status !== 'READY') throw Errors.notFound('Das Video ist noch nicht fertig.', 'RECAP_NOT_READY');
      return sendFile(request, reply, app.storage.recapPosterPath(r.familyId, r.id), { contentType: 'image/jpeg', cacheSeconds: 7 * 24 * 3600, etag: `${r.id}-poster` });
    },
  );
};
