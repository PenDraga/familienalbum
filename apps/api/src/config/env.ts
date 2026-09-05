import { z } from 'zod';

// .env laden, falls vorhanden (Node >= 20.12). In Docker kommen die Werte aus der Umgebung.
try {
  process.loadEnvFile();
} catch {
  /* keine .env – ok */
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET muss mindestens 32 Zeichen lang sein'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MEDIA_ROOT: z.string().default('/data/media'),
  UPLOAD_CHUNK_SIZE: z.coerce.number().int().min(1024).max(95 * 1024 * 1024).default(50 * 1024 * 1024),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(2_000_000_000).default(2_000_000_000),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).default(24 * 3600),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  /** queue = BullMQ/Redis + Worker (Produktion), inline = im API-Prozess (Dev ohne Redis) */
  MEDIA_PROCESSING: z.enum(['queue', 'inline']).default('queue'),
  /** Pfad zur Firebase-Service-Account-JSON; ohne Wert wird kein Push verschickt (Clients pollen). */
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  /** Wartezeit, bis mehrere Uploads eines Mitglieds zu einer Push-Nachricht gebündelt werden. */
  NOTIFY_DIGEST_SECONDS: z.coerce.number().int().min(0).default(90),
});

export type Env = z.infer<typeof envSchema>;

/** Laufzeit-Konfiguration der App (bewusst von process.env entkoppelt, damit Tests eigene Werte setzen können). */
export interface AppConfig {
  nodeEnv: Env['NODE_ENV'];
  logLevel: Env['LOG_LEVEL'];
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  mediaRoot: string;
  redisUrl: string;
  /** Grösse eines Upload-Chunks in Bytes (Cloudflare-Limit 100 MB beachten). */
  chunkSize: number;
  maxUploadBytes: number;
  /** Gültigkeit signierter Medien-URLs (Thumbnails etc.). */
  signedUrlTtlSeconds: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  notifyDigestSeconds: number;
  /** Rate-Limits für Auth-Routen aktiv (in Tests aus). */
  rateLimit: boolean;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Umgebungsvariablen:\n${issues}`);
  }
  return parsed.data;
}

export function configFromEnv(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    jwtSecret: env.JWT_SECRET,
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    mediaRoot: env.MEDIA_ROOT,
    redisUrl: env.REDIS_URL,
    chunkSize: env.UPLOAD_CHUNK_SIZE,
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    signedUrlTtlSeconds: env.SIGNED_URL_TTL_SECONDS,
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    notifyDigestSeconds: env.NOTIFY_DIGEST_SECONDS,
    rateLimit: env.NODE_ENV !== 'test',
  };
}
