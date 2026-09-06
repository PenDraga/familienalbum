import pino from 'pino';
import { buildApp } from './app.js';
import { configFromEnv, loadEnv } from './config/env.js';
import { createPrismaClient } from './lib/prisma.js';
import { BullMqMediaQueue, InlineMediaQueue, type MediaQueue } from './lib/queue.js';
import { MediaStorage } from './lib/storage.js';
import { MediaProcessor } from './services/media-processor.js';
import { NotificationService } from './services/notification.service.js';
import { createPushSender } from './services/push.js';
import { RecapService } from './services/recap.service.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

async function main() {
  const env = loadEnv();
  const config = configFromEnv(env);
  const prisma = createPrismaClient(env.DATABASE_URL, env.LOG_LEVEL === 'trace');

  const pushSender = createPushSender(env.FIREBASE_SERVICE_ACCOUNT, pino({ level: env.LOG_LEVEL, name: 'api' }));

  // Die Queue braucht im Inline-Modus die App (Logger, Notifications) – deshalb erst Platzhalter, dann füllen.
  let queue: MediaQueue;
  const app = await buildApp({
    prisma,
    config,
    pushSender,
    mediaQueue: {
      enqueueProcessMedia: (id) => queue.enqueueProcessMedia(id),
      enqueueNotifyMedia: (f, u) => queue.enqueueNotifyMedia(f, u),
      enqueueRecap: (id) => queue.enqueueRecap(id),
      close: () => queue.close(),
    },
    logger:
      env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : { level: env.LOG_LEVEL },
  });

  /**
   * MEDIA_PROCESSING=queue  → BullMQ/Redis, separater Worker (Produktion)
   * MEDIA_PROCESSING=inline → im API-Prozess verarbeiten (Entwicklung ohne Redis)
   */
  if (env.MEDIA_PROCESSING === 'inline') {
    const inline = new InlineMediaQueue(
      {
        process: async (id) => {
          await processor.process(id);
        },
        notify: async (familyId, uploaderId) => {
          await notifications.notifyNewMedia(familyId, uploaderId);
        },
        recap: async (recapId) => {
          const assetsDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'assets');
          const recapSvc = new RecapService(prisma, app.storage, app.signer, {
            enqueueProcessMedia: (id) => queue.enqueueProcessMedia(id),
            enqueueNotifyMedia: (f, u) => queue.enqueueNotifyMedia(f, u),
            enqueueRecap: (id) => queue.enqueueRecap(id),
            close: async () => {},
          });
          const recap = await recapSvc.build(recapId, {
            ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
            fontPath: process.env.RECAP_FONT ?? join(assetsDir, 'fonts', 'Baloo2-Bold.ttf'),
            musicDirs: [process.env.MUSIC_PATH ?? join(config.mediaRoot, '_music'), join(assetsDir, 'music')],
            log: app.log,
          });
          if (recap.status === 'READY') await notifications.notifyRecap(recapId);
        },
      },
      config.notifyDigestSeconds,
      (err, job) => app.log.error({ err, job }, 'inline job failed'),
    );
    const notifications = new NotificationService(prisma, pushSender, app.log);
    const processor = new MediaProcessor(prisma, new MediaStorage(config.mediaRoot), {
      ffmpegPath: config.ffmpegPath,
      ffprobePath: config.ffprobePath,
      log: app.log,
      onReady: (media) => inline.enqueueNotifyMedia(media.familyId, media.uploaderId),
    });
    queue = inline;
  } else {
    queue = new BullMqMediaQueue(config.redisUrl, config.notifyDigestSeconds);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await queue.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await prisma.$connect();
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(
    { mediaRoot: config.mediaRoot, processing: env.MEDIA_PROCESSING, push: pushSender.enabled ? 'fcm' : 'off (polling)' },
    'api ready',
  );

  // Hängengebliebene Medien (z.B. Neustart oder Fehler beim Einreihen) erneut einreihen – die feste jobId
  // verhindert Doppel-Jobs, wenn der Job noch in der Queue steht.
  // FAILED ebenfalls: nach einem Update (z.B. besserer HEIC-Konverter) bekommen sie so einen neuen Versuch,
  // ohne dass jemand löschen und neu hochladen muss. Kaputte Dateien scheitern erneut und bleiben FAILED.
  const stuck = await prisma.media.findMany({
    where: { status: { in: ['PROCESSING', 'FAILED'] }, deletedAt: null },
    select: { id: true, status: true },
  });
  for (const m of stuck) {
    await queue.enqueueProcessMedia(m.id).catch((err) => app.log.warn({ err, mediaId: m.id }, 'requeue failed'));
  }
  const processing = stuck.filter((m) => m.status === 'PROCESSING').length;
  const failed = stuck.length - processing;
  if (stuck.length) app.log.info({ processing, failed }, 'hängende und fehlgeschlagene Medien erneut eingereiht');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
