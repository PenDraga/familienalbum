import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { once } from 'node:events';
import { Errors } from './errors.js';

export type ThumbSize = 400 | 1600;

/**
 * Dateiablage unter MEDIA_ROOT:
 *   <familyId>/<mediaId>/{original.<ext>, thumb_400.webp, thumb_1600.webp, preview.mp4, poster.jpg}
 *   _uploads/<sessionId>/chunk_000000 …
 */
export class MediaStorage {
  constructor(readonly root: string) {}

  mediaDir(familyId: string, mediaId: string) {
    return join(this.root, familyId, mediaId);
  }
  originalPath(familyId: string, mediaId: string, ext: string) {
    return join(this.mediaDir(familyId, mediaId), `original.${ext}`);
  }
  thumbPath(familyId: string, mediaId: string, size: ThumbSize) {
    return join(this.mediaDir(familyId, mediaId), `thumb_${size}.webp`);
  }
  previewPath(familyId: string, mediaId: string) {
    return join(this.mediaDir(familyId, mediaId), 'preview.mp4');
  }
  posterPath(familyId: string, mediaId: string) {
    return join(this.mediaDir(familyId, mediaId), 'poster.jpg');
  }

  /** Profilbilder: <root>/_avatars/<userId>.webp (512×512, vom Server erzeugt) */
  avatarPath(userId: string) {
    return join(this.root, '_avatars', `${userId}.webp`);
  }

  sessionDir(sessionId: string) {
    return join(this.root, '_uploads', sessionId);
  }
  chunkPath(sessionId: string, index: number) {
    return join(this.sessionDir(sessionId), `chunk_${String(index).padStart(6, '0')}`);
  }

  async ensureDir(dir: string) {
    await mkdir(dir, { recursive: true });
  }

  /**
   * Verzeichnis oder Datei rekursiv löschen. Auf FUSE-Dateisystemen (Unraid /mnt/user) und wenn der
   * Worker gleichzeitig noch schreibt, meldet rmdir gelegentlich ENOTEMPTY, obwohl die Einträge gerade
   * gelöscht wurden – darum mit Wiederholungen, und als letzte Stufe Eintrag für Eintrag von Hand.
   */
  async remove(path: string) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOTEMPTY') throw err;
      await this.removeEntriesThenDir(path);
    }
  }

  private async removeEntriesThenDir(dir: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const entries = await readdir(dir).catch(() => [] as string[]);
      for (const entry of entries) {
        await rm(join(dir, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      }
      try {
        await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        return;
      } catch (err) {
        if ((err as { code?: string }).code !== 'ENOTEMPTY') throw err;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    await rm(dir, { recursive: true, force: true });
  }

  /** Aufräumen, das den Request nicht scheitern lassen darf (Datensatz ist bereits angepasst). */
  async removeQuietly(path: string): Promise<Error | null> {
    try {
      await this.remove(path);
      return null;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  async exists(path: string) {
    return stat(path).then(
      () => true,
      () => false,
    );
  }

  async fileSize(path: string) {
    return (await stat(path)).size;
  }

  /**
   * Schreibt einen Stream atomar (über .part-Datei) und gibt die geschriebenen Bytes zurück.
   * Bricht mit 413 ab, wenn `maxBytes` überschritten wird.
   */
  async writeStream(source: Readable, target: string, maxBytes: number): Promise<number> {
    const tmp = `${target}.part`;
    const out = createWriteStream(tmp);
    let bytes = 0;
    try {
      for await (const chunk of source as AsyncIterable<Buffer>) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          throw Errors.badRequest(`Chunk ist grösser als erlaubt (${maxBytes} Bytes).`, 'CHUNK_TOO_LARGE');
        }
        if (!out.write(chunk)) await once(out, 'drain');
      }
      await new Promise<void>((resolve, reject) => {
        out.once('error', reject);
        out.end(resolve);
      });
      await rename(tmp, target);
      return bytes;
    } catch (err) {
      out.destroy();
      await rm(tmp, { force: true });
      throw err;
    }
  }

  /** Fügt Chunks 0..count-1 zu `target` zusammen und berechnet dabei SHA-256. */
  async concatChunks(sessionId: string, count: number, target: string): Promise<{ sha256: string; bytes: number }> {
    const hash = createHash('sha256');
    const out = createWriteStream(target);
    let bytes = 0;
    try {
      for (let i = 0; i < count; i++) {
        for await (const chunk of createReadStream(this.chunkPath(sessionId, i)) as AsyncIterable<Buffer>) {
          hash.update(chunk);
          bytes += chunk.length;
          if (!out.write(chunk)) await once(out, 'drain');
        }
      }
      await new Promise<void>((resolve, reject) => {
        out.once('error', reject);
        out.end(resolve);
      });
      return { sha256: hash.digest('hex'), bytes };
    } catch (err) {
      out.destroy();
      await rm(target, { force: true });
      throw err;
    }
  }
}

/** Erlaubte MIME-Typen → Dateiendung. HEIC/HEIF wird im Worker nach JPEG gewandelt (heif-convert/ffmpeg). */
export const MIME_EXTENSIONS: Record<string, { ext: string; type: 'PHOTO' | 'VIDEO' }> = {
  'image/jpeg': { ext: 'jpg', type: 'PHOTO' },
  'image/png': { ext: 'png', type: 'PHOTO' },
  'image/webp': { ext: 'webp', type: 'PHOTO' },
  'image/gif': { ext: 'gif', type: 'PHOTO' },
  'image/avif': { ext: 'avif', type: 'PHOTO' },
  'image/heic': { ext: 'heic', type: 'PHOTO' },
  'image/heif': { ext: 'heif', type: 'PHOTO' },
  'video/mp4': { ext: 'mp4', type: 'VIDEO' },
  'video/quicktime': { ext: 'mov', type: 'VIDEO' },
  'video/webm': { ext: 'webm', type: 'VIDEO' },
  'video/x-matroska': { ext: 'mkv', type: 'VIDEO' },
  'video/3gpp': { ext: '3gp', type: 'VIDEO' },
};
