import { z } from 'zod';
import { uuidSchema } from './common.js';

export const createUploadBodySchema = z.object({
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'SHA-256 als 64 Hex-Zeichen')
    .transform((v) => v.toLowerCase()),
  sizeBytes: z.number().int().positive(),
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(100).transform((v) => v.toLowerCase()),
  /** Aufnahmezeit laut Gerät (Fallback, falls die Datei kein EXIF hat) */
  takenAt: z.iso.datetime().optional(),
});

export const uploadSessionSchema = z
  .object({
    id: uuidSchema,
    familyId: uuidSchema,
    sha256: z.string(),
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    chunkSize: z.number().int(),
    totalChunks: z.number().int(),
    /** Bereits empfangene Chunk-Indizes (für Wiederaufnahme) */
    receivedChunks: z.array(z.number().int()),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'UploadSession' });

export const chunkParamsSchema = z.object({
  id: uuidSchema,
  index: z.coerce.number().int().min(0),
});
