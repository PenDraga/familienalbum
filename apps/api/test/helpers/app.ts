import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Family, FamilyMember, PrismaClient, User } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect, inject } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import { hashPassword } from '../../src/lib/password.js';
import { createPrismaClient } from '../../src/lib/prisma.js';
import { RecordingMediaQueue } from '../../src/lib/queue.js';
import { MediaProcessor } from '../../src/services/media-processor.js';
import { RecordingPushSender } from '../../src/services/push.js';

export const TEST_CHUNK_SIZE = 16384;

export const testConfig: AppConfig = {
  nodeEnv: 'test',
  logLevel: 'silent',
  jwtSecret: 'test-secret-test-secret-test-secret-test-secret',
  accessTokenTtl: '15m',
  refreshTokenTtlDays: 30,
  mediaRoot: '/tmp/familienalbum-test', // wird pro TestContext durch ein temp-Verzeichnis ersetzt
  redisUrl: 'redis://localhost:6379',
  chunkSize: TEST_CHUNK_SIZE,
  maxUploadBytes: 50 * 1024 * 1024,
  signedUrlTtlSeconds: 3600,
  notifyDigestSeconds: 0,
  rateLimit: false,
  version: "test",
};

export const DEFAULT_PASSWORD = 'Passw0rd!geheim';

// Ein Hash pro Prozess reicht – argon2 ist absichtlich langsam.
let defaultHashPromise: Promise<string> | undefined;
const defaultHash = () => (defaultHashPromise ??= hashPassword(DEFAULT_PASSWORD));

let counter = 0;
const nextId = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface MemberFlags {
  isFamilyAdmin?: boolean;
  canUpload?: boolean;
  canDownload?: boolean;
  canComment?: boolean;
}

export class TestContext {
  private constructor(
    public readonly app: FastifyInstance,
    public readonly prisma: PrismaClient,
    public readonly mediaRoot: string,
    public readonly queue: RecordingMediaQueue,
    public readonly processor: MediaProcessor,
    public readonly push: RecordingPushSender,
  ) {}

  static async create(extend?: (app: FastifyInstance) => Promise<void> | void): Promise<TestContext> {
    const prisma = createPrismaClient(inject('databaseUrl'));
    const mediaRoot = await mkdtemp(join(tmpdir(), 'familienalbum-test-'));
    const queue = new RecordingMediaQueue();
    const push = new RecordingPushSender();
    const config = { ...testConfig, mediaRoot };
    const app = await buildApp({ prisma, config, mediaQueue: queue, pushSender: push, logger: false });
    if (extend) await extend(app);
    await app.ready();
    // Wie im Worker: fertige Medien lösen den Push-Digest aus
    const processor = new MediaProcessor(prisma, app.storage, { onReady: (m) => queue.enqueueNotifyMedia(m.familyId, m.uploaderId) });
    return new TestContext(app, prisma, mediaRoot, queue, processor, push);
  }

  async close() {
    await this.app.close();
    await this.prisma.$disconnect();
    await rm(this.mediaRoot, { recursive: true, force: true });
  }

