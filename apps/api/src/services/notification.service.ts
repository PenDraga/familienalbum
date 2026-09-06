import type { PrismaClient } from '@prisma/client';
import type { PushMessage, PushSender } from './push.js';

export interface NotifyOutcome {
  recipients: number;
  sent: number;
  /** Anzahl Medien bzw. Kommentare, um die es ging */
  count: number;
}

const NONE: NotifyOutcome = { recipients: 0, sent: 0, count: 0 };

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/**
 * Push-Benachrichtigungen.
 * - Neue Medien: gebündelt pro Familie und Uploader (Digest), Empfänger = alle anderen Mitglieder.
 * - Neuer Kommentar: sofort an Uploader des Mediums und alle bisherigen Kommentierenden (ausser Autor).
 */
export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sender: PushSender,
    private readonly log: Log = { info() {}, warn() {} },
  ) {}

  async notifyNewMedia(familyId: string, uploaderId: string): Promise<NotifyOutcome> {
    const fresh = await this.prisma.media.findMany({
      where: { familyId, uploaderId, status: 'READY', deletedAt: null, notifiedAt: null },
      select: { id: true, type: true },
    });
    if (fresh.length === 0) return NONE;

    // Zuerst markieren, damit ein paralleler Lauf nichts doppelt schickt
    const marked = await this.prisma.media.updateMany({
      where: { id: { in: fresh.map((m) => m.id) }, notifiedAt: null },
      data: { notifiedAt: new Date() },
    });
    if (marked.count === 0) return NONE;

    const [family, uploader, members] = await Promise.all([
      this.prisma.family.findUnique({ where: { id: familyId }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: uploaderId }, select: { id: true, displayName: true, avatarUpdatedAt: true } }),
      this.prisma.familyMember.findMany({ where: { familyId, NOT: { userId: uploaderId } }, select: { userId: true } }),
    ]);
    if (!family || !uploader) return NONE;

    const photos = fresh.filter((m) => m.type === 'PHOTO').length;
    const videos = fresh.length - photos;
    const message: PushMessage = {
      title: family.name,
      body: `${uploader.displayName} hat ${describeMedia(photos, videos)} hinzugefügt`,
      data: { type: 'media', familyId, count: String(fresh.length) },
    };
    const sent = await this.sendToUsers(members.map((m) => m.userId), message);
    return { ...sent, count: fresh.length };
  }

  async notifyNewComment(commentId: string): Promise<NotifyOutcome> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        author: { select: { id: true, displayName: true, avatarUpdatedAt: true } },
        media: { select: { id: true, familyId: true, uploaderId: true, family: { select: { name: true } } } },
      },
    });
    if (!comment) return NONE;

    // Alle Mitglieder der Familie ausser dem Autor – die Familie ist klein, jeder Kommentar interessiert
    const members = await this.prisma.familyMember.findMany({
      where: { familyId: comment.media.familyId, NOT: { userId: comment.authorId } },
      select: { userId: true },
    });

    const excerpt = comment.body.length > 100 ? `${comment.body.slice(0, 97)}…` : comment.body;
    const message: PushMessage = {
      title: `${comment.author.displayName} · ${comment.media.family.name}`,
      body: excerpt,
      data: { type: 'comment', familyId: comment.media.familyId, mediaId: comment.mediaId, commentId },
    };
    const sent = await this.sendToUsers(members.map((m) => m.userId), message);
    return { ...sent, count: 1 };
  }

  private async sendToUsers(userIds: string[], message: PushMessage): Promise<Omit<NotifyOutcome, 'count'>> {
    if (userIds.length === 0) return { recipients: 0, sent: 0 };
    if (!this.sender.enabled) {
      this.log.info({ recipients: userIds.length, title: message.title }, 'push disabled – clients poll');
      return { recipients: userIds.length, sent: 0 };
    }
    const devices = await this.prisma.device.findMany({ where: { userId: { in: userIds } }, select: { fcmToken: true } });
    if (devices.length === 0) return { recipients: userIds.length, sent: 0 };

    const result = await this.sender.send(devices.map((d) => d.fcmToken), message);
    if (result.invalidTokens.length > 0) {
      await this.prisma.device.deleteMany({ where: { fcmToken: { in: result.invalidTokens } } });
      this.log.warn({ removed: result.invalidTokens.length }, 'removed invalid push tokens');
    }
    this.log.info({ recipients: userIds.length, devices: devices.length, sent: result.sent, title: message.title }, 'push sent');
    return { recipients: userIds.length, sent: result.sent };
  }
}

export function describeMedia(photos: number, videos: number): string {
  const parts: string[] = [];
  if (photos > 0) parts.push(photos === 1 ? '1 neues Foto' : `${photos} neue Fotos`);
  if (videos > 0) parts.push(videos === 1 ? '1 neues Video' : `${videos} neue Videos`);
  return parts.join(' und ');
}
