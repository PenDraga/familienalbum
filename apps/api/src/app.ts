import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { API_PREFIX } from './config/constants.js';
import type { AppConfig } from './config/env.js';
import { registerErrorHandling } from './lib/errors.js';
import type { MediaQueue } from './lib/queue.js';
import { UrlSigner } from './lib/signed-url.js';
import { configureDto } from './services/dto.js';
import { MediaStorage } from './lib/storage.js';
import './lib/types.js';
import authPlugin from './plugins/auth.js';
import swaggerPlugin from './plugins/swagger.js';
import { activityRoutes } from './routes/activity.js';
import { adminRoutes } from './routes/admin.js';
import { commentRoutes } from './routes/comments.js';
import { deviceRoutes } from './routes/devices.js';
import { authRoutes } from './routes/auth.js';
import { familyRoutes } from './routes/families.js';
import { healthRoutes } from './routes/health.js';
import { inviteRoutes } from './routes/invites.js';
import { meRoutes } from './routes/me.js';
import { exportRoutes } from './routes/export.js';
import { recapRoutes } from './routes/recaps.js';
import { mediaRoutes } from './routes/media.js';
import { uploadRoutes } from './routes/uploads.js';
import { NotificationService } from './services/notification.service.js';
import { NoopPushSender, type PushSender } from './services/push.js';

export { API_PREFIX };

export interface BuildAppOptions {
  prisma: PrismaClient;
  config: AppConfig;
  mediaQueue: MediaQueue;
  /** Ohne Angabe: kein Push (Clients pollen). */
  pushSender?: PushSender;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Baut die Fastify-App (ohne `listen`). Wird von server.ts, den Tests und dem OpenAPI-Export benutzt.
 * PrismaClient und MediaQueue werden vom Aufrufer verwaltet (connect/disconnect/close).
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: opts.config.logLevel },
    trustProxy: true, // hinter Caddy/Cloudflare
    bodyLimit: 1024 * 1024, // 1 MB für JSON – Chunks setzen ihr eigenes Limit
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('prisma', opts.prisma);
  app.decorate('config', opts.config);
  app.decorate('storage', new MediaStorage(opts.config.mediaRoot));
  app.decorate('signer', new UrlSigner(opts.config.jwtSecret, opts.config.signedUrlTtlSeconds));
  configureDto({ signer: app.signer });
  app.decorate('mediaQueue', opts.mediaQueue);
  app.decorate('notifications', new NotificationService(opts.prisma, opts.pushSender ?? new NoopPushSender(), app.log));

  registerErrorHandling(app);

  // CORS nur für Entwicklung/LAN-Tests relevant (im Betrieb liefert Caddy App und API vom selben Origin).
  // Standard von @fastify/cors ist GET,HEAD,POST – Chunk-Upload (PUT), Caption (PATCH) und Löschen brauchen mehr.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['content-disposition', 'content-range', 'accept-ranges'],
    maxAge: 600,
  });
  if (opts.config.rateLimit) {
    await app.register(rateLimit, { global: false });
  }
  await app.register(swaggerPlugin);
  await app.register(authPlugin);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(familyRoutes);
      await api.register(inviteRoutes);
      await api.register(uploadRoutes);
      await api.register(mediaRoutes);
      await api.register(exportRoutes);
      await api.register(recapRoutes);
      await api.register(commentRoutes);
      await api.register(deviceRoutes);
      await api.register(activityRoutes);
      await api.register(adminRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
