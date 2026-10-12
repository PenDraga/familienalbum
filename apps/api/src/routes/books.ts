import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import { requestLanguage } from '../lib/messages.en.js';
import { sendFile } from '../lib/send-file.js';
import { requireFamilyPermission } from '../plugins/permissions.js';
import { bookDetailSchema, bookPageParamsSchema, bookSchema, createBookBodySchema, updateBookBodySchema } from '../schemas/book.js';
import { emptyResponse, errorResponses, idParamsSchema } from '../schemas/common.js';
import { BookService } from '../services/book.service.js';

const bearer = [{ bearerAuth: [] }];

async function bookFamilyResolver(request: FastifyRequest) {
  const id = (request.params as { id: string }).id;
  const book = await request.server.prisma.photoBook.findUnique({ where: { id }, select: { familyId: true } });
  if (!book) throw Errors.notFound('Fotobuch nicht gefunden.', 'BOOK_NOT_FOUND');
  return book.familyId;
}

/** PDF/Seiten: signierter Link aus dem DTO oder Bearer eines Mitglieds. */
function signedOrMember() {
  const hook = requireFamilyPermission('member', bookFamilyResolver);
  return async function bookFileHook(this: unknown, request: FastifyRequest, reply: FastifyReply) {
    const { exp, sig } = request.query as { exp?: string; sig?: string };
    if (exp !== undefined && sig !== undefined) {
      const path = request.url.split('?')[0]!;
      if (!request.server.signer.verify(path, exp, sig)) throw Errors.unauthorized('Der Link ist ungültig oder abgelaufen.', 'SIGNATURE_INVALID');
      return;
    }
    await hook.call(request.server, request, reply);
  };
}

export const bookRoutes: FastifyPluginAsyncZod = async (app) => {
  const books = new BookService(app.prisma, app.storage, app.signer, app.mediaQueue);

  const requireEdit = (book: { createdById: string }, request: FastifyRequest) => {
    if (!books.canEdit(book, request.membership!)) throw Errors.forbidden('Nur der Ersteller oder ein Album-Admin darf dieses Fotobuch ändern.', 'BOOK_NOT_OWNER');
  };

  app.get(
    '/families/:id/books',
    {
      preHandler: requireFamilyPermission('member'),
      schema: { tags: ['books'], summary: 'Fotobücher des Albums (neueste zuerst)', security: bearer, params: idParamsSchema, response: { 200: z.array(bookSchema), ...errorResponses(401, 403, 404) } },
    },
    async (request) => books.list(request.params.id, request.membership!),
  );

  app.post(
    '/families/:id/books',
    {
      preHandler: requireFamilyPermission('canCreateBooks'),
      schema: {
        tags: ['books'],
        summary: 'Fotobuch anlegen (canCreateBooks): Layoutvorschlag sofort, PDF im Hintergrund',
        description: '409 BOOK_EMPTY ohne Fotos im Zeitraum, 409 BOOK_TOO_LARGE über 200 Seiten.',
        security: bearer,
        params: idParamsSchema,
        body: createBookBodySchema,
        response: { 202: bookDetailSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const book = await books.create(request.params.id, request.user!.id, request.body, requestLanguage(request.headers['accept-language']));
      return reply.code(202).send(books.toDetailDto(book, request.membership!));
    },
  );

  app.get(
    '/books/:id',
    {
      preHandler: requireFamilyPermission('member', bookFamilyResolver),
      schema: { tags: ['books'], summary: 'Fotobuch mit Seitenliste', security: bearer, params: idParamsSchema, response: { 200: bookDetailSchema, ...errorResponses(401, 403, 404) } },
    },
    async (request) => books.toDetailDto(await books.get(request.params.id), request.membership!),
  );

  app.patch(
    '/books/:id',
    {
      preHandler: requireFamilyPermission('member', bookFamilyResolver),
      schema: {
        tags: ['books'],
        summary: 'Titel oder Seiten ändern (Ersteller oder Album-Admin); wird danach neu gerendert',
        security: bearer,
        params: idParamsSchema,
        body: updateBookBodySchema,
        response: { 202: bookDetailSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const book = await books.get(request.params.id);
      requireEdit(book, request);
      const updated = await books.update(book, request.body);
      return reply.code(202).send(books.toDetailDto(updated, request.membership!));
    },
  );

  app.post(
    '/books/:id/render',
    {
      preHandler: requireFamilyPermission('member', bookFamilyResolver),
      schema: { tags: ['books'], summary: 'Nochmals rendern (nach Fehler)', security: bearer, params: idParamsSchema, response: { 202: bookSchema, ...errorResponses(401, 403, 404) } },
    },
    async (request, reply) => {
      const book = await books.get(request.params.id);
      requireEdit(book, request);
      return reply.code(202).send(books.toDto(await books.rerender(book), request.membership!));
    },
  );

  app.delete(
    '/books/:id',
    {
      preHandler: requireFamilyPermission('member', bookFamilyResolver),
      schema: { tags: ['books'], summary: 'Fotobuch löschen (Ersteller oder Album-Admin)', security: bearer, params: idParamsSchema, response: { 204: emptyResponse, ...errorResponses(401, 403, 404) } },
    },
    async (request, reply) => {
      const book = await books.get(request.params.id);
      requireEdit(book, request);
      await books.remove(book);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/books/:id/pdf',
    {
      preHandler: signedOrMember(),
      schema: { tags: ['books'], summary: 'Druckfertiges PDF', security: [{ bearerAuth: [] }, {}], params: idParamsSchema, produces: ['application/pdf'] },
    },
    async (request, reply) => {
      const b = await books.get(request.params.id);
      if (b.status !== 'READY') throw Errors.notFound('Das Fotobuch ist noch nicht fertig.', 'BOOK_NOT_READY');
      return sendFile(request, reply, books.pdfPath(b), {
        contentType: 'application/pdf',
        downloadName: `${b.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Fotobuch'}.pdf`,
        cacheSeconds: 3600,
        etag: `${b.id}-${b.renderedAt?.getTime() ?? 0}`,
      });
    },
  );

  app.get(
    '/books/:id/pages/:index',
    {
      preHandler: signedOrMember(),
      schema: { tags: ['books'], summary: 'Seitenvorschau (WebP), Seiten ab 1', security: [{ bearerAuth: [] }, {}], params: bookPageParamsSchema, produces: ['image/webp'] },
    },
    async (request, reply) => {
      const b = await books.get(request.params.id);
      if (b.status !== 'READY') throw Errors.notFound('Das Fotobuch ist noch nicht fertig.', 'BOOK_NOT_READY');
      return sendFile(request, reply, books.pagePath(b, request.params.index), { contentType: 'image/webp', cacheSeconds: 7 * 24 * 3600, etag: `${b.id}-${request.params.index}-${b.renderedAt?.getTime() ?? 0}` });
    },
  );
};
