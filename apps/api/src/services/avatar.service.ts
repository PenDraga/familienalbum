import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { Errors } from '../lib/errors.js';
import type { MediaStorage } from '../lib/storage.js';
import { avatarUrl } from './dto.js';

/** Profilbilder: quadratisch beschnitten, 512×512, WebP – ein Format, eine Grösse, kein Original. */
export const AVATAR_SIZE = 512;
export const AVATAR_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export class AvatarService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: MediaStorage,
  ) {}

  async set(userId: string, input: Buffer) {
    if (input.length === 0) throw Errors.badRequest('Kein Bild empfangen.', 'AVATAR_EMPTY');
    let webp: Buffer;
    try {
      webp = await sharp(input, { failOn: 'none', animated: false })
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
        .webp({ quality: 84 })
        .toBuffer();
    } catch {
      throw Errors.badRequest('Das Bild konnte nicht gelesen werden (JPEG, PNG oder WebP hochladen).', 'AVATAR_UNREADABLE');
    }
    const path = this.storage.avatarPath(userId);
    await this.storage.ensureDir(dirname(path));
    await this.storage.writeStream(Readable.from([webp]), path, webp.length);
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarUpdatedAt: new Date() } });
    return { avatarUrl: avatarUrl(user) };
  }

  async remove(userId: string) {
    await rm(this.storage.avatarPath(userId), { force: true });
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUpdatedAt: null } });
    return { avatarUrl: null };
  }

  async exists(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarUpdatedAt: true } });
    return !!u?.avatarUpdatedAt;
  }
}
