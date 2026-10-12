import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import { requestLanguage } from '../lib/messages.en.js';
import { sendFile } from '../lib/send-file.js';
import { requireFamilyPermission } from '../plugins/permissions.js';
import { bookDetailSchema, bookMonthsSchema, bookPageParamsSchema, bookPhotosQuerySchema, bookPhotosSchema, bookPreviewSchema, bookSchema, createBookBodySchema, previewPageBodySchema, updateBookBodySchema } from '../schemas/book.js';
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

  app.get(
    '/families/:id/books/months',
    {
      preHandler: requireFamilyPermission('canCreateBooks'),
      schema: { tags: ['books'], summary: 'Monate mit Fotos (Assistent, canCreateBooks)', security: bearer, params: idParamsSchema, response: { 200: bookMonthsSchema, ...errorResponses(401, 403, 404) } },
    },
    async (request) => books.months(request.params.id),
  );

  app.get(
    '/families/:id/books/photos',
    {
      preHandler: requireFamilyPermission('canCreateBooks'),
      schema: {
        tags: ['books'],
        summary: 'Fotos der gewählten Monate zum Abwählen (Assistent, canCreateBooks)',
        security: bearer,
        params: idParamsSchema,
        querystring: bookPhotosQuerySchema,
        response: { 200: bookPhotosSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => books.photos(request.params.id, request.query.months),
  );

  app.post(
    '/families/:id/books/preview',
    {
      preHandler: requireFamilyPermission('canCreateBooks'),
      schema: {
        tags: ['books'],
        summary: 'Seitenzahl schätzen, ohne zu speichern (Assistent, canCreateBooks)',
        security: bearer,
        params: idParamsSchema,
        body: createBookBodySchema,
        response: { 200: bookPreviewSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => books.preview(request.params.id, request.body, requestLanguage(request.headers['accept-language'])),
  );

  app.post(
    '/families/:id/books',
    {
      preHandler: requireFamilyPermission('canCreateBooks'),
      schema: {
        tags: ['books'],
        summary: 'Fotobuch als Entwurf anlegen (canCreateBooks): Layoutvorschlag sofort, PDF erst über /render',
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
        summary: 'Titel oder Seiten ändern (Ersteller oder Album-Admin); das Buch wird wieder zum Entwurf',
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
    '/books/:id/preview-page',
    {
      preHandler: requireFamilyPermission('member', bookFamilyResolver),
      schema: {
        tags: ['books'],
        summary: 'Eine bearbeitete Seite als WebP-Vorschau rendern, ohne zu speichern (Ersteller oder Album-Admin)',
        description: 'Header x-book-slots: JSON mediaId → Seitenverhältnis (Breite/Höhe) des Platzes, den das Foto füllt.',
        security: bearer,
        params: idParamsSchema,
        body: previewPageBodySchema,
        produces: ['image/webp'],
      },
    },
    async (request, reply) => {
      const book = await books.get(request.params.id);
      requireEdit(book, request);
      const { image, slots } = await books.previewPage(book, request.body.page);
      // Seitenverhältnis jedes Fotoplatzes (mediaId → Breite/Höhe): die App zeichnet damit den Ausschnitt-Rahmen exakt
      return reply.header('cache-control', 'no-store').header('x-book-slots', JSON.stringify(slots)).type('image/webp').send(image);
    },
  );

  app.post(
    '/books/:id/render',
    {
      preHandler: requireFamilyPermission('member', bookFamilyResolver),
      schema: { tags: ['books'], summary: 'PDF erstellen (Ersteller oder Album-Admin): Druck-PDF und Seitenvorschauen im Hintergrund', security: bearer, params: idParamsSchema, response: { 202: bookSchema, ...errorResponses(401, 403, 404) } },
    },
    async (request, reply) => {
      const book = await books.get(request.params.id);
      requireEdit(book, request);
      return reply.code(202).send(books.toDto(await books.requestRender(book), request.membership!));
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
