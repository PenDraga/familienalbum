import { z } from 'zod';
import { uuidSchema } from './common.js';
import { userBriefSchema } from './user.js';

export const familyNameSchema = z.string().trim().min(1).max(80);

export const membershipFlagsSchema = z
  .object({
    isFamilyAdmin: z.boolean(),
    canUpload: z.boolean(),
    canDownload: z.boolean(),
    canComment: z.boolean(),
  })
  .meta({ id: 'MembershipFlags' });

export const familySchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Family' });

/** Familie aus Sicht des angemeldeten Mitglieds (inkl. eigener Rechte). */
export const familyWithMembershipSchema = familySchema
  .extend({
    membership: membershipFlagsSchema.extend({ joinedAt: z.iso.datetime(), lastSeenAt: z.iso.datetime().nullable() }),
    memberCount: z.number().int(),
  })
  .meta({ id: 'FamilyWithMembership' });

export const createFamilyBodySchema = z.object({
  name: familyNameSchema,
  /** Optional: Benutzer, der sofort als Familien-Admin mit allen Rechten eingetragen wird. */
  initialAdminUserId: uuidSchema.optional(),
});

export const updateFamilyBodySchema = z.object({
  name: familyNameSchema,
});

export const memberSchema = z
  .object({
    userId: uuidSchema,
    familyId: uuidSchema,
    user: userBriefSchema,
    isFamilyAdmin: z.boolean(),
    canUpload: z.boolean(),
    canDownload: z.boolean(),
    canComment: z.boolean(),
    joinedAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'FamilyMember' });

export const memberParamsSchema = z.object({ id: uuidSchema, userId: uuidSchema });

export const updateMemberBodySchema = membershipFlagsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Mindestens ein Flag angeben' });

/** Admin fügt einen bestehenden Benutzer direkt einer Familie hinzu. */
export const addMemberBodySchema = z.object({
  userId: uuidSchema,
  isFamilyAdmin: z.boolean().default(false),
  canUpload: z.boolean().default(false),
  canDownload: z.boolean().default(false),
  canComment: z.boolean().default(true),
});
