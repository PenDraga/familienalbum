// Medien-Worker: verarbeitet BullMQ-Jobs (Thumbnails, Video-Preview, EXIF) und verschickt Push-Digests.
import { Worker } from 'bullmq';
import pino from 'pino';
import { configFromEnv, loadEnv } from './config/env.js';
import { createPrismaClient } from './lib/prisma.js';
import { BullMqMediaQueue, MEDIA_QUEUE, redisConnectionFromUrl, type MediaJobData } from './lib/queue.js';
import { MediaStorage } from './lib/storage.js';
import { MediaProcessor } from './services/media-processor.js';
import { NotificationService } from './services/notification.service.js';
import { FcmPushSender, NoopPushSender } from './services/push.js';

async function main() {
  const env = loadEnv();
  const config = configFromEnv(env);
  const log = pino({ level: env.LOG_LEVEL, name: 'worker' });
  const prisma = createPrismaClient(env.DATABASE_URL);
  const storage = new MediaStorage(config.mediaRoot);
  const queue = new BullMqMediaQueue(config.redisUrl, config.notifyDigestSeconds);
  const pushSender = env.FIREBASE_SERVICE_ACCOUNT ? new FcmPushSender(env.FIREBASE_SERVICE_ACCOUNT) : new NoopPushSender();
  const notifications = new NotificationService(prisma, pushSender, log);
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
      lockDuration: 10 * 60 * 1000, // lange Videos
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

  log.info({ queue: MEDIA_QUEUE, mediaRoot: config.mediaRoot, push: pushSender.enabled ? 'fcm' : 'off' }, 'worker started');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
