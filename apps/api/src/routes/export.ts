import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { API_PREFIX } from '../config/constants.js';
import { Errors } from '../lib/errors.js';
import { requireFamilyPermission } from '../plugins/permissions.js';
import { errorResponses, idParamsSchema } from '../schemas/common.js';
import { ExportService } from '../services/export.service.js';

const bearer = [{ bearerAuth: [] }];

const scopeSchema = z.string().regex(/^(alle|\d{4}-\d{2})$/, 'alle oder JJJJ-MM');
const exportParamsSchema = idParamsSchema.extend({ scope: scopeSchema });

export const exportLinkSchema = z
  .object({
    url: z.string(),
    expiresAt: z.iso.datetime(),
    scope: z.string(),
  })
  .meta({ id: 'ExportLink' });

/** Signierter Link (aus /export-link) oder Bearer mit canDownload – analog zu den Datei-Routen. */
function signedOrDownloadPermission() {
  const hook = requireFamilyPermission('canDownload');
  return async function exportAccessHook(this: unknown, request: FastifyRequest, reply: FastifyReply) {
    const { exp, sig } = request.query as { exp?: string; sig?: string };
    const path = request.url.split('?')[0]!;
    if (exp !== undefined && sig !== undefined) {
      if (!request.server.signer.verify(path, exp, sig)) {
        throw Errors.unauthorized('Der Link ist ungültig oder abgelaufen.', 'SIGNATURE_INVALID');
      }
      return;
    }
    await hook.call(request.server, request, reply);
  };
}

/** Der Link soll auch bei langsamen Verbindungen reichen, um den Download zu starten. */
const EXPORT_LINK_TTL_SECONDS = 60 * 60;

export const exportRoutes: FastifyPluginAsyncZod = async (app) => {
  const exporter = new ExportService(app.prisma, app.storage);

  app.get(
    '/families/:id/export-link/:scope',
    {
      preHandler: requireFamilyPermission('canDownload'),
      schema: {
        tags: ['export'],
        summary: 'Signierten Download-Link für den Export erzeugen (canDownload)',
        description: 'scope = `alle` oder ein Monat `JJJJ-MM`. Der Link ist eine Stunde gültig und braucht kein Token.',
        security: bearer,
        params: exportParamsSchema,
        response: { 200: exportLinkSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const { id, scope } = request.params;
      const url = app.signer.sign(`${API_PREFIX}/families/${id}/export/${scope}`, EXPORT_LINK_TTL_SECONDS);
      return { url, expiresAt: new Date(Date.now() + EXPORT_LINK_TTL_SECONDS * 1000).toISOString(), scope };
    },
  );

  app.get(
    '/families/:id/export/:scope',
    {
      preHandler: signedOrDownloadPermission(),
      schema: {
        tags: ['export'],
        summary: 'Alle Fotos, Videos und Kommentare als ZIP (canDownload oder signierter Link)',
        description:
          'Streamt ein ZIP ohne Kompression: Originale unter JJJJ/MM/, index.json mit allen Metadaten und Kommentaren, ' +
          'kommentare.md zum Lesen. scope = `alle` oder `JJJJ-MM`.',
        security: [{ bearerAuth: [] }, {}],
        params: exportParamsSchema,
        produces: ['application/zip'],
      },
    },
    async (request, reply) => {
      const { id, scope } = request.params;
      const { filename, archive, count } = await exporter.build(id, scope);
      request.log.info({ familyId: id, scope, count }, 'export started');

      archive.on('warning', (err) => request.log.warn({ err }, 'export warning'));
      archive.on('error', (err) => {
        request.log.error({ err }, 'export failed');
        archive.destroy(err);
      });
      // Abbruch durch den Client (Download gestoppt) nicht als Fehler werten
      request.raw.on('close', () => {
        if (!archive.destroyed) archive.abort();
      });

      reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .header('cache-control', 'no-store');
      void archive.finalize();
      return reply.send(archive);
    },
  );
};