  /** Leert alle Tabellen (Reihenfolge egal dank CASCADE) und die eingereihten Jobs. */
  async resetDb() {
    await this.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Comment","Media","UploadSession","Device","RefreshToken","Invite","FamilyMember","Family","User" CASCADE',
    );
    this.queue.reset();
    this.push.reset();
    await rm(join(this.mediaRoot, '_uploads'), { recursive: true, force: true });
  }

  // ---------- Fabriken ----------

  async createUser(
    overrides: Partial<Pick<User, 'email' | 'displayName' | 'isAdmin' | 'isDisabled'>> & { password?: string } = {},
  ): Promise<User> {
    const id = nextId();
    return this.prisma.user.create({
      data: {
        email: overrides.email ?? `user-${id}@test.local`,
        displayName: overrides.displayName ?? `User ${id}`,
        isAdmin: overrides.isAdmin ?? false,
        isDisabled: overrides.isDisabled ?? false,
        passwordHash: overrides.password ? await hashPassword(overrides.password) : await defaultHash(),
      },
    });
  }

  createAdmin(overrides: Parameters<TestContext['createUser']>[0] = {}) {
    return this.createUser({ ...overrides, isAdmin: true });
  }

  createFamily(name = `Familie ${nextId()}`): Promise<Family> {
    return this.prisma.family.create({ data: { name } });
  }

  addMember(family: Family, user: User, flags: MemberFlags = {}): Promise<FamilyMember> {
    return this.prisma.familyMember.create({
      data: {
        familyId: family.id,
        userId: user.id,
        isFamilyAdmin: flags.isFamilyAdmin ?? false,
        canUpload: flags.canUpload ?? false,
        canDownload: flags.canDownload ?? false,
        canComment: flags.canComment ?? false,
      },
    });
  }

  /** Familie mit einem Familien-Admin (alle Rechte) anlegen. */
  async createFamilyWithAdmin(name?: string) {
    const family = await this.createFamily(name);
    const admin = await this.createUser();
    await this.addMember(family, admin, { isFamilyAdmin: true, canUpload: true, canDownload: true, canComment: true });
    return { family, admin };
  }

  // ---------- Auth-Helfer ----------

  accessToken(user: User): Promise<string> {
    return this.app.tokens.signAccessToken({ sub: user.id, email: user.email, isAdmin: user.isAdmin });
  }

  async authHeaders(user: User): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.accessToken(user)}` };
  }

  async login(email: string, password = DEFAULT_PASSWORD) {
    const res = await this.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    return res;
  }

  // ---------- Requests ----------

  async as(user: User | null) {
    const headers = user ? await this.authHeaders(user) : {};
    const app = this.app;
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT') => (url: string, payload?: unknown) =>
      app.inject({
        method,
        url: `/api/v1${url}`,
        headers: Buffer.isBuffer(payload) ? { ...headers, 'content-type': 'application/octet-stream' } : headers,
        payload: payload as never,
      });
    return { get: call('GET'), post: call('POST'), patch: call('PATCH'), delete: call('DELETE'), put: call('PUT') };
  }

  // ---------- Upload-Helfer ----------

  /** Kompletter Upload-Flow (Session → Chunks → complete). Gibt das Media-DTO (PROCESSING) zurück. */
  async upload(
    user: User,
    family: Family,
    content: Buffer,
    opts: { name?: string; mimeType?: string; takenAt?: string } = {},
  ) {
    const headers = await this.authHeaders(user);
    const create = await this.app.inject({
      method: 'POST',
      url: `/api/v1/families/${family.id}/uploads`,
      headers,
      payload: {
        sha256: sha256(content),
        sizeBytes: content.length,
        originalName: opts.name ?? 'bild.jpg',
        mimeType: opts.mimeType ?? 'image/jpeg',
        takenAt: opts.takenAt,
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    const session = create.json();

    for (let i = 0; i < session.totalChunks; i++) {
      const chunk = content.subarray(i * session.chunkSize, (i + 1) * session.chunkSize);
      const put = await this.app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${session.id}/chunks/${i}`,
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        payload: chunk,
      });
      expect(put.statusCode, put.body).toBe(200);
    }

    const complete = await this.app.inject({ method: 'POST', url: `/api/v1/uploads/${session.id}/complete`, headers });
    expect(complete.statusCode, complete.body).toBe(201);
    return complete.json() as { id: string; status: string; familyId: string };
  }

  /** Upload + Verarbeitung (wie der Worker). */
  async uploadAndProcess(user: User, family: Family, content: Buffer, opts?: Parameters<TestContext['upload']>[3]) {
    const media = await this.upload(user, family, content, opts);
    return this.processor.process(media.id);
  }
}

export function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Prüft eine RFC-7807-Fehlerantwort. */
export function expectProblem(res: LightMyRequestResponse, status: number, code?: string) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  const body = res.json();
  expect(body.status).toBe(status);
  expect(typeof body.title).toBe('string');
  expect(typeof body.type).toBe('string');
  if (code) expect(body.code).toBe(code);
  return body;
}
