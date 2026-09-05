import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Errors } from '../lib/errors.js';
import { TokenService } from '../lib/tokens.js';

/**
 * Auth-Plugin: stellt `app.authenticate` und `app.requireAdmin` als preHandler bereit.
 * `authenticate` prüft das Bearer-Token und lädt den Benutzer aus der DB (damit gesperrte
 * Benutzer sofort ausgesperrt sind, auch wenn ihr Access-Token noch gültig ist).
 */
async function authPlugin(app: FastifyInstance) {
  app.decorate('tokens', new TokenService(app.config.jwtSecret, app.config.accessTokenTtl));
  app.decorateRequest('user', null);
  app.decorateRequest('membership', null);
  app.decorateRequest('media', null);

  app.decorate('authenticate', async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
    if (request.user) return;

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw Errors.unauthorized('Anmeldung erforderlich.', 'MISSING_TOKEN');
    }
    const claims = await app.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());

    const user = await app.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true, isAdmin: true, isDisabled: true },
    });
    if (!user) throw Errors.unauthorized('Benutzer existiert nicht mehr.', 'USER_NOT_FOUND');
    if (user.isDisabled) throw Errors.forbidden('Dieses Konto ist gesperrt.', 'USER_DISABLED');

    request.user = { id: user.id, email: user.email, isAdmin: user.isAdmin };
  });

  app.decorate('requireAdmin', async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    await app.authenticate(request, reply);
    if (!request.user?.isAdmin) {
      throw Errors.forbidden('Nur globale Administratoren dürfen das.', 'ADMIN_REQUIRED');
    }
  });
}

export default fp(authPlugin, { name: 'auth', dependencies: [] });
