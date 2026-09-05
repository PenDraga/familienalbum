import type { Comment, Media, PrismaClient } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { iso, toUserBrief } from './dto.js';

export interface CommentViewContext {
  userId: string;
  isFamilyAdmin: boolean;
}

export type CommentWithAuthor = Comment & { author: { id: string; displayName: string } };

export function toCommentDto(c: CommentWithAuthor, ctx: CommentViewContext) {
  return {
    id: c.id,
    mediaId: c.mediaId,
    author: toUserBrief(c.author),
    body: c.body,
    createdAt: iso(c.createdAt),
    canDelete: c.authorId === ctx.userId || ctx.isFamilyAdmin,
  };
}

const include = { author: { select: { id: true, displayName: true } } } as const;

export class CommentService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(mediaId: string, ctx: CommentViewContext) {
    const comments = await this.prisma.comment.findMany({ where: { mediaId }, include, orderBy: { createdAt: 'asc' } });
    return comments.map((c) => toCommentDto(c, ctx));
  }

  async create(media: Media, authorId: string, body: string, ctx: CommentViewContext) {
    if (media.status !== 'READY') throw Errors.conflict('Das Medium ist noch nicht fertig verarbeitet.', 'MEDIA_NOT_READY');
    const comment = await this.prisma.comment.create({ data: { mediaId: media.id, authorId, body }, include });
    return toCommentDto(comment, ctx);
  }

  /** Autor oder Familien-Admin. Das Medium wurde vom Rechte-Hook bereits geprüft. */
  async delete(commentId: string, ctx: CommentViewContext) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw Errors.notFound('Kommentar nicht gefunden.', 'COMMENT_NOT_FOUND');
    if (comment.authorId !== ctx.userId && !ctx.isFamilyAdmin) {
      throw Errors.forbidden('Nur der Autor oder ein Familien-Admin darf Kommentare löschen.', 'NOT_COMMENT_OWNER');
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
  }
}
