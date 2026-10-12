import { z } from 'zod';
import { uuidSchema } from './common.js';
import { mediaStatusSchema } from './media.js';
import { userBriefSchema } from './user.js';

export const bookFormatSchema = z.enum(['SQUARE_21', 'A4_LANDSCAPE', 'SQUARE_30']);
export const bookTextModeSchema = z.enum(['NONE', 'CAPTIONS', 'COMMENTS']);
export const pageTemplateSchema = z.enum(['one', 'two', 'two_stacked', 'four', 'one_text']);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'JJJJ-MM');

const bookCommentSchema = z.object({ author: z.string().max(80), body: z.string().max(2000) });

export const pageItemSchema = z.object({
  mediaId: uuidSchema,
  caption: z.string().max(500).nullable(),
  comments: z.array(bookCommentSchema).max(10),
});

/** Seitenliste – die gespeicherte Wahrheit des Buchs (ADR-0004). */
export const bookPageSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('cover'), mediaId: uuidSchema.nullable(), title: z.string().max(120), subtitle: z.string().max(120) }),
    z.object({ type: z.literal('chapter'), title: z.string().max(120), subtitle: z.string().max(120) }),
    z.object({ type: z.literal('photos'), template: pageTemplateSchema, items: z.array(pageItemSchema).min(1).max(4), hideText: z.boolean().optional() }),
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
    /** `JJJJ-MM`, sortiert */
    months: z.array(monthSchema),
    onlyCommented: z.boolean(),
    status: mediaStatusSchema,
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
  months: z.array(monthSchema).min(1).max(36),
  onlyCommented: z.boolean().default(false),
});

export const updateBookBodySchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    pages: z.array(bookPageSchema).min(1).max(200).optional(),
  })
  .refine((v) => v.title !== undefined || v.pages !== undefined, { message: 'title oder pages angeben' });

export const bookPageParamsSchema = z.object({ id: uuidSchema, index: z.coerce.number().int().min(1).max(200) });
