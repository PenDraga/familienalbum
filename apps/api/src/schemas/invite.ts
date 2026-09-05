import { z } from 'zod';
import { displayNameSchema, emailSchema, passwordSchema, uuidSchema } from './common.js';
import { tokenPairSchema } from './auth.js';
import { familySchema, membershipFlagsSchema } from './family.js';
import { userPublicSchema } from './user.js';

export const createInviteBodySchema = z.object({
  /** Gültigkeit in Stunden (Standard 7 Tage, max. 90 Tage) */
  expiresInHours: z.number().int().min(1).max(24 * 90).default(24 * 7),
  maxUses: z.number().int().min(1).max(100).default(1),
  canUpload: z.boolean().default(false),
  canDownload: z.boolean().default(false),
  canComment: z.boolean().default(true),
});

export const inviteSchema = z
  .object({
    id: uuidSchema,
    familyId: uuidSchema,
    code: z.string(),
    createdById: uuidSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    maxUses: z.number().int(),
    uses: z.number().int(),
    canUpload: z.boolean(),
    canDownload: z.boolean(),
    canComment: z.boolean(),
  })
  .meta({ id: 'Invite' });

export const inviteCodeParamsSchema = z.object({ code: z.string().min(6).max(64) });
export const inviteIdParamsSchema = z.object({ id: uuidSchema, inviteId: uuidSchema });

/** Öffentliche Vorschau einer Einladung (ohne Login abrufbar). */
export const invitePreviewSchema = z
  .object({
    familyName: z.string(),
    expiresAt: z.iso.datetime(),
    isValid: z.boolean(),
    canUpload: z.boolean(),
    canDownload: z.boolean(),
    canComment: z.boolean(),
  })
  .meta({ id: 'InvitePreview' });

/**
 * Einladung annehmen: entweder angemeldet (leerer Body) oder als neuer Benutzer mit
 * Registrierungsdaten (dann werden Konto + Mitgliedschaft angelegt und Tokens zurückgegeben).
 */
export const acceptInviteBodySchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
  })
  .nullish();

export const acceptInviteResponseSchema = z
  .object({
    family: familySchema,
    membership: membershipFlagsSchema,
    /** Nur bei Neuregistrierung gesetzt */
    user: userPublicSchema.optional(),
    tokens: tokenPairSchema.optional(),
  })
  .meta({ id: 'AcceptInviteResponse' });
