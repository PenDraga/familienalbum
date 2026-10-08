import type { PrismaClient } from '@prisma/client';
import { countUnread } from './activity.service.js';
import { recapTitle } from './recap-select.js';
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
    const sent = await this.sendToUsers(members.map((m) => m.userId), (lang) => ({
      title: family.name,
      body: lang === 'en' ? `${uploader.displayName} added ${describeMedia(photos, videos, 'en')}` : `${uploader.displayName} hat ${describeMedia(photos, videos)} hinzugefügt`,
      data: { type: 'media', familyId, count: String(fresh.length) },
    }));
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
    const sent = await this.sendToUsers(members.map((m) => m.userId), () => ({
      title: `${comment.author.displayName} · ${comment.media.family.name}`,
      body: excerpt,
      data: { type: 'comment', familyId: comment.media.familyId, mediaId: comment.mediaId, commentId },
    }));
    return { ...sent, count: 1 };
  }

  /** Rückblick fertig: alle Mitglieder der Familie. */
  async notifyRecap(recapId: string): Promise<NotifyOutcome> {
    const recap = await this.prisma.recap.findUnique({ where: { id: recapId }, include: { family: { select: { name: true } } } });
    if (!recap || recap.status !== 'READY') return NONE;
    const members = await this.prisma.familyMember.findMany({ where: { familyId: recap.familyId }, select: { userId: true } });
    const sent = await this.sendToUsers(members.map((m) => m.userId), (lang) => ({
      title: lang === 'en' ? `Recap ${recapTitle(recap.kind, recap.periodStart, 'en')}` : `Rückblick ${recap.title}`,
      body: lang === 'en' ? `Your video is ready – ${recap.mediaCount} moments from ${recapTitle(recap.kind, recap.periodStart, 'en')} · ${recap.family.name}` : `Euer Video ist da – ${recap.mediaCount} Momente aus ${recap.title} · ${recap.family.name}`,
      data: { type: 'recap', familyId: recap.familyId, recapId: recap.id },
    }));
    return { ...sent, count: 1 };
  }

  private async sendToUsers(userIds: string[], build: (lang: PushLang) => PushMessage): Promise<Omit<NotifyOutcome, 'count'>> {
    const message = build('de');
    if (userIds.length === 0) return { recipients: 0, sent: 0 };
    if (!this.sender.enabled) {
      this.log.info({ recipients: userIds.length, title: message.title }, 'push disabled – clients poll');
      return { recipients: userIds.length, sent: 0 };
    }
    const devices = await this.prisma.device.findMany({ where: { userId: { in: userIds } }, select: { fcmToken: true, userId: true, locale: true } });
    if (devices.length === 0) return { recipients: userIds.length, sent: 0 };

    // Badge = ungelesene Einträge des Empfängers über alle seine Alben; gleiche Sprache und Zahl → ein Multicast
    const badges = await this.unreadTotals([...new Set(devices.map((d) => d.userId))]);
    const groups = new Map<string, { lang: PushLang; badge: number; tokens: string[] }>();
    for (const d of devices) {
      const badge = badges.get(d.userId) ?? 0;
      const lang: PushLang = d.locale?.startsWith('en') ? 'en' : 'de';
      const key = `${lang}:${badge}`;
      const g = groups.get(key) ?? { lang, badge, tokens: [] };
      g.tokens.push(d.fcmToken);
      groups.set(key, g);
    }
    let sent = 0;
    const invalid: string[] = [];
    for (const { lang, badge, tokens } of groups.values()) {
      const result = await this.sender.send(tokens, { ...build(lang), badge });
      sent += result.sent;
      invalid.push(...result.invalidTokens);
    }
    if (invalid.length > 0) {
      await this.prisma.device.deleteMany({ where: { fcmToken: { in: invalid } } });
      this.log.warn({ removed: invalid.length }, 'removed invalid push tokens');
    }
    this.log.info({ recipients: userIds.length, devices: devices.length, sent, title: message.title }, 'push sent');
    return { recipients: userIds.length, sent };
  }

  /** Ungelesene Medien und Kommentare pro Person, summiert über alle Mitgliedschaften. */
  private async unreadTotals(userIds: string[]) {
    const memberships = await this.prisma.familyMember.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, familyId: true, activitySeenAt: true, joinedAt: true },
    });
    const totals = new Map<string, number>();
    for (const m of memberships) {
      const { media, comments } = await countUnread(this.prisma, m.familyId, m.userId, m.activitySeenAt ?? m.joinedAt);
      totals.set(m.userId, (totals.get(m.userId) ?? 0) + media + comments);
    }
    return totals;
  }
}

export type PushLang = 'de' | 'en';

export function describeMedia(photos: number, videos: number, lang: PushLang = 'de'): string {
  const parts: string[] = [];
  if (lang === 'en') {
    if (photos > 0) parts.push(photos === 1 ? '1 new photo' : `${photos} new photos`);
    if (videos > 0) parts.push(videos === 1 ? '1 new video' : `${videos} new videos`);
    return parts.join(' and ');
  }
  if (photos > 0) parts.push(photos === 1 ? '1 neues Foto' : `${photos} neue Fotos`);
  if (videos > 0) parts.push(videos === 1 ? '1 neues Video' : `${videos} neue Videos`);
  return parts.join(' und ');
}
