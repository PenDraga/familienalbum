import { z } from 'zod';
import { uuidSchema } from './common.js';
import { userBriefSchema } from './user.js';

export const commentSchema = z
  .object({
    id: uuidSchema,
    mediaId: uuidSchema,
    author: userBriefSchema,
    body: z.string(),
    createdAt: z.iso.datetime(),
    /** Gesetzt, wenn der Text nachträglich geändert wurde */
    editedAt: z.iso.datetime().nullable(),
    /** Autor, Familien-Admin oder globaler Admin */
    canEdit: z.boolean(),
    /** Autor, Familien-Admin oder globaler Admin */
    canDelete: z.boolean(),
  })
  .meta({ id: 'Comment' });

export const createCommentBodySchema = z.object({
  body: z.string().trim().min(1, 'Kommentar darf nicht leer sein').max(2000),
});

export const updateCommentBodySchema = createCommentBodySchema;

export const deviceBodySchema = z.object({
  fcmToken: z.string().min(20).max(4096),
  platform: z.enum(['ios', 'android', 'windows', 'web']),
  /** Sprache des Geräts für Push-Texte (de, en); fehlt → de */
  locale: z.string().trim().min(2).max(10).optional(),
});

export const deleteDeviceBodySchema = z.object({
  fcmToken: z.string().min(20).max(4096),
});
