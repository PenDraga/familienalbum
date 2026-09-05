import { z } from 'zod';

export const statsSchema = z
  .object({
    users: z.number().int(),
    disabledUsers: z.number().int(),
    families: z.number().int(),
    media: z.number().int(),
    /** Summe der Originalgrössen in Bytes (Soft-gelöschte ausgenommen) */
    storageBytes: z.number(),
  })
  .meta({ id: 'AdminStats' });

export const listUsersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
