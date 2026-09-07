import type { FamilyMember, Media, Prisma, PrismaClient } from '@prisma/client';
import { API_PREFIX } from '../config/constants.js';
import { Errors } from '../lib/errors.js';
import type { UrlSigner } from '../lib/signed-url.js';
import type { MediaStorage } from '../lib/storage.js';
import { iso, toUserBrief } from './dto.js';
import { readPhotoExif, type ExifSummary } from './exif.js';
import { MIME_EXTENSIONS } from '../lib/storage.js';

export type MediaWithUploader = Media & { uploader: { id: string; displayName: string }; _count?: { comments: number } };

export interface MediaViewContext {
  membership: Pick<FamilyMember, 'userId' | 'canDownload' | 'isFamilyAdmin'>;
}

export function mediaPaths(mediaId: string) {
  const base = `${API_PREFIX}/media/${mediaId}`;
  return {
    thumb400: `${base}/thumb/400`,
    thumb1600: `${base}/thumb/1600`,
    preview: `${base}/preview`,
    original: `${base}/original`,
  };
}

export class MediaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: MediaStorage,
    private readonly signer: UrlSigner,
  ) {}

  toDto(m: MediaWithUploader, ctx: MediaViewContext) {
    const ready = m.status === 'READY';
    const paths = mediaPaths(m.id);
    return {
      id: m.id,
      familyId: m.familyId,
      uploader: toUserBrief(m.uploader),
      type: m.type,
      status: m.status,
      originalName: m.originalName,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      width: m.width,
      height: m.height,
      durationSec: m.durationSec,
      takenAt: iso(m.takenAt),
      uploadedAt: iso(m.uploadedAt),
      caption: m.caption,
      commentCount: m._count?.comments ?? 0,
      canEdit: m.uploaderId === ctx.membership.userId || ctx.membership.isFamilyAdmin,
      urls: {
        thumb400: ready ? this.signer.sign(paths.thumb400) : null,
        thumb1600: ready ? this.signer.sign(paths.thumb1600) : null,
        preview: ready && m.type === 'VIDEO' ? this.signer.sign(paths.preview) : null,
        original: ctx.membership.canDownload ? this.signer.sign(paths.original) : null,
      },
    };
  }

  private readonly include = { uploader: { select: { id: true, displayName: true, avatarUpdatedAt: true } }, _count: { select: { comments: true } } } as const;

  /**
   * Timeline: neueste zuerst, cursor-paginiert (takenAt, id), nach Monat gruppiert.
   * FAILED-Medien sieht nur der Uploader (damit er es merkt), PROCESSING alle (Platzhalter).
   */
  async timeline(familyId: string, ctx: MediaViewContext, opts: { cursor?: string; limit: number; month?: string; type?: 'PHOTO' | 'VIDEO'; commented?: boolean }) {
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
    const monthRange = opts.month ? monthBounds(opts.month) : null;

    const conditions: Prisma.MediaWhereInput[] = [
      { familyId, deletedAt: null },
      { OR: [{ status: { in: ['READY', 'PROCESSING'] } }, { status: 'FAILED', uploaderId: ctx.membership.userId }] },
    ];
    if (monthRange) conditions.push({ takenAt: { gte: monthRange.start, lt: monthRange.end } });
    if (opts.type) conditions.push({ type: opts.type });
    if (opts.commented) conditions.push({ comments: { some: {} } });
    if (cursor) conditions.push({ OR: [{ takenAt: { lt: cursor.takenAt } }, { takenAt: cursor.takenAt, id: { lt: cursor.id } }] });

    const rows = await this.prisma.media.findMany({
      where: { AND: conditions },
      include: this.include,
      orderBy: [{ takenAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];

    const groups: Array<{ month: string; items: ReturnType<MediaService['toDto']>[] }> = [];
    for (const m of page) {
      const month = monthKey(m.takenAt);
      let g = groups[groups.length - 1];
      if (!g || g.month !== month) {
        g = { month, items: [] };
        groups.push(g);
      }
      g.items.push(this.toDto(m, ctx));
    }

    return { groups, nextCursor: hasMore && last ? encodeCursor(last) : null };
  }

  /** Anzahl Medien pro Monat (für Kalender/Scrubber in der App). */
  async months(familyId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
      SELECT to_char("takenAt" AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*) AS count
      FROM "Media"
      WHERE "familyId" = ${familyId} AND "deletedAt" IS NULL AND status IN ('READY', 'PROCESSING')
      GROUP BY 1 ORDER BY 1 DESC`;
    return rows.map((r) => ({ month: r.month, count: Number(r.count) }));
  }

  async get(mediaId: string, ctx: MediaViewContext) {
    const m = await this.prisma.media.findFirst({ where: { id: mediaId, deletedAt: null }, include: this.include });
    if (!m) throw Errors.notFound('Medium nicht gefunden.', 'MEDIA_NOT_FOUND');
    return this.toDto(m, ctx);
  }

  private assertCanEdit(m: Media, ctx: MediaViewContext) {
    if (m.uploaderId !== ctx.membership.userId && !ctx.membership.isFamilyAdmin) {
      throw Errors.forbidden('Nur der Uploader oder ein Familien-Admin darf das.', 'NOT_OWNER');
    }
  }

  /** Beschreibung und/oder Aufnahmedatum ändern (Uploader oder Familien-Admin). */
  async update(media: Media, patch: { caption?: string | null; takenAt?: Date }, ctx: MediaViewContext) {
    this.assertCanEdit(media, ctx);
    const updated = await this.prisma.media.update({
      where: { id: media.id },
      data: {
        caption: patch.caption === undefined ? undefined : patch.caption || null,
        takenAt: patch.takenAt,
      },
      include: this.include,
    });
    return this.toDto(updated, ctx);
  }

  /**
   * Aufnahmedatum für mehrere Medien: entweder auf einen festen Zeitpunkt setzen oder um Sekunden verschieben.
   * Medien ohne Bearbeitungsrecht werden übersprungen und gemeldet.
   */
  async batchUpdateTakenAt(familyId: string, ids: string[], change: { takenAt?: Date; shiftSeconds?: number }, ctx: MediaViewContext) {
    const items = await this.prisma.media.findMany({ where: { id: { in: ids }, familyId, deletedAt: null } });
    const allowed = items.filter((m) => m.uploaderId === ctx.membership.userId || ctx.membership.isFamilyAdmin);
    const skipped = ids.filter((id) => !allowed.some((m) => m.id === id));
    await this.prisma.$transaction(
      allowed.map((m) =>
        this.prisma.media.update({
          where: { id: m.id },
          data: { takenAt: change.takenAt ?? new Date(m.takenAt.getTime() + (change.shiftSeconds ?? 0) * 1000) },
        }),
      ),
    );
    return { updated: allowed.length, skipped };
  }

  /** Aufnahme-Metadaten; für ältere Medien ohne gespeicherten Auszug wird die Datei nachgelesen. */
  async info(media: Media) {
    let exif = (media.exif ?? null) as ExifSummary | null;
    if (exif === null && media.type === 'PHOTO' && media.status === 'READY') {
      const ext = MIME_EXTENSIONS[media.mimeType]?.ext;
      if (ext && !/^hei[cf]$/.test(ext)) {
        exif = await readPhotoExif(this.storage.originalPath(media.familyId, media.id, ext)).catch(() => null);
        if (exif) await this.prisma.media.update({ where: { id: media.id }, data: { exif: exif as Prisma.InputJsonValue } });
      }
    }
    return {
      exif: exif ?? {},
      originalName: media.originalName,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      sha256: media.sha256,
      uploadedAt: iso(media.uploadedAt),
      takenAt: iso(media.takenAt),
    };
  }

  /** Soft-Delete: Datensatz bleibt (Dedup, Wiederherstellung), Dateien werden gelöscht. */
  async softDelete(media: Media, ctx: MediaViewContext) {
    this.assertCanEdit(media, ctx);
    await this.prisma.media.update({ where: { id: media.id }, data: { deletedAt: new Date() } });
    // Ein Rest-Verzeichnis (FUSE, Worker schreibt noch) ist harmlos; das Löschen gilt trotzdem.
    await this.storage.removeQuietly(this.storage.mediaDir(media.familyId, media.id));
  }
}

export function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export function encodeCursor(m: Pick<Media, 'takenAt' | 'id'>) {
  return Buffer.from(`${m.takenAt.toISOString()}|${m.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { takenAt: Date; id: string } {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const takenAt = new Date(ts ?? '');
  if (!id || Number.isNaN(takenAt.getTime())) throw Errors.badRequest('Ungültiger Cursor.', 'INVALID_CURSOR');
  return { takenAt, id };
}
