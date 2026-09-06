import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, UploadSession } from '@prisma/client';
import type { Readable } from 'node:stream';
import type { AppConfig } from '../config/env.js';
import { AppError, Errors } from '../lib/errors.js';
import type { MediaQueue } from '../lib/queue.js';
import { MIME_EXTENSIONS, type MediaStorage } from '../lib/storage.js';
import { iso } from './dto.js';

const SESSION_TTL_MS = 24 * 3600 * 1000;

/**
 * Aufnahmezeit-Hinweis des Clients prüfen: Browser liefern für Dateien ohne Metadaten gern 1970,
 * Kameras ohne Uhr 1980/2000. Solche Werte werden verworfen (dann gilt EXIF bzw. Upload-Zeit).
 */
export function plausibleDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t) || t < Date.UTC(2001, 0, 1) || t > Date.now() + 24 * 3600 * 1000) return null;
  return d;
}

export interface CreateUploadInput {
  sha256: string;
  sizeBytes: number;
  originalName: string;
  mimeType: string;
  takenAt?: string;
}

export function toUploadSessionDto(s: UploadSession) {
  return {
    id: s.id,
    familyId: s.familyId,
    sha256: s.sha256,
    originalName: s.originalName,
    mimeType: s.mimeType,
    sizeBytes: s.sizeBytes,
    chunkSize: s.chunkSize,
    totalChunks: totalChunks(s),
    receivedChunks: [...s.receivedChunks].sort((a, b) => a - b),
    expiresAt: iso(s.expiresAt),
  };
}

export function totalChunks(s: Pick<UploadSession, 'sizeBytes' | 'chunkSize'>) {
  return Math.max(1, Math.ceil(s.sizeBytes / s.chunkSize));
}

