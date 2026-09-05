// Schreibt die OpenAPI-Spezifikation nach docs/openapi.json (Basis für den Flutter-Client).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { RecordingMediaQueue } from '../src/lib/queue.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../../../docs/openapi.json');

const app = await buildApp({
  // Es wird keine Verbindung aufgebaut – Prisma verbindet lazy.
  prisma: createPrismaClient('postgresql://export:export@localhost:5432/export'),
  config: {
    nodeEnv: 'test',
    logLevel: 'silent',
    jwtSecret: 'x'.repeat(32),
    accessTokenTtl: '15m',
    refreshTokenTtlDays: 30,
    mediaRoot: '/tmp',
    redisUrl: 'redis://localhost:6379',
    chunkSize: 50 * 1024 * 1024,
    maxUploadBytes: 2_000_000_000,
    signedUrlTtlSeconds: 86400,
    notifyDigestSeconds: 90,
    rateLimit: false,
  },
  mediaQueue: new RecordingMediaQueue(),
  logger: false,
});
await app.ready();

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(app.swagger(), null, 2) + '\n');
console.log(`OpenAPI geschrieben: ${target}`);
await app.close();
