import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponses } from '../schemas/common.js';
import { familySchema, membershipFlagsSchema } from '../schemas/family.js';
import { avatarResponseSchema, updateMeBodySchema, userPublicSchema } from '../schemas/user.js';
import { UserService } from '../services/user.service.js';
import { AVATAR_MAX_UPLOAD_BYTES, AvatarService } from '../services/avatar.service.js';
import { Errors } from '../lib/errors.js';
import { sendFile } from '../lib/send-file.js';
import { idParamsSchema } from '../schemas/common.js';

export const meResponseSchema = userPublicSchema
  .extend({
    families: z.array(
      familySchema.extend({
        membership: membershipFlagsSchema.extend({
          joinedAt: z.iso.datetime(),
          lastSeenAt: z.iso.datetime().nullable(),
        }),
      }),
    ),
  })
  .meta({ id: 'Me' });

/** Avatar-Bilder: signierter Link (aus den DTOs) oder Bearer eines beliebigen angemeldeten Benutzers. */
function signedOrAuthenticated() {
  return async function avatarAccessHook(this: unknown, request: FastifyRequest, reply: FastifyReply) {
    const { exp, sig } = request.query as { exp?: string; sig?: string };
    if (exp !== undefined && sig !== undefined) {
      const path = request.url.split('?')[0]!;
      if (!request.server.signer.verify(path, exp, sig)) {
        throw Errors.unauthorized('Der Link ist ungültig oder abgelaufen.', 'SIGNATURE_INVALID');
      }
      return;
    }
    await request.server.authenticate(request, reply);
  };
}

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const users = new UserService(app.prisma);
  const avatars = new AvatarService(app.prisma, app.storage);
  // Bild als Rohdaten (JPEG/PNG/WebP) – kein Multipart nötig
  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  app.get(
    '/me',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['me'],
        summary: 'Eigenes Profil inkl. Familien und Rechten',
        security: [{ bearerAuth: [] }],
        response: { 200: meResponseSchema, ...errorResponses(401, 403) },
      },
    },
    async (request) => users.getMe(request.user!.id),
  );

  app.patch(
    '/me',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['me'],
        summary: 'Anzeigename oder Passwort ändern',
        description: 'Passwortwechsel verlangt `currentPassword`; andere Sitzungen werden dabei beendet.',
        security: [{ bearerAuth: [] }],
        body: updateMeBodySchema,
        response: { 200: userPublicSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request) => users.updateMe(request.user!.id, request.body),
  );

  app.put(
    '/me/avatar',
    {
      preHandler: app.authenticate,
      bodyLimit: AVATAR_MAX_UPLOAD_BYTES,
      schema: {
        tags: ['me'],
        summary: 'Profilbild setzen (Body: JPEG/PNG/WebP als Rohdaten)',
        description: 'Der Server schneidet quadratisch zu und speichert 512×512 als WebP. HEIC vorher auf dem Gerät wandeln.',
        security: [{ bearerAuth: [] }],
        consumes: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
        response: { 200: avatarResponseSchema, ...errorResponses(400, 401, 413) },
      },
    },
    async (request) => avatars.set(request.user!.id, request.body as Buffer),
  );

  app.delete(
    '/me/avatar',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['me'],
        summary: 'Profilbild entfernen',
        security: [{ bearerAuth: [] }],
        response: { 200: avatarResponseSchema, ...errorResponses(401) },
      },
    },
    async (request) => avatars.remove(request.user!.id),
  );

  app.get(
    '/users/:id/avatar',
    {
      preHandler: signedOrAuthenticated(),
      schema: {
        tags: ['me'],
        summary: 'Profilbild (512×512 WebP) – signierter Link aus den DTOs oder Bearer',
        security: [{ bearerAuth: [] }, {}],
        params: idParamsSchema,
        produces: ['image/webp'],
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await avatars.exists(id))) throw Errors.notFound('Kein Profilbild.', 'AVATAR_MISSING');
      return sendFile(request, reply, app.storage.avatarPath(id), { contentType: 'image/webp', cacheSeconds: 7 * 24 * 3600, etag: `${id}-avatar` });
    },
  );
};
