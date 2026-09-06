import { Queue } from 'bullmq';

export const MEDIA_QUEUE = 'process-media';

export type MediaJobData =
  | { mediaId: string } // name: 'process'
  | { familyId: string; uploaderId: string }; // name: 'notify'

/** Abstraktion über die Job-Queue, damit Tests ohne Redis laufen. */
export interface MediaQueue {
  /** Thumbnails/Preview erzeugen. */
  enqueueProcessMedia(mediaId: string): Promise<void>;
  /** Push "neue Medien" – gebündelt pro Familie und Uploader (Digest). */
  enqueueNotifyMedia(familyId: string, uploaderId: string): Promise<void>;
  close(): Promise<void>;
}

/** Parst eine redis://-URL in BullMQ-Verbindungsoptionen. */
export function redisConnectionFromUrl(redisUrl: string) {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // Von BullMQ verlangt
    maxRetriesPerRequest: null as null,
  };
}

export class BullMqMediaQueue implements MediaQueue {
  private readonly queue: Queue<MediaJobData>;

  constructor(
    redisUrl: string,
    private readonly digestSeconds: number,
  ) {
    this.queue = new Queue<MediaJobData>(MEDIA_QUEUE, {
      connection: redisConnectionFromUrl(redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }

  async enqueueProcessMedia(mediaId: string) {
    // jobId = mediaId → derselbe Job wird nicht doppelt eingereiht (BullMQ erlaubt kein „:“ in eigenen IDs).
    // Ein alter Job mit dieser ID blockiert das Einreihen: fehlgeschlagene neu starten, erledigte entfernen.
    const jobId = `process-${mediaId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed') {
        await existing.retry();
        return;
      }
      if (state === 'completed' || state === 'unknown') {
        await existing.remove();
      } else {
        return; // wartet oder läuft bereits
      }
    }
    await this.queue.add('process', { mediaId }, { jobId });
  }

  async enqueueNotifyMedia(familyId: string, uploaderId: string) {
    // Feste jobId: solange der verzögerte Job wartet, werden weitere Uploads ignoriert und beim
    // Ausführen mitgezählt. removeOnComplete: true, damit die jobId danach wieder frei ist.
    await this.queue.add(
      'notify',
      { familyId, uploaderId },
      { jobId: `notify-${familyId}-${uploaderId}`, delay: this.digestSeconds * 1000, attempts: 2, removeOnComplete: true, removeOnFail: 50 },
    );
  }

  close() {
    return this.queue.close();
  }
}

/** Für Tests: merkt sich nur, was eingereiht wurde. */
export class RecordingMediaQueue implements MediaQueue {
  readonly enqueued: string[] = [];
  readonly notifications: Array<{ familyId: string; uploaderId: string }> = [];

  async enqueueProcessMedia(mediaId: string) {
    this.enqueued.push(mediaId);
  }

  async enqueueNotifyMedia(familyId: string, uploaderId: string) {
    this.notifications.push({ familyId, uploaderId });
  }

  async close() {}

  reset() {
    this.enqueued.length = 0;
    this.notifications.length = 0;
  }
}

export interface InlineHandlers {
  process: (mediaId: string) => Promise<void>;
  notify: (familyId: string, uploaderId: string) => Promise<void>;
}

/** Verarbeitet sofort im selben Prozess (Dev ohne Redis/Worker); Benachrichtigungen mit Timer gebündelt. */
export class InlineMediaQueue implements MediaQueue {
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly handlers: InlineHandlers,
    private readonly digestSeconds: number,
    private readonly onError: (err: unknown, job: string) => void = () => {},
  ) {}

  async enqueueProcessMedia(mediaId: string) {
    // bewusst nicht awaiten – der Request soll nicht auf die Verarbeitung warten
    this.handlers.process(mediaId).catch((err) => this.onError(err, `process:${mediaId}`));
  }

  async enqueueNotifyMedia(familyId: string, uploaderId: string) {
    const key = `${familyId}:${uploaderId}`;
    if (this.pending.has(key)) return;
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.handlers.notify(familyId, uploaderId).catch((err) => this.onError(err, `notify:${key}`));
    }, this.digestSeconds * 1000);
    timer.unref();
    this.pending.set(key, timer);
  }

  async close() {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }
}
