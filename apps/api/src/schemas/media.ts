import { z } from 'zod';
import { uuidSchema } from './common.js';
import { userBriefSchema } from './user.js';

export const mediaTypeSchema = z.enum(['PHOTO', 'VIDEO']);
export const mediaStatusSchema = z.enum(['UPLOADING', 'PROCESSING', 'READY', 'FAILED']);

export const mediaUrlsSchema = z
  .object({
    /** Signierte, zeitlich begrenzte URLs (relativ zum API-Host). null solange nicht READY. */
    thumb400: z.string().nullable(),
    thumb1600: z.string().nullable(),
    /** Nur Videos: transkodiertes MP4 (H.264, max. 1080p) */
    preview: z.string().nullable(),
    /** Nur mit canDownload */
    original: z.string().nullable(),
  })
  .meta({ id: 'MediaUrls' });

export const mediaSchema = z
  .object({
    id: uuidSchema,
    familyId: uuidSchema,
    uploader: userBriefSchema,
    type: mediaTypeSchema,
    status: mediaStatusSchema,
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    durationSec: z.number().nullable(),
    takenAt: z.iso.datetime(),
    uploadedAt: z.iso.datetime(),
    caption: z.string().nullable(),
    commentCount: z.number().int(),
    /** Darf der Aufrufer dieses Medium bearbeiten/löschen (Uploader oder Familien-Admin)? */
    canEdit: z.boolean(),
    urls: mediaUrlsSchema,
  })
  .meta({ id: 'Media' });

export const timelineQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  /** Nur Medien dieses Monats (YYYY-MM), z.B. zum Springen im Kalender */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

export const timelineResponseSchema = z
  .object({
    groups: z.array(
      z.object({
        /** YYYY-MM */
        month: z.string(),
        items: z.array(mediaSchema),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'Timeline' });

export const monthSummarySchema = z
  .object({
    month: z.string(),
    count: z.number().int(),
  })
  .meta({ id: 'MonthSummary' });

export const updateMediaBodySchema = z
  .object({
    caption: z.string().trim().max(2000).nullable().optional(),
    /** Aufnahmezeit (ISO 8601) – sortiert die Timeline neu */
    takenAt: z.iso.datetime().optional(),
  })
  .refine((v) => v.caption !== undefined || v.takenAt !== undefined, { message: 'caption oder takenAt angeben' });

export const batchTakenAtBodySchema = z
  .object({
    ids: z.array(uuidSchema).min(1).max(500),
    /** Alle auf diesen Zeitpunkt setzen … */
    takenAt: z.iso.datetime().optional(),
    /** … oder alle um so viele Sekunden verschieben (negativ = früher) */
    shiftSeconds: z.number().int().min(-315_360_000).max(315_360_000).optional(),
  })
  .refine((v) => (v.takenAt !== undefined) !== (v.shiftSeconds !== undefined), { message: 'Entweder takenAt oder shiftSeconds' });

export const batchTakenAtResponseSchema = z
  .object({ updated: z.number().int(), skipped: z.array(uuidSchema) })
  .meta({ id: 'BatchTakenAtResult' });

export const exifSchema = z
  .object({
    make: z.string().optional(),
    model: z.string().optional(),
    lens: z.string().optional(),
    software: z.string().optional(),
    fNumber: z.number().optional(),
    exposureTime: z.number().optional(),
    iso: z.number().optional(),
    focalLength: z.number().optional(),
    focalLength35: z.number().optional(),
    orientation: z.number().optional(),
    originalDateTime: z.string().optional(),
    gps: z.object({ lat: z.number(), lon: z.number(), alt: z.number().optional() }).optional(),
  })
  .loose()
  .meta({ id: 'Exif' });

export const mediaInfoSchema = z
  .object({
    exif: exifSchema,
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    sha256: z.string(),
    uploadedAt: z.iso.datetime(),
    takenAt: z.iso.datetime(),
  })
  .meta({ id: 'MediaInfo' });

export const thumbParamsSchema = z.object({
  id: uuidSchema,
  size: z.enum(['400', '1600']),
});
