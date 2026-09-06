import { z } from 'zod';
import { uuidSchema } from './common.js';
import { mediaSchema, mediaStatusSchema } from './media.js';

export const recapKindSchema = z.enum(['MONTH', 'YEAR', 'SECONDS']);

export const recapSchema = z
  .object({
    id: uuidSchema,
    familyId: uuidSchema,
    kind: recapKindSchema,
    /** `JJJJ-MM` bei Monat und Sekunden-Film, `JJJJ` beim Jahr */
    period: z.string(),
    title: z.string(),
    status: mediaStatusSchema,
    error: z.string().nullable(),
    durationSec: z.number().nullable(),
    mediaCount: z.number().int(),
    musicTrack: z.string().nullable(),
    createdAt: z.iso.datetime(),
    readyAt: z.iso.datetime().nullable(),
    urls: z.object({
      video: z.string().nullable(),
      poster: z.string().nullable(),
    }),
  })
  .meta({ id: 'Recap' });

export const createRecapBodySchema = z.object({
  kind: recapKindSchema,
  period: z.string().regex(/^\d{4}(-\d{2})?$/, 'JJJJ-MM oder JJJJ'),
});

export const onThisDaySchema = z
  .object({
    groups: z.array(
      z.object({
        label: z.string(),
        date: z.string(),
        monthsAgo: z.number().int(),
        items: z.array(mediaSchema),
      }),
    ),
  })
  .meta({ id: 'OnThisDay' });
