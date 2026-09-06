import { z } from 'zod';
import { displayNameSchema, emailSchema, passwordSchema, uuidSchema } from './common.js';

export const userPublicSchema = z
  .object({
    id: uuidSchema,
    email: z.string(),
    displayName: z.string(),
    isAdmin: z.boolean(),
    isDisabled: z.boolean(),
    createdAt: z.iso.datetime(),
    /** Signierter Link auf das Profilbild (512×512 WebP), null ohne Bild */
    avatarUrl: z.string().nullable(),
  })
  .meta({ id: 'User' });

/** Was andere Familienmitglieder von einem Benutzer sehen. */
export const userBriefSchema = z
  .object({
    id: uuidSchema,
    displayName: z.string(),
    /** Signierter Link auf das Profilbild, null ohne Bild */
    avatarUrl: z.string().nullable(),
  })
  .meta({ id: 'UserBrief' });

export const avatarResponseSchema = z.object({ avatarUrl: z.string().nullable() }).meta({ id: 'AvatarResponse' });

export const createUserBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  isAdmin: z.boolean().default(false),
});

export const updateMeBodySchema = z
  .object({
    displayName: displayNameSchema.optional(),
    currentPassword: z.string().max(200).optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((v) => v.displayName !== undefined || v.newPassword !== undefined, { message: 'Mindestens ein Feld angeben' })
  .refine((v) => !v.newPassword || !!v.currentPassword, { message: 'currentPassword ist beim Passwortwechsel nötig', path: ['currentPassword'] });

export const updateUserBodySchema = z
  .object({
    displayName: displayNameSchema.optional(),
    isAdmin: z.boolean().optional(),
    isDisabled: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Mindestens ein Feld angeben' });
