// Medien-Worker: verarbeitet BullMQ-Jobs (Thumbnails, Video-Preview, EXIF) und verschickt Push-Digests.
import { Worker } from 'bullmq';
import pino from 'pino';
import { configFromEnv, loadEnv } from './config/env.js';
import { createPrismaClient } from './lib/prisma.js';
import { BullMqMediaQueue, MEDIA_QUEUE, redisConnectionFromUrl, type MediaJobData } from './lib/queue.js';
import { MediaStorage } from './lib/storage.js';
import { MediaProcessor } from './services/media-processor.js';
import { NotificationService } from './services/notification.service.js';
import { RecapService, type RecapBuildEnv } from './services/recap.service.js';
import { UrlSigner } from './lib/signed-url.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createPushSender } from './services/push.js';

async function main() {
  const env = loadEnv();
  const config = configFromEnv(env);
  const log = pino({ level: env.LOG_LEVEL, name: 'worker' });
  const prisma = createPrismaClient(env.DATABASE_URL);
  const storage = new MediaStorage(config.mediaRoot);
  const queue = new BullMqMediaQueue(config.redisUrl, config.notifyDigestSeconds);
  const pushSender = createPushSender(env.FIREBASE_SERVICE_ACCOUNT, log);
  const notifications = new NotificationService(prisma, pushSender, log);
  const recaps = new RecapService(prisma, storage, new UrlSigner(config.jwtSecret, config.signedUrlTtlSeconds), queue);
  const assetsDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'assets');
  const recapEnv: RecapBuildEnv = {
    ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
    fontPath: process.env.RECAP_FONT ?? join(assetsDir, 'fonts', 'Baloo2-Bold.ttf'),
    // eigene Musik (MUSIC_PATH, Standard <Medien>/_music) vor den mitgelieferten Stücken
    musicDirs: [process.env.MUSIC_PATH ?? join(config.mediaRoot, '_music'), join(assetsDir, 'music')],
    log,
  };
  const processor = new MediaProcessor(prisma, storage, {
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    log,
    onReady: (media) => queue.enqueueNotifyMedia(media.familyId, media.uploaderId),
  });

  const worker = new Worker<MediaJobData>(
    MEDIA_QUEUE,
    async (job) => {
      if (job.name === 'notify') {
        const { familyId, uploaderId } = job.data as { familyId: string; uploaderId: string };
        const outcome = await notifications.notifyNewMedia(familyId, uploaderId);
        log.info({ familyId, ...outcome }, 'media digest');
        return;
      }
      if (job.name === 'recap') {
        const { recapId } = job.data as { recapId: string };
        const recap = await recaps.build(recapId, recapEnv);
        if (recap.status === 'FAILED') throw new Error(recap.error ?? 'recap failed');
        const outcome = await notifications.notifyRecap(recapId);
        log.info({ recapId, ...outcome }, 'recap push');
        return;
      }
      if (job.name === 'recap-schedule') {
        const { kind } = job.data as { kind: 'MONTH' | 'YEAR' };
        const { created } = await recaps.scheduleDue(kind);
        log.info({ kind, created: created.length }, 'recap schedule');
        return;
      }
      const { mediaId } = job.data as { mediaId: string };
      const media = await processor.process(mediaId);
      if (media.status === 'FAILED') {
        // Fehler werfen, damit BullMQ nach Backoff erneut versucht (attempts aus defaultJobOptions)
        throw new Error(media.processingError ?? 'processing failed');
      }
    },
    {
      connection: redisConnectionFromUrl(config.redisUrl),
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
      lockDuration: 30 * 60 * 1000, // lange Videos, Rückblicke mit vielen Segmenten
    },
  );

  worker.on('completed', (job) => log.info({ jobId: job.id, name: job.name }, 'job completed'));
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job failed'));
  worker.on('error', (err) => log.error({ err }, 'worker error'));

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'worker shutting down');
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await queue.ensureRecapSchedules().catch((err) => log.warn({ err }, 'recap schedules not registered'));
  log.info({ queue: MEDIA_QUEUE, mediaRoot: config.mediaRoot, push: pushSender.enabled ? 'fcm' : 'off', recaps: 'monthly + yearly' }, 'worker started');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
