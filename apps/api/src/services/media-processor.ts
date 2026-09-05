import type { Media, PrismaClient } from '@prisma/client';
import exifReader from 'exif-reader';
import ffmpeg, { type FfprobeData } from 'fluent-ffmpeg';
import sharp, { type Sharp } from 'sharp';
import { MIME_EXTENSIONS, type MediaStorage } from '../lib/storage.js';

export interface ProcessorOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  log?: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void; error: (o: object, msg: string) => void };
  /** Wird nach erfolgreicher Verarbeitung aufgerufen (Push in M4). */
  onReady?: (media: Media) => Promise<void> | void;
}

interface Extracted {
  width: number | null;
  height: number | null;
  durationSec: number | null;
  takenAt: Date | null;
}

const MAX_PREVIEW_EDGE = 1920;

/**
 * Verarbeitet ein hochgeladenes Original: EXIF/Metadaten lesen, Thumbnails (400/1600 WebP),
 * bei Videos zusätzlich preview.mp4 (H.264, max. 1080p) und Poster-Frame.
 */
export class MediaProcessor {
  private readonly log: NonNullable<ProcessorOptions['log']>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: MediaStorage,
    private readonly opts: ProcessorOptions = {},
  ) {
    this.log = opts.log ?? { info() {}, warn() {}, error() {} };
    if (opts.ffmpegPath) ffmpeg.setFfmpegPath(opts.ffmpegPath);
    if (opts.ffprobePath) ffmpeg.setFfprobePath(opts.ffprobePath);
  }

  async process(mediaId: string): Promise<Media> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new Error(`Media ${mediaId} existiert nicht`);
    if (media.deletedAt) return media;
    if (media.status === 'READY') return media;

    const kind = MIME_EXTENSIONS[media.mimeType];
    if (!kind) return this.fail(media, `MIME-Typ ${media.mimeType} nicht unterstützt`);
    const original = this.storage.originalPath(media.familyId, media.id, kind.ext);
    if (!(await this.storage.exists(original))) return this.fail(media, 'Originaldatei fehlt');

    const started = Date.now();
    try {
      const extracted = media.type === 'PHOTO' ? await this.processPhoto(media, original) : await this.processVideo(media, original);

      const updated = await this.prisma.media.update({
        where: { id: media.id },
        data: {
          status: 'READY',
          processingError: null,
          width: extracted.width,
          height: extracted.height,
          durationSec: extracted.durationSec,
          // EXIF gewinnt; sonst bleibt der Wert aus dem Upload (Geräte-Hinweis oder Upload-Zeit)
          takenAt: extracted.takenAt ?? media.takenAt,
        },
      });
      this.log.info({ mediaId, type: media.type, ms: Date.now() - started }, 'media processed');
      await this.opts.onReady?.(updated);
      return updated;
    } catch (err) {
      this.log.error({ mediaId, err }, 'media processing failed');
      return this.fail(media, err instanceof Error ? err.message : String(err));
    }
  }

  private fail(media: Media, reason: string) {
    return this.prisma.media.update({
      where: { id: media.id },
      data: { status: 'FAILED', processingError: reason.slice(0, 1000) },
    });
  }

  // ---------- Fotos ----------

  private async processPhoto(media: Media, original: string): Promise<Extracted> {
    const image = sharp(original, { failOn: 'none', animated: false });
    const meta = await image.metadata();

    const exif = readExif(meta.exif);
    // Nach Auto-Rotation sind Breite/Höhe ggf. vertauscht
    const swap = (meta.orientation ?? 1) >= 5;
    const width = meta.width ?? null;
    const height = meta.height ?? null;

    await this.writeThumbs(image.clone().rotate(), media);

    return {
      width: swap ? height : width,
      height: swap ? width : height,
      durationSec: null,
      takenAt: exif,
    };
  }

  private async writeThumbs(source: Sharp, media: Media) {
    await Promise.all([
      source
        .clone()
        .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(this.storage.thumbPath(media.familyId, media.id, 400)),
      source
        .clone()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(this.storage.thumbPath(media.familyId, media.id, 1600)),
    ]);
  }

  // ---------- Videos ----------

  private async processVideo(media: Media, original: string): Promise<Extracted> {
    const probe = await ffprobe(original);
    const video = probe.streams.find((s) => s.codec_type === 'video');
    if (!video) throw new Error('Kein Videostream gefunden');

    const rotation = videoRotation(video);
    const swap = rotation === 90 || rotation === 270;
    const width = swap ? (video.height ?? null) : (video.width ?? null);
    const height = swap ? (video.width ?? null) : (video.height ?? null);
    const durationSec = numberOrNull(probe.format.duration);
    const creation = (probe.format.tags?.creation_time ?? video.tags?.creation_time) as string | undefined;
    const takenAt = creation ? dateOrNull(new Date(creation)) : null;

    const preview = this.storage.previewPath(media.familyId, media.id);
    const poster = this.storage.posterPath(media.familyId, media.id);

    await runFfmpeg(
      ffmpeg(original)
        .outputOptions([
          '-map 0:v:0', '-map 0:a?',
          '-c:v libx264', '-preset veryfast', '-crf 23', '-pix_fmt yuv420p',
          '-vf', `scale=${MAX_PREVIEW_EDGE}:${MAX_PREVIEW_EDGE}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
          '-c:a aac', '-b:a 128k', '-ac 2',
          '-movflags +faststart',
          '-sn', '-dn',
        ])
        .output(preview),
    );

    const seek = durationSec && durationSec > 2 ? 1 : 0;
    await runFfmpeg(ffmpeg(original).seekInput(seek).frames(1).outputOptions(['-q:v 3']).output(poster));

    await this.writeThumbs(sharp(poster).rotate(), media);

    return { width, height, durationSec, takenAt };
  }
}

// ---------- Helfer ----------

function readExif(buf: Buffer | undefined): Date | null {
  if (!buf) return null;
  try {
    const exif = exifReader(buf) as {
      Photo?: { DateTimeOriginal?: unknown; DateTimeDigitized?: unknown };
      Image?: { DateTime?: unknown };
      exif?: { DateTimeOriginal?: unknown };
    };
    const raw = exif.Photo?.DateTimeOriginal ?? exif.exif?.DateTimeOriginal ?? exif.Photo?.DateTimeDigitized ?? exif.Image?.DateTime;
    if (raw instanceof Date) return dateOrNull(raw);
    if (typeof raw === 'string') {
      // "YYYY:MM:DD HH:MM:SS" (lokale Zeit ohne Zone → als UTC interpretiert)
      const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
      if (m) return dateOrNull(new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)));
    }
  } catch {
    /* kaputtes EXIF ignorieren */
  }
  return null;
}

function dateOrNull(d: Date): Date | null {
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  // Kameras ohne Uhr liefern 1970/1980/2000-01-01 – als "unbekannt" behandeln
  if (t < Date.UTC(2001, 0, 1) || t > Date.now() + 24 * 3600 * 1000) return null;
  return d;
}

function numberOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function videoRotation(stream: FfprobeData['streams'][number]): number {
  const tagRot = numberOrNull(stream.tags?.rotate);
  if (tagRot !== null) return ((tagRot % 360) + 360) % 360;
  const side = (stream as { side_data_list?: Array<{ rotation?: number }> }).side_data_list?.find((s) => typeof s.rotation === 'number');
  if (side?.rotation !== undefined) return ((Math.round(side.rotation) % 360) + 360) % 360;
  return 0;
}

function ffprobe(path: string): Promise<FfprobeData> {
  return new Promise((resolve, reject) => ffmpeg.ffprobe(path, (err, data) => (err ? reject(err) : resolve(data))));
}

function runFfmpeg(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd
      .on('end', () => resolve())
      .on('error', (err: Error, _stdout: string | null, stderr: string | null) =>
        reject(new Error(`ffmpeg: ${err.message}${stderr ? `\n${stderr.split('\n').slice(-5).join('\n')}` : ''}`)),
      )
      .run();
  });
}
