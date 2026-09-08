import type { FamilyMember, PrismaClient, Recap, RecapKind } from '@prisma/client';
import { readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { API_PREFIX } from '../config/constants.js';
import { Errors } from '../lib/errors.js';
import type { MediaQueue } from '../lib/queue.js';
import type { UrlSigner } from '../lib/signed-url.js';
import { MIME_EXTENSIONS, type MediaStorage } from '../lib/storage.js';
import { iso, isoOrNull } from './dto.js';
import type { MediaService, MediaViewContext } from './media.service.js';
import { buildRecapVideo, type RecapSource } from './recap-builder.js';
import { periodBounds, planFor, selectRecapMedia, type RecapCandidate } from './recap-select.js';

export interface RecapBuildEnv {
  ffmpegPath: string;
  fontPath: string;
  /** Ordner mit MP3s, in dieser Reihenfolge durchsucht (eigene zuerst, dann mitgelieferte) */
  musicDirs: string[];
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}

/** Rückblick-Videos: anlegen, auflisten, bauen (Worker), automatisch planen, «An diesem Tag». */
export class RecapService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: MediaStorage,
    private readonly signer: UrlSigner,
    private readonly queue: MediaQueue,
  ) {}

  toDto(r: Recap) {
    const ready = r.status === 'READY';
    const base = `${API_PREFIX}/recaps/${r.id}`;
    return {
      id: r.id,
      familyId: r.familyId,
      kind: r.kind,
      period: periodString(r),
      title: r.title,
      status: r.status,
      error: r.status === 'FAILED' ? r.error : null,
      durationSec: r.durationSec,
      mediaCount: r.mediaCount,
      musicTrack: r.musicTrack,
      createdAt: iso(r.createdAt),
      readyAt: isoOrNull(r.readyAt),
      urls: {
        video: ready ? this.signer.sign(`${base}/video`, 7 * 24 * 3600) : null,
        poster: ready ? this.signer.sign(`${base}/poster`, 7 * 24 * 3600) : null,
      },
    };
  }

  async list(familyId: string) {
    const rows = await this.prisma.recap.findMany({ where: { familyId }, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }] });
    return rows.map((r) => this.toDto(r));
  }

  async get(recapId: string) {
    const r = await this.prisma.recap.findUnique({ where: { id: recapId } });
    if (!r) throw Errors.notFound('Rückblick nicht gefunden.', 'RECAP_NOT_FOUND');
    return r;
  }

  /** Anlegen oder neu bauen. 409, wenn der Zeitraum keine fertigen Medien hat. */
  async create(familyId: string, kind: RecapKind, period: string) {
    const bounds = periodBounds(kind, period);
    if (!bounds) throw Errors.badRequest('Zeitraum: Monat als JJJJ-MM, Jahr als JJJJ.', 'RECAP_PERIOD_INVALID');
    const count = await this.prisma.media.count({
      where: { familyId, deletedAt: null, status: 'READY', takenAt: { gte: bounds.start, lt: bounds.end } },
    });
    if (count === 0) throw Errors.conflict('In diesem Zeitraum gibt es keine Fotos oder Videos.', 'RECAP_EMPTY');

    const existing = await this.prisma.recap.findUnique({ where: { familyId_kind_periodStart: { familyId, kind, periodStart: bounds.start } } });
    if (existing?.status === 'PROCESSING') return this.toDto(existing);
    if (existing) await this.storage.removeQuietly(this.storage.recapDir(familyId, existing.id));

    const recap = existing
      ? await this.prisma.recap.update({
          where: { id: existing.id },
          data: { status: 'PROCESSING', error: null, durationSec: null, readyAt: null, mediaCount: 0, musicTrack: null, title: bounds.title },
        })
      : await this.prisma.recap.create({
          data: { familyId, kind, periodStart: bounds.start, periodEnd: bounds.end, title: bounds.title, status: 'PROCESSING' },
        });
    await this.queue.enqueueRecap(recap.id);
    return this.toDto(recap);
  }

  async remove(recap: Recap) {
    await this.prisma.recap.delete({ where: { id: recap.id } });
    await this.storage.removeQuietly(this.storage.recapDir(recap.familyId, recap.id));
  }

  /**
   * Automatik: für jede Familie den Vormonat bzw. das Vorjahr anlegen, sofern es Medien gibt und der
   * Rückblick noch nicht existiert. Wird vom Job-Scheduler im Worker aufgerufen (1. des Monats / 2. Januar).
   */
  async scheduleDue(kind: 'MONTH' | 'YEAR', now = new Date()): Promise<{ created: string[] }> {
    const period =
      kind === 'MONTH'
        ? (() => {
            const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          })()
        : String(now.getUTCFullYear() - 1);
    const bounds = periodBounds(kind, period)!;
    const families = await this.prisma.family.findMany({ select: { id: true } });
    const created: string[] = [];
    for (const f of families) {
      const exists = await this.prisma.recap.findUnique({ where: { familyId_kind_periodStart: { familyId: f.id, kind, periodStart: bounds.start } } });
      if (exists) continue;
      try {
        const dto = await this.create(f.id, kind, period);
        created.push(dto.id);
      } catch (err) {
        if ((err as { code?: string }).code !== 'RECAP_EMPTY') throw err;
      }
    }
    return { created };
  }

  /** «An diesem Tag»: derselbe Kalendertag vor 1–12 Monaten und vor 1–10 Jahren, nur wo es Medien gibt. */
  async onThisDay(familyId: string, ctx: MediaViewContext, media: MediaService, now = new Date()) {
    const groups: Array<{ label: string; date: string; monthsAgo: number; items: ReturnType<MediaService['toDto']>[] }> = [];
    const seen = new Set<string>();
    const candidates: number[] = [...Array.from({ length: 12 }, (_, i) => i + 1), ...Array.from({ length: 10 }, (_, i) => (i + 1) * 12)];
    for (const monthsAgo of candidates) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, now.getUTCDate()));
      // Monatsüberlauf (z.B. 31. → Folgemonat) überspringen
      if (day.getUTCDate() !== now.getUTCDate()) continue;
      const key = day.toISOString().slice(0, 10);
      if (seen.has(key)) continue;
      seen.add(key);
      const items = await this.prisma.media.findMany({
        where: {
          familyId,
          deletedAt: null,
          status: 'READY',
          takenAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) },
        },
        orderBy: { takenAt: 'asc' },
        take: 12,
        include: { uploader: { select: { id: true, displayName: true, avatarUpdatedAt: true } }, _count: { select: { comments: true } } },
      });
      if (items.length === 0) continue;
      groups.push({
        label: monthsAgo % 12 === 0 ? (monthsAgo === 12 ? 'Vor 1 Jahr' : `Vor ${monthsAgo / 12} Jahren`) : monthsAgo === 1 ? 'Vor 1 Monat' : `Vor ${monthsAgo} Monaten`,
        date: key,
        monthsAgo,
        items: items.map((m) => media.toDto(m, ctx)),
      });
      if (groups.length >= 6) break;
    }
    return { groups };
  }

  /** Vom Worker: Medien auswählen, Video bauen, Status setzen. Liefert den fertigen Datensatz. */
  async build(recapId: string, env: RecapBuildEnv): Promise<Recap> {
    const recap = await this.get(recapId);
    const family = await this.prisma.family.findUnique({ where: { id: recap.familyId }, select: { name: true } });
    const rows = await this.prisma.media.findMany({
      where: { familyId: recap.familyId, deletedAt: null, status: 'READY', takenAt: { gte: recap.periodStart, lt: recap.periodEnd } },
      select: { id: true, type: true, takenAt: true, durationSec: true, mimeType: true, _count: { select: { comments: true } } },
    });
    const candidates: RecapCandidate[] = rows.map((m) => ({ id: m.id, type: m.type, takenAt: m.takenAt, durationSec: m.durationSec, commentCount: m._count.comments }));
    const chosen = selectRecapMedia(candidates, recap.kind);
    const byId = new Map(rows.map((m) => [m.id, m]));
    const sources: RecapSource[] = chosen.map((c) => {
      const m = byId.get(c.id)!;
      return c.type === 'PHOTO'
        ? { kind: 'photo', path: this.storage.thumbPath(recap.familyId, c.id, 1600) }
        : { kind: 'video', path: this.storage.previewPath(recap.familyId, c.id), durationSec: m.durationSec };
    });
    void MIME_EXTENSIONS;

    const plan = planFor(recap.kind);
    const music = await pickMusic(env.musicDirs);
    const dir = this.storage.recapDir(recap.familyId, recap.id);
    await this.storage.ensureDir(dir);
    const workDir = join(dir, 'work');
    try {
      const result = await buildRecapVideo({
        sources,
        title: recap.title,
        subtitle: family ? family.name : 'Familienalbum',
        credit: music ? `Musik: ${music.title} – Kevin MacLeod (incompetech.com), CC BY 4.0` : '',
        photoSeconds: plan.photoSeconds,
        clipSeconds: plan.clipSeconds,
        fontPath: env.fontPath,
        musicPath: music?.path ?? null,
        ffmpegPath: env.ffmpegPath,
        workDir,
        outVideo: this.storage.recapVideoPath(recap.familyId, recap.id),
        outPoster: this.storage.recapPosterPath(recap.familyId, recap.id),
        log: (msg, extra) => env.log.warn({ recapId, ...extra }, msg),
      });
      await rm(workDir, { recursive: true, force: true });
      const updated = await this.prisma.recap.update({
        where: { id: recap.id },
        data: { status: 'READY', error: null, durationSec: result.durationSec, mediaCount: sources.length, musicTrack: music?.title ?? null, readyAt: new Date() },
      });
      env.log.info({ recapId, kind: recap.kind, media: sources.length, seconds: result.durationSec, music: music?.title }, 'recap ready');
      return updated;
    } catch (err) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      const reason = err instanceof Error ? err.message : String(err);
      env.log.warn({ recapId, reason }, 'recap failed');
      return this.prisma.recap.update({ where: { id: recap.id }, data: { status: 'FAILED', error: reason.slice(0, 1000) } });
    }
  }

  /** Alle Mitglieder einer Familie (für den Push). */
  async members(familyId: string): Promise<FamilyMember[]> {
    return this.prisma.familyMember.findMany({ where: { familyId } });
  }
}

export function periodString(r: Pick<Recap, 'kind' | 'periodStart'>) {
  const d = r.periodStart;
  return r.kind === 'YEAR' ? String(d.getUTCFullYear()) : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Zufälliges Stück aus den Musik-Ordnern; eigene Ordner haben Vorrang, wenn sie MP3s enthalten. */
async function pickMusic(dirs: string[]): Promise<{ title: string; path: string } | null> {
  for (const dir of dirs) {
    const files = await readdir(dir).catch(() => [] as string[]);
    const mp3s = files.filter((f) => f.toLowerCase().endsWith('.mp3'));
    if (mp3s.length === 0) continue;
    const file = mp3s[Math.floor(Math.random() * mp3s.length)]!;
    return { title: basename(file, '.mp3').replace(/_/g, ' '), path: join(dir, file) };
  }
  return null;
}
