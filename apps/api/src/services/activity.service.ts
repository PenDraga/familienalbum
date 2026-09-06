import type { FamilyMember, PrismaClient } from '@prisma/client';
import type { UrlSigner } from '../lib/signed-url.js';
import { iso, toUserBrief } from './dto.js';
import { mediaPaths } from './media.service.js';

/** Uploads desselben Mitglieds mit höchstens so viel Abstand zählen als eine Serie. */
const GROUP_GAP_MS = 60 * 60 * 1000;
const PREVIEW_COUNT = 4;
const COMMENT_EXCERPT = 200;

export interface FeedMediaRef {
  id: string;
  type: 'PHOTO' | 'VIDEO';
  thumb400: string;
}

export interface FeedItem {
  id: string;
  type: 'UPLOAD' | 'COMMENT';
  at: string;
  actor: { id: string; displayName: string; avatarUrl: string | null };
  /** Eigene Aktion des Aufrufers */
  mine: boolean;
  /** Neuer als der „gesehen“-Zeitpunkt und nicht eigene Aktion */
  unread: boolean;
  /** Vorschau (Serie: bis zu 4 neueste; Kommentar: das kommentierte Medium) */
  media: FeedMediaRef[];
  count: number;
  photos: number;
  videos: number;
  comment: { id: string; body: string; mediaId: string } | null;
}

export class ActivityService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly signer: UrlSigner,
  ) {}

  /** Ab wann Einträge als ungelesen gelten: zuletzt gesehen, sonst Beitritt. */
  seenSince(membership: Pick<FamilyMember, 'activitySeenAt' | 'joinedAt'>) {
    return membership.activitySeenAt ?? membership.joinedAt;
  }

  /**
   * Verlauf einer Familie: Upload-Serien und Kommentare, neueste zuerst, cursor-paginiert (Zeitpunkt).
   * Nur fertige, nicht gelöschte Medien. Der Cursor ist der Zeitpunkt des letzten gelieferten Eintrags.
   */
  async feed(familyId: string, membership: FamilyMember, opts: { cursor?: string; limit: number }) {
    const before = opts.cursor ? decodeCursor(opts.cursor) : null;
    const seenAt = this.seenSince(membership);
    const mediaTake = opts.limit * 6;
    const commentTake = opts.limit;

    const [mediaRows, commentRows] = await Promise.all([
      this.prisma.media.findMany({
        where: { familyId, status: 'READY', deletedAt: null, ...(before ? { uploadedAt: { lt: before } } : {}) },
        select: { id: true, type: true, uploadedAt: true, uploader: { select: { id: true, displayName: true, avatarUpdatedAt: true } } },
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
        take: mediaTake,
      }),
      this.prisma.comment.findMany({
        where: { media: { familyId, deletedAt: null, status: 'READY' }, ...(before ? { createdAt: { lt: before } } : {}) },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, displayName: true, avatarUpdatedAt: true } },
          media: { select: { id: true, type: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: commentTake,
      }),
    ]);

    // Ältere Einträge als die unvollständig geladene Quelle dürfen nicht erscheinen (Reihenfolge bliebe sonst lückenhaft)
    let boundary: Date | null = null;
    if (mediaRows.length === mediaTake) boundary = mediaRows[mediaRows.length - 1]!.uploadedAt;
    if (commentRows.length === commentTake) {
      const c = commentRows[commentRows.length - 1]!.createdAt;
      boundary = boundary && boundary > c ? boundary : c;
    }

    const items: Array<FeedItem & { atDate: Date }> = [];

    // Upload-Serien: gleiche Person, Abstand zum vorigen Upload höchstens GROUP_GAP_MS
    let group: (FeedItem & { atDate: Date }) | null = null;
    let groupLastAt = new Date(0);
    for (const m of mediaRows) {
      if (boundary && m.uploadedAt < boundary) break;
      if (group && group.actor.id === m.uploader.id && groupLastAt.getTime() - m.uploadedAt.getTime() <= GROUP_GAP_MS) {
        group.count += 1;
        m.type === 'PHOTO' ? (group.photos += 1) : (group.videos += 1);
        if (group.media.length < PREVIEW_COUNT) group.media.push(this.ref(m));
        groupLastAt = m.uploadedAt;
        continue;
      }
      const mine = m.uploader.id === membership.userId;
      group = {
        id: `upload-${m.id}`,
        type: 'UPLOAD',
        at: iso(m.uploadedAt),
        atDate: m.uploadedAt,
        actor: toUserBrief(m.uploader),
        mine,
        unread: !mine && m.uploadedAt > seenAt,
        media: [this.ref(m)],
        count: 1,
        photos: m.type === 'PHOTO' ? 1 : 0,
        videos: m.type === 'VIDEO' ? 1 : 0,
        comment: null,
      };
      groupLastAt = m.uploadedAt;
      items.push(group);
    }

    for (const c of commentRows) {
      if (boundary && c.createdAt < boundary) break;
      const mine = c.author.id === membership.userId;
      items.push({
        id: `comment-${c.id}`,
        type: 'COMMENT',
        at: iso(c.createdAt),
        atDate: c.createdAt,
        actor: toUserBrief(c.author),
        mine,
        unread: !mine && c.createdAt > seenAt,
        media: [this.ref(c.media)],
        count: 1,
        photos: 0,
        videos: 0,
        comment: { id: c.id, body: excerpt(c.body), mediaId: c.media.id },
      });
    }

    items.sort((a, b) => b.atDate.getTime() - a.atDate.getTime() || a.id.localeCompare(b.id));
    const hasMore = items.length > opts.limit || boundary !== null;
    const page = items.slice(0, opts.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(({ atDate: _atDate, ...rest }) => rest),
      nextCursor: hasMore && last ? encodeCursor(last.atDate) : null,
      seenAt: iso(seenAt),
    };
  }

  /** Ungelesenes zählen: fertige Medien und Kommentare anderer seit `since`. */
  async unread(familyId: string, userId: string, since: Date) {
    const [media, comments] = await Promise.all([
      this.prisma.media.count({
        where: { familyId, status: 'READY', deletedAt: null, uploadedAt: { gt: since }, NOT: { uploaderId: userId } },
      }),
      this.prisma.comment.count({
        where: { createdAt: { gt: since }, NOT: { authorId: userId }, media: { familyId, deletedAt: null } },
      }),
    ]);
    return { media, comments };
  }

  /** Alles bis jetzt als gesehen markieren. */
  async markSeen(familyId: string, userId: string) {
    const now = new Date();
    await this.prisma.familyMember.update({ where: { userId_familyId: { userId, familyId } }, data: { activitySeenAt: now } });
    return now;
  }

  private ref(m: { id: string; type: 'PHOTO' | 'VIDEO' }): FeedMediaRef {
    return { id: m.id, type: m.type, thumb400: this.signer.sign(mediaPaths(m.id).thumb400) };
  }
}

function excerpt(body: string) {
  const t = body.replace(/\s+/g, ' ').trim();
  return t.length > COMMENT_EXCERPT ? `${t.slice(0, COMMENT_EXCERPT - 1)}…` : t;
}

export function encodeCursor(at: Date) {
  return Buffer.from(at.toISOString()).toString('base64url');
}

export function decodeCursor(cursor: string): Date {
  const d = new Date(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (Number.isNaN(d.getTime())) throw new Error('Ungültiger Cursor');
  return d;
}
