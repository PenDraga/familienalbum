import type { FamilyMember, PhotoBook, Prisma, PrismaClient } from '@prisma/client';
import { API_PREFIX } from '../config/constants.js';
import { Errors } from '../lib/errors.js';
import type { MediaQueue } from '../lib/queue.js';
import type { UrlSigner } from '../lib/signed-url.js';
import { MIME_EXTENSIONS, type MediaStorage } from '../lib/storage.js';
import { countMedia, MAX_PAGES, monthKeyUtc, periodLabel, proposeBook, type BookFormat, type BookPage, type BookPhoto, type BookTextMode } from './book-layout.js';
import { previewFileName, renderBook, type RenderEnv } from './book-render.js';
import { iso, isoOrNull, toUserBrief, type UserBriefSource } from './dto.js';
import { mediaPaths } from './media.service.js';

type Lang = 'de' | 'en';
type BookRow = PhotoBook & { createdBy: UserBriefSource };

export interface CreateBookInput {
  title?: string;
  format: BookFormat;
  textMode: BookTextMode;
  months: string[];
  onlyCommented: boolean;
}

export interface UpdateBookInput {
  title?: string;
  pages?: BookPage[];
}

export interface BookRenderEnv {
  dpi?: number;
  previewWidth?: number;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}

const LINK_TTL = 7 * 24 * 3600;
const include = { createdBy: { select: { id: true, displayName: true, avatarUpdatedAt: true } } } as const;

