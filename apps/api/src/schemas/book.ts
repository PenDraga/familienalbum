import { z } from 'zod';
import { uuidSchema } from './common.js';
import { userBriefSchema } from './user.js';

export const bookFormatSchema = z.enum(['SQUARE_21', 'A4_LANDSCAPE', 'SQUARE_30']);
export const bookTextModeSchema = z.enum(['NONE', 'CAPTIONS', 'COMMENTS']);
export const bookLayoutSchema = z.enum(['SINGLE', 'MIXED', 'COLLAGE']);
/** Entwurf → PDF wird erstellt → PDF fertig (oder Fehler); jede Änderung macht wieder einen Entwurf */
export const bookStatusSchema = z.enum(['DRAFT', 'RENDERING', 'READY', 'FAILED']);
export const pageTemplateSchema = z.enum(['one', 'two', 'two_stacked', 'four', 'one_text', 'auto']);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'JJJJ-MM');

/** Bildausschnitt: Fokuspunkt relativ zum ganzen Foto, Zoom 1–4 */
export const cropSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), zoom: z.number().min(1).max(4) });

const bookCommentSchema = z.object({ author: z.string().max(80), body: z.string().max(2000) });

export const pageItemSchema = z.object({
  mediaId: uuidSchema,
  caption: z.string().max(500).nullable(),
  comments: z.array(bookCommentSchema).max(10),
  /** Breite / Höhe; der Server setzt es beim Speichern aus den Fotodaten */
  aspect: z.number().positive().max(20).optional(),
  crop: cropSchema.optional(),
});

/** Seitenliste – die gespeicherte Wahrheit des Buchs (ADR-0004). */
export const bookPageSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('cover'), mediaId: uuidSchema.nullable(), title: z.string().max(120), subtitle: z.string().max(120), crop: cropSchema.optional() }),
    z.object({ type: z.literal('chapter'), title: z.string().max(120), subtitle: z.string().max(120) }),
    z.object({ type: z.literal('photos'), template: pageTemplateSchema, items: z.array(pageItemSchema).min(1).max(6), hideText: z.boolean().optional() }),
  ])
  .meta({ id: 'BookPage' });

export const bookSchema = z
  .object({
    id: uuidSchema,
    familyId: uuidSchema,
    createdBy: userBriefSchema,
    title: z.string(),
    format: bookFormatSchema,
    textMode: bookTextModeSchema,
    layout: bookLayoutSchema,
    /** `JJJJ-MM`, sortiert */
    months: z.array(monthSchema),
    onlyCommented: z.boolean(),
    status: bookStatusSchema,
    error: z.string().nullable(),
    pageCount: z.number().int(),
    mediaCount: z.number().int(),
    pdfBytes: z.number().int().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    renderedAt: z.iso.datetime().nullable(),
    /** Ersteller oder Album-Admin */
    canEdit: z.boolean(),
    urls: z.object({
      pdf: z.string().nullable(),
      coverPhoto: z.string().nullable(),
      /** Vorschau der ersten Seite (Umschlag) */
      cover: z.string().nullable(),
    }),
  })
  .meta({ id: 'PhotoBook' });

export const bookDetailSchema = bookSchema
  .extend({
    pages: z.array(
      z.object({
        index: z.number().int(),
        page: bookPageSchema,
        /** WebP-Vorschau, sobald das Buch gerendert ist */
        previewUrl: z.string().nullable(),
        /** Thumbnails der Fotos auf dieser Seite (signiert), in der Reihenfolge der Items */
        thumbs: z.array(z.string()),
      }),
    ),
  })
  .meta({ id: 'PhotoBookDetail' });

export const createBookBodySchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  format: bookFormatSchema.default('SQUARE_21'),
  textMode: bookTextModeSchema.default('CAPTIONS'),
  layout: bookLayoutSchema.default('MIXED'),
  months: z.array(monthSchema).min(1).max(36),
  onlyCommented: z.boolean().default(false),
  /** Im Assistenten abgewählte Fotos */
  excludeMediaIds: z.array(z.uuid()).max(5000).default([]),
});

/** Monate mit fertigen Fotos (neueste zuerst) – Auswahl im Assistenten. */
export const bookMonthsSchema = z.array(z.object({ month: monthSchema, count: z.number().int() })).meta({ id: 'BookMonths' });

export const bookPhotosQuerySchema = z.object({
  /** Kommagetrennt, `JJJJ-MM` */
  months: z
    .string()
    .transform((v) => v.split(',').map((m) => m.trim()).filter(Boolean))
    .pipe(z.array(monthSchema).min(1).max(36)),
});

/** Fotos der gewählten Monate für den Assistenten (zum Abwählen). */
export const bookPhotosSchema = z
  .array(
    z.object({
      id: uuidSchema,
      takenAt: z.iso.datetime(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      caption: z.string().nullable(),
      commentCount: z.number().int(),
      thumbUrl: z.string(),
    }),
  )
  .meta({ id: 'BookPhotos' });

export const bookPreviewSchema = z
  .object({ pageCount: z.number().int(), mediaCount: z.number().int(), maxPages: z.number().int() })
  .meta({ id: 'BookPreview' });

export const updateBookBodySchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    pages: z.array(bookPageSchema).min(1).max(200).optional(),
  })
  .refine((v) => v.title !== undefined || v.pages !== undefined, { message: 'title oder pages angeben' });

/** Vorschau einer einzelnen (bearbeiteten) Seite, ohne zu speichern */
export const previewPageBodySchema = z.object({ page: bookPageSchema });

export const bookPageParamsSchema = z.object({ id: uuidSchema, index: z.coerce.number().int().min(1).max(200) });