export class UploadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: MediaStorage,
    private readonly queue: MediaQueue,
    private readonly config: AppConfig,
  ) {}

  /**
   * Upload-Session anlegen. 409 mit `mediaId`, wenn die Datei in der Familie schon existiert.
   * Eine noch gültige Session desselben Uploaders für dieselbe Datei wird wiederverwendet (Resume).
   */
  async createSession(familyId: string, uploaderId: string, input: CreateUploadInput) {
    const kind = MIME_EXTENSIONS[input.mimeType];
    if (!kind) {
      throw new AppError(415, 'Unsupported Media Type', `Dateityp ${input.mimeType} wird nicht unterstützt.`, 'UNSUPPORTED_MEDIA_TYPE');
    }
    if (input.sizeBytes > this.config.maxUploadBytes) {
      throw new AppError(413, 'Payload Too Large', `Dateien dürfen höchstens ${this.config.maxUploadBytes} Bytes gross sein.`, 'FILE_TOO_LARGE');
    }

    const existing = await this.prisma.media.findUnique({ where: { familyId_sha256: { familyId, sha256: input.sha256 } } });
    if (existing) {
      if (!existing.deletedAt) {
        throw new AppError(409, 'Conflict', 'Diese Datei ist in der Familie bereits vorhanden.', 'DUPLICATE_MEDIA', { mediaId: existing.id });
      }
      // Soft-gelöschtes Duplikat: endgültig entfernen, damit der neue Upload durchgeht.
      // Der neue Upload bekommt eine eigene mediaId – ein Rest-Verzeichnis darf ihn nicht blockieren.
      await this.prisma.media.delete({ where: { id: existing.id } });
      await this.storage.removeQuietly(this.storage.mediaDir(familyId, existing.id));
    }

    await this.cleanupExpired();

    const resumable = await this.prisma.uploadSession.findFirst({
      where: { familyId, uploaderId, sha256: input.sha256, expiresAt: { gt: new Date() } },
    });
    if (resumable) return toUploadSessionDto(resumable);

    const session = await this.prisma.uploadSession.create({
      data: {
        familyId,
        uploaderId,
        sha256: input.sha256,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        chunkSize: this.config.chunkSize,
        takenAtHint: plausibleDate(input.takenAt),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    await this.storage.ensureDir(this.storage.sessionDir(session.id));
    return toUploadSessionDto(session);
  }

  async getOwnSession(sessionId: string, uploaderId: string): Promise<UploadSession> {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.uploaderId !== uploaderId) {
      throw Errors.notFound('Upload-Session nicht gefunden.', 'UPLOAD_NOT_FOUND');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw Errors.gone('Die Upload-Session ist abgelaufen. Bitte neu starten.', 'UPLOAD_EXPIRED');
    }
    return session;
  }

  async putChunk(sessionId: string, uploaderId: string, index: number, body: Readable) {
    const session = await this.getOwnSession(sessionId, uploaderId);
    const total = totalChunks(session);
    if (index >= total) {
      throw Errors.badRequest(`Chunk-Index ${index} ausserhalb von 0..${total - 1}.`, 'CHUNK_INDEX_OUT_OF_RANGE');
    }
    const expected = index === total - 1 ? session.sizeBytes - index * session.chunkSize : session.chunkSize;

    await this.storage.ensureDir(this.storage.sessionDir(session.id));
    const written = await this.storage.writeStream(body, this.storage.chunkPath(session.id, index), expected);
    if (written !== expected) {
      await this.storage.remove(this.storage.chunkPath(session.id, index));
      throw Errors.badRequest(`Chunk ${index} hat ${written} Bytes, erwartet ${expected}.`, 'CHUNK_SIZE_MISMATCH');
    }

    // Atomar anhängen (parallele Chunk-Uploads überschreiben sich sonst gegenseitig)
    await this.prisma.$executeRaw`
      UPDATE "UploadSession" SET "receivedChunks" = array_append("receivedChunks", ${index})
      WHERE id = ${session.id} AND NOT (${index} = ANY("receivedChunks"))`;

    const updated = await this.prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
    return toUploadSessionDto(updated);
  }

  /** Chunks zusammenfügen, Hash prüfen, Media anlegen, Verarbeitung einreihen. */
  async complete(sessionId: string, uploaderId: string) {
    const session = await this.getOwnSession(sessionId, uploaderId);
    const total = totalChunks(session);
    const received = new Set(session.receivedChunks);
    const missing = Array.from({ length: total }, (_, i) => i).filter((i) => !received.has(i));
    if (missing.length > 0) {
      throw new AppError(400, 'Bad Request', `Es fehlen noch ${missing.length} Chunk(s).`, 'CHUNKS_MISSING', { missing: missing.slice(0, 100) });
    }

    const kind = MIME_EXTENSIONS[session.mimeType]!;
    const mediaId = randomUUID();
    const dir = this.storage.mediaDir(session.familyId, mediaId);
    await this.storage.ensureDir(dir);

    const { sha256, bytes } = await this.storage.concatChunks(session.id, total, this.storage.originalPath(session.familyId, mediaId, kind.ext));
    if (sha256 !== session.sha256 || bytes !== session.sizeBytes) {
      await this.storage.remove(dir);
      await this.abort(session.id, uploaderId);
      throw Errors.badRequest('Die Datei ist beschädigt angekommen (Hash stimmt nicht). Bitte Upload wiederholen.', 'HASH_MISMATCH');
    }

    const data: Prisma.MediaUncheckedCreateInput = {
      id: mediaId,
      familyId: session.familyId,
      uploaderId,
      type: kind.type,
      status: 'PROCESSING',
      sha256,
      originalName: session.originalName,
      mimeType: session.mimeType,
      sizeBytes: bytes,
      takenAt: session.takenAtHint ?? new Date(),
    };

    let media;
    try {
      media = await this.prisma.media.create({ data, include: { uploader: { select: { id: true, displayName: true, avatarUpdatedAt: true } } } });
    } catch (err) {
      await this.storage.remove(dir);
      if ((err as { code?: string }).code === 'P2002') {
        await this.abort(session.id, uploaderId);
        throw Errors.conflict('Diese Datei ist in der Familie bereits vorhanden.', 'DUPLICATE_MEDIA');
      }
      throw err;
    }

    await this.abort(session.id, uploaderId).catch(() => {});
    await this.queue.enqueueProcessMedia(media.id);
    return media;
  }

  async abort(sessionId: string, uploaderId: string) {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.uploaderId !== uploaderId) throw Errors.notFound('Upload-Session nicht gefunden.', 'UPLOAD_NOT_FOUND');
    await this.prisma.uploadSession.delete({ where: { id: sessionId } });
    await this.storage.remove(this.storage.sessionDir(sessionId));
  }

  /** Abgelaufene Sessions samt Chunks entfernen (wird opportunistisch aufgerufen). */
  async cleanupExpired() {
    const expired = await this.prisma.uploadSession.findMany({ where: { expiresAt: { lte: new Date() } }, select: { id: true } });
    if (expired.length === 0) return 0;
    await this.prisma.uploadSession.deleteMany({ where: { id: { in: expired.map((e) => e.id) } } });
    await Promise.all(expired.map((e) => this.storage.remove(this.storage.sessionDir(e.id))));
    return expired.length;
  }
}
