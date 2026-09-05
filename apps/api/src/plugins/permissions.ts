import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { Errors } from '../lib/errors.js';

/**
 * Familienrechte gemäss Rechtematrix in CLAUDE.md.
 * `member` = blosse Mitgliedschaft (Timeline sehen etc.).
 */
export type FamilyPermission = 'member' | 'isFamilyAdmin' | 'canUpload' | 'canDownload' | 'canComment';

export type FamilyIdResolver = (request: FastifyRequest) => string | undefined | Promise<string | undefined>;

const familyIdFromParams: FamilyIdResolver = (request) => (request.params as { id?: string }).id;

/** lastSeenAt höchstens alle 5 Minuten aktualisieren, um Schreiblast zu sparen. */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * preHandler-Fabrik: lädt die Membership des angemeldeten Benutzers für die Familie aus der Route
 * genau einmal, legt sie auf `request.membership` und prüft das gewünschte Recht.
 *
 * Globale Admins umgehen Familienrechte NICHT – sie brauchen eine eigene Mitgliedschaft.
 */
export function requireFamilyPermission(
  permission: FamilyPermission = 'member',
  resolveFamilyId: FamilyIdResolver = familyIdFromParams,
): preHandlerAsyncHookHandler {
  return async function familyPermissionHook(this: unknown, request: FastifyRequest, reply: FastifyReply) {
    const app = request.server;
    await app.authenticate(request, reply);
    const user = request.user!;

    const familyId = await resolveFamilyId(request);
    if (!familyId) throw Errors.badRequest('Familien-ID fehlt.', 'FAMILY_ID_MISSING');

    if (!request.membership || request.membership.familyId !== familyId) {
      const membership = await app.prisma.familyMember.findUnique({
        where: { userId_familyId: { userId: user.id, familyId } },
      });
      if (!membership) {
        const exists = await app.prisma.family.findUnique({ where: { id: familyId }, select: { id: true } });
        if (!exists) throw Errors.notFound('Familie nicht gefunden.', 'FAMILY_NOT_FOUND');
        throw Errors.forbidden('Du bist kein Mitglied dieser Familie.', 'NOT_A_MEMBER');
      }
      request.membership = membership;

      const lastSeen = membership.lastSeenAt?.getTime() ?? 0;
      if (Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
        app.prisma.familyMember
          .update({ where: { userId_familyId: { userId: user.id, familyId } }, data: { lastSeenAt: new Date() } })
          .catch((err: unknown) => request.log.warn({ err }, 'lastSeenAt update failed'));
      }
    }

    if (permission !== 'member' && !request.membership[permission]) {
      throw Errors.forbidden(PERMISSION_MESSAGES[permission], `PERMISSION_${permission.toUpperCase()}`);
    }
  };
}

const PERMISSION_MESSAGES: Record<Exclude<FamilyPermission, 'member'>, string> = {
  isFamilyAdmin: 'Nur Familien-Administratoren dürfen das.',
  canUpload: 'Du darfst in dieser Familie nichts hochladen.',
  canDownload: 'Du darfst in dieser Familie keine Originale herunterladen.',
  canComment: 'Du darfst in dieser Familie nicht kommentieren.',
};
