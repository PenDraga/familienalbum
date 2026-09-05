import { z } from 'zod';

export const uuidSchema = z.uuid();

export const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    code: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  // Zusatzfelder (z.B. mediaId bei Duplikaten, missing bei fehlenden Chunks) durchlassen
  .loose()
  .meta({ id: 'Problem', description: 'RFC 7807 Problem Details' });

export const idParamsSchema = z.object({ id: uuidSchema });

export const emailSchema = z.email().max(254).transform((v) => v.trim().toLowerCase());
export const passwordSchema = z.string().min(8, 'Mindestens 8 Zeichen').max(200);
export const displayNameSchema = z.string().trim().min(1).max(80);

export const emptyResponse = z.null().describe('Kein Inhalt');

/** Standard-Fehlerantworten für die OpenAPI-Doku. */
export function errorResponses(...codes: number[]) {
  return Object.fromEntries(codes.map((c) => [c, problemSchema]));
}
