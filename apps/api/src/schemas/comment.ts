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
    /** Autor oder Familien-Admin */
    canDelete: z.boolean(),
  })
  .meta({ id: 'Comment' });

export const createCommentBodySchema = z.object({
  body: z.string().trim().min(1, 'Kommentar darf nicht leer sein').max(2000),
});

export const deviceBodySchema = z.object({
  fcmToken: z.string().min(20).max(4096),
  platform: z.enum(['ios', 'android', 'windows', 'web']),
});

export const deleteDeviceBodySchema = z.object({
  fcmToken: z.string().min(20).max(4096),
});