/** Fotobücher (ADR-0004): Vorschlag berechnen, speichern, im Worker rendern, ausliefern. */
export class BookService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: MediaStorage,
    private readonly signer: UrlSigner,
    private readonly queue: MediaQueue,
  ) {}

  toDto(b: BookRow, membership: Pick<FamilyMember, 'userId' | 'isFamilyAdmin'>) {
    const ready = b.status === 'READY';
    const base = `${API_PREFIX}/books/${b.id}`;
    return {
      id: b.id,
      familyId: b.familyId,
      createdBy: toUserBrief(b.createdBy),
      title: b.title,
      format: b.format,
      textMode: b.textMode,
      months: b.months,
      onlyCommented: b.onlyCommented,
      status: b.status,
      error: b.status === 'FAILED' ? b.error : null,
      pageCount: b.pageCount,
      mediaCount: b.mediaCount,
      pdfBytes: b.pdfBytes,
      createdAt: iso(b.createdAt),
      updatedAt: iso(b.updatedAt),
      renderedAt: isoOrNull(b.renderedAt),
      canEdit: this.canEdit(b, membership),
      urls: {
        pdf: ready ? this.signer.sign(`${base}/pdf`, LINK_TTL) : null,
        cover: ready ? `${this.signer.sign(`${base}/pages/1`, LINK_TTL)}&v=${b.renderedAt?.getTime() ?? 0}` : null,
      },
    };
  }

  toDetailDto(b: BookRow, membership: Pick<FamilyMember, 'userId' | 'isFamilyAdmin'>) {
    const ready = b.status === 'READY';
    const base = `${API_PREFIX}/books/${b.id}`;
    const v = b.renderedAt?.getTime() ?? 0;
    const pages = (b.pages as unknown as BookPage[]).map((page, index) => ({
      index,
      page,
      previewUrl: ready ? `${this.signer.sign(`${base}/pages/${index + 1}`, LINK_TTL)}&v=${v}` : null,
      thumbs: pageMediaIds(page).map((id) => this.signer.sign(mediaPaths(id).thumb400, LINK_TTL)),
    }));
    return { ...this.toDto(b, membership), pages };
  }

  canEdit(b: Pick<PhotoBook, 'createdById'>, membership: Pick<FamilyMember, 'userId' | 'isFamilyAdmin'>) {
    return b.createdById === membership.userId || membership.isFamilyAdmin;
  }

  async list(familyId: string, membership: Pick<FamilyMember, 'userId' | 'isFamilyAdmin'>) {
    const rows = await this.prisma.photoBook.findMany({ where: { familyId }, include, orderBy: { createdAt: 'desc' } });
    return rows.map((b) => this.toDto(b, membership));
  }

  async get(bookId: string): Promise<BookRow> {
    const b = await this.prisma.photoBook.findUnique({ where: { id: bookId }, include });
    if (!b) throw Errors.notFound('Fotobuch nicht gefunden.', 'BOOK_NOT_FOUND');
    return b;
  }

  /** Vorschlag berechnen und speichern; das Rendern läuft im Worker. */
  async create(familyId: string, userId: string, input: CreateBookInput, lang: Lang) {
    const months = [...new Set(input.months)].sort();
    const family = await this.prisma.family.findUnique({ where: { id: familyId }, select: { name: true } });
    if (!family) throw Errors.notFound('Album nicht gefunden.', 'FAMILY_NOT_FOUND');

    const photos = await this.loadPhotos(familyId, months, input.textMode, input.onlyCommented);
    if (photos.length === 0) throw Errors.conflict('In diesem Zeitraum gibt es keine Fotos.', 'BOOK_EMPTY');

    const subtitle = periodLabel(months, lang);
    const title = input.title ?? family.name;
    const pages = proposeBook(photos, { title, subtitle, textMode: input.textMode, lang });
    if (pages.length > MAX_PAGES) {
      throw Errors.conflict(`Das Buch hätte ${pages.length} Seiten, erlaubt sind ${MAX_PAGES}. Bitte weniger Monate wählen.`, 'BOOK_TOO_LARGE');
    }

    const book = await this.prisma.photoBook.create({
      data: {
        familyId,
        createdById: userId,
        title,
        format: input.format,
        textMode: input.textMode,
        months,
        onlyCommented: input.onlyCommented,
        pages: pages as unknown as Prisma.InputJsonValue,
        pageCount: pages.length,
        mediaCount: countMedia(pages),
        status: 'PROCESSING',
      },
      include,
    });
    await this.queue.enqueueRenderBook(book.id);
    return book;
  }

  /** Titel oder Seitenliste ändern; danach wird neu gerendert. */
  async update(book: BookRow, input: UpdateBookInput) {
    const data: Prisma.PhotoBookUpdateInput = { status: 'PROCESSING', error: null };
    if (input.title !== undefined) {
      data.title = input.title;
      // Umschlagtitel folgt dem Buchtitel, solange die Seiten nicht mitgeschickt werden
      if (input.pages === undefined) {
        const pages = book.pages as unknown as BookPage[];
        const cover = pages[0];
        if (cover?.type === 'cover') data.pages = [{ ...cover, title: input.title }, ...pages.slice(1)] as unknown as Prisma.InputJsonValue;
      }
    }
    if (input.pages !== undefined) {
      const ids = [...new Set(input.pages.flatMap(pageMediaIds))];
      const found = await this.prisma.media.count({ where: { id: { in: ids }, familyId: book.familyId, deletedAt: null, status: 'READY', type: 'PHOTO' } });
      if (found !== ids.length) throw Errors.badRequest('Mindestens ein Foto gehört nicht zu diesem Album.', 'BOOK_MEDIA_INVALID');
      data.pages = input.pages as unknown as Prisma.InputJsonValue;
      data.pageCount = input.pages.length;
      data.mediaCount = countMedia(input.pages);
    }
    const updated = await this.prisma.photoBook.update({ where: { id: book.id }, data, include });
    await this.storage.removeQuietly(this.storage.bookDir(book.familyId, book.id));
    await this.queue.enqueueRenderBook(book.id);
    return updated;
  }

  /** Fehlgeschlagenes Buch nochmals rendern. */
  async rerender(book: BookRow) {
    const updated = await this.prisma.photoBook.update({ where: { id: book.id }, data: { status: 'PROCESSING', error: null }, include });
    await this.queue.enqueueRenderBook(book.id);
    return updated;
  }

  async remove(book: PhotoBook) {
    await this.prisma.photoBook.delete({ where: { id: book.id } });
    await this.storage.removeQuietly(this.storage.bookDir(book.familyId, book.id));
  }

  pdfPath(book: Pick<PhotoBook, 'familyId' | 'id'>) {
    return this.storage.bookPdfPath(book.familyId, book.id);
  }

  pagePath(book: Pick<PhotoBook, 'familyId' | 'id'>, index1: number) {
    return this.storage.bookPagePath(book.familyId, book.id, previewFileName(index1 - 1));
  }

  /** Vom Worker: Seiten rastern, PDF und Vorschauen schreiben, Status setzen. */
  async render(bookId: string, env: BookRenderEnv): Promise<PhotoBook> {
    const book = await this.get(bookId);
    const pages = book.pages as unknown as BookPage[];
    const ids = [...new Set(pages.flatMap(pageMediaIds))];
    const media = await this.prisma.media.findMany({ where: { id: { in: ids } }, select: { id: true, mimeType: true, deletedAt: true } });
    const byId = new Map(media.map((m) => [m.id, m]));
    const dir = this.storage.bookDir(book.familyId, book.id);
    await this.storage.ensureDir(dir);
    const renderEnv: RenderEnv = {
      dpi: env.dpi ?? 300,
      previewWidth: env.previewWidth ?? 600,
      photoPath: async (mediaId) => {
        const m = byId.get(mediaId);
        if (!m || m.deletedAt) return null;
        const ext = MIME_EXTENSIONS[m.mimeType]?.ext;
        const thumb = this.storage.thumbPath(book.familyId, mediaId, 1600);
        // HEIC kann sharp ohne libheif nicht lesen → Thumbnail (1600 px); sonst das Original in voller Auflösung
        if (!ext || ext === 'heic' || ext === 'heif') return (await this.storage.exists(thumb)) ? thumb : null;
        const original = this.storage.originalPath(book.familyId, mediaId, ext);
        if (await this.storage.exists(original)) return original;
        return (await this.storage.exists(thumb)) ? thumb : null;
      },
      log: (msg, extra) => env.log.warn({ bookId, ...extra }, msg),
    };
    try {
      const result = await renderBook(pages, book.format, renderEnv, { pdfPath: this.pdfPath(book), pageDir: dir });
      const updated = await this.prisma.photoBook.update({
        where: { id: book.id },
        data: { status: 'READY', error: null, pageCount: result.pageCount, pdfBytes: result.pdfBytes, renderedAt: new Date() },
      });
      env.log.info({ bookId, pages: result.pageCount, bytes: result.pdfBytes }, 'book ready');
      return updated;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      env.log.warn({ bookId, reason }, 'book failed');
      return this.prisma.photoBook.update({ where: { id: book.id }, data: { status: 'FAILED', error: reason.slice(0, 1000) } });
    }
  }

  private async loadPhotos(familyId: string, months: string[], textMode: BookTextMode, onlyCommented: boolean): Promise<BookPhoto[]> {
    const first = months[0]!;
    const last = months[months.length - 1]!;
    const [fy, fm] = first.split('-').map(Number) as [number, number];
    const [ly, lm] = last.split('-').map(Number) as [number, number];
    const wanted = new Set(months);
    const rows = await this.prisma.media.findMany({
      where: { familyId, deletedAt: null, status: 'READY', type: 'PHOTO', takenAt: { gte: new Date(Date.UTC(fy, fm - 1, 1)), lt: new Date(Date.UTC(ly, lm, 1)) } },
      select: {
        id: true,
        takenAt: true,
        width: true,
        height: true,
        caption: true,
        comments: {
          orderBy: { createdAt: 'asc' },
          select: { body: true, author: { select: { displayName: true } } },
          ...(textMode === 'COMMENTS' ? {} : { take: 1 }),
        },
      },
      orderBy: { takenAt: 'asc' },
    });
    return rows
      .filter((m) => wanted.has(monthKeyUtc(m.takenAt)) && (!onlyCommented || m.comments.length > 0))
      .map((m) => ({
        mediaId: m.id,
        takenAt: m.takenAt,
        width: m.width,
        height: m.height,
        caption: m.caption,
        comments: textMode === 'COMMENTS' ? m.comments.map((c) => ({ author: c.author.displayName, body: c.body })) : [],
      }));
  }
}

export function pageMediaIds(page: BookPage): string[] {
  if (page.type === 'cover') return page.mediaId ? [page.mediaId] : [];
  if (page.type === 'photos') return page.items.map((i) => i.mediaId);
  return [];
}
