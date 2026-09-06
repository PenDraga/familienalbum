import type { Comment, Media, PrismaClient } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { iso, toUserBrief } from './dto.js';

export interface CommentViewContext {
  userId: string;
  isFamilyAdmin: boolean;
  /** Globaler Admin: darf in Familien, deren Mitglied er ist, alle Kommentare moderieren (ADR-0003). */
  isAdmin: boolean;
}

export type CommentWithAuthor = Comment & { author: { id: string; displayName: string } };

/** Autor, Familien-Admin oder globaler Admin dürfen Kommentare bearbeiten und löschen. */
export function canModerateComment(c: Pick<Comment, 'authorId'>, ctx: CommentViewContext) {
  return c.authorId === ctx.userId || ctx.isFamilyAdmin || ctx.isAdmin;
}

export function toCommentDto(c: CommentWithAuthor, ctx: CommentViewContext) {
  const allowed = canModerateComment(c, ctx);
  return {
    id: c.id,
    mediaId: c.mediaId,
    author: toUserBrief(c.author),
    body: c.body,
    createdAt: iso(c.createdAt),
    editedAt: c.editedAt ? iso(c.editedAt) : null,
    canEdit: allowed,
    canDelete: allowed,
  };
}

const include = { author: { select: { id: true, displayName: true, avatarUpdatedAt: true } } } as const;

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

  /** Text ändern – Autor, Familien-Admin oder globaler Admin. Das Medium wurde vom Rechte-Hook bereits geprüft. */
  async update(commentId: string, body: string, ctx: CommentViewContext) {
    const comment = await this.requireModeratable(commentId, ctx, 'bearbeiten');
    const updated = await this.prisma.comment.update({
      where: { id: comment.id },
      data: body === comment.body ? {} : { body, editedAt: new Date() },
      include,
    });
    return toCommentDto(updated, ctx);
  }

  /** Autor, Familien-Admin oder globaler Admin. Das Medium wurde vom Rechte-Hook bereits geprüft. */
  async delete(commentId: string, ctx: CommentViewContext) {
    const comment = await this.requireModeratable(commentId, ctx, 'löschen');
    await this.prisma.comment.delete({ where: { id: comment.id } });
  }

  private async requireModeratable(commentId: string, ctx: CommentViewContext, verb: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw Errors.notFound('Kommentar nicht gefunden.', 'COMMENT_NOT_FOUND');
    if (!canModerateComment(comment, ctx)) {
      throw Errors.forbidden(`Nur der Autor oder ein Admin darf Kommentare ${verb}.`, 'NOT_COMMENT_OWNER');
    }
    return comment;
  }
}
