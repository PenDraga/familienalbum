import { z } from 'zod';
import { emailSchema } from './common.js';
import { userPublicSchema } from './user.js';

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const tokenPairSchema = z
  .object({
    accessToken: z.string(),
    /** Sekunden bis zum Ablauf des Access-Tokens */
    accessTokenExpiresIn: z.number().int(),
    refreshToken: z.string(),
    refreshTokenExpiresAt: z.iso.datetime(),
  })
  .meta({ id: 'TokenPair' });

export const loginResponseSchema = z
  .object({
    user: userPublicSchema,
    tokens: tokenPairSchema,
  })
  .meta({ id: 'LoginResponse' });

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(20).max(500),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(20).max(500).optional(),
  /** Alle Sitzungen dieses Benutzers beenden (nur mit gültigem Access-Token). */
  all: z.boolean().default(false),
});
