import type { FastifyRequest } from 'fastify';
import { Errors } from '../lib/errors.js';

/** Lädt das Medium aus params.id auf request.media und liefert dessen familyId für den Rechte-Hook. */
export async function mediaFamilyResolver(request: FastifyRequest) {
  const id = (request.params as { id: string }).id;
  const media = await request.server.prisma.media.findFirst({ where: { id, deletedAt: null } });
  if (!media) throw Errors.notFound('Medium nicht gefunden.', 'MEDIA_NOT_FOUND');
  request.media = media;
  return media.familyId;
}

/** Wie mediaFamilyResolver, aber ausgehend von einer Kommentar-ID in params.id. */
export async function commentFamilyResolver(request: FastifyRequest) {
  const id = (request.params as { id: string }).id;
  const comment = await request.server.prisma.comment.findUnique({ where: { id }, include: { media: true } });
  if (!comment || comment.media.deletedAt) throw Errors.notFound('Kommentar nicht gefunden.', 'COMMENT_NOT_FOUND');
  request.media = comment.media;
  return comment.media.familyId;
}
