import { z } from 'zod';
import { uuidSchema } from './common.js';
import { mediaTypeSchema } from './media.js';
import { userBriefSchema } from './user.js';

export const activityQuerySchema = z.object({
  /** Zeitpunkt der letzten Prüfung (ISO 8601). Ohne Angabe: zuletzt „gesehen“ bzw. Beitritt. */
  since: z.iso.datetime().optional(),
});

export const activityResponseSchema = z
  .object({
    /** Neue, fertige Medien anderer Mitglieder seit `since` */
    newMedia: z.number().int(),
    /** Neue Kommentare anderer Mitglieder seit `since` */
    newComments: z.number().int(),
    /** Tatsächlich verwendeter Startzeitpunkt */
    since: z.iso.datetime(),
    /** Für den nächsten Aufruf als `since` verwenden */
    serverTime: z.iso.datetime(),
  })
  .meta({ id: 'Activity' });

export const feedQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const feedMediaRefSchema = z
  .object({
    id: uuidSchema,
    type: mediaTypeSchema,
    /** Signierte Vorschau-URL (relativ zum API-Host) */
    thumb400: z.string(),
  })
  .meta({ id: 'FeedMediaRef' });

export const feedItemSchema = z
  .object({
    /** `upload-<mediaId>` bzw. `comment-<commentId>` */
    id: z.string(),
    type: z.enum(['UPLOAD', 'COMMENT']),
    at: z.iso.datetime(),
    actor: userBriefSchema,
    mine: z.boolean(),
    unread: z.boolean(),
    /** Serie: bis zu 4 neueste Medien; Kommentar: das kommentierte Medium */
    media: z.array(feedMediaRefSchema),
    count: z.number().int(),
    photos: z.number().int(),
    videos: z.number().int(),
    comment: z.object({ id: uuidSchema, body: z.string(), mediaId: uuidSchema }).nullable(),
  })
  .meta({ id: 'FeedItem' });

export const feedResponseSchema = z
  .object({
    items: z.array(feedItemSchema),
    nextCursor: z.string().nullable(),
    /** Ab hier gilt „ungelesen“ */
    seenAt: z.iso.datetime(),
  })
  .meta({ id: 'ActivityFeed' });

export const seenResponseSchema = z.object({ seenAt: z.iso.datetime() }).meta({ id: 'ActivitySeen' });
