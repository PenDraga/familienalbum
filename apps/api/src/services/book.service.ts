import type { FamilyMember, PhotoBook, Prisma, PrismaClient } from '@prisma/client';
import { API_PREFIX } from '../config/constants.js';
import { Errors } from '../lib/errors.js';
import type { MediaQueue } from '../lib/queue.js';
import type { UrlSigner } from '../lib/signed-url.js';
import { MIME_EXTENSIONS, type MediaStorage } from '../lib/storage.js';
import { aspectOf, countMedia, MAX_PAGES, monthKeyUtc, periodLabel, proposeBook, type BookFormat, type BookLayout, type BookPage, type BookPhoto, type BookTextMode } from './book-layout.js';
import { previewFileName, renderBook, renderPagePreview, type RenderEnv } from './book-render.js';
import { iso, isoOrNull, toUserBrief, type UserBriefSource } from './dto.js';
import { mediaPaths } from './media.service.js';

type Lang = 'de' | 'en';
type BookRow = PhotoBook & { createdBy: UserBriefSource };

export interface CreateBookInput {
  title?: string;
  format: BookFormat;
  textMode: BookTextMode;
  layout: BookLayout;
  months: string[];
  onlyCommented: boolean;
  excludeMediaIds: string[];
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
      layout: b.layout,
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
        /** Thumbnail des Umschlagfotos – für Karten, solange es noch keine gerenderte Vorschau gibt */
        coverPhoto: coverMediaId(b) ? this.signer.sign(mediaPaths(coverMediaId(b)!).thumb400, LINK_TTL) : null,
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

  /** Seitenvorschlag berechnen, ohne zu speichern (Assistent: geschätzte Seitenzahl, Anlegen). */
  async plan(familyId: string, input: CreateBookInput, lang: Lang) {
    const months = [...new Set(input.months)].sort();
    const family = await this.prisma.family.findUnique({ where: { id: familyId }, select: { name: true } });
    if (!family) throw Errors.notFound('Album nicht gefunden.', 'FAMILY_NOT_FOUND');
    const excluded = new Set(input.excludeMediaIds);
    const photos = (await this.loadPhotos(familyId, months, input.textMode, input.onlyCommented)).filter((p) => !excluded.has(p.mediaId));
    const subtitle = periodLabel(months, lang);
    const title = input.title ?? family.name;
    const pages = photos.length === 0 ? [] : proposeBook(photos, { title, subtitle, textMode: input.textMode, layout: input.layout, lang });
    return { months, title, pages };
  }

  async preview(familyId: string, input: CreateBookInput, lang: Lang) {
    const { pages } = await this.plan(familyId, input, lang);
    return { pageCount: pages.length, mediaCount: countMedia(pages), maxPages: MAX_PAGES };
  }

  /** Monate mit fertigen Fotos, neueste zuerst. */
  async months(familyId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
      SELECT to_char("takenAt" AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*) AS count
      FROM "Media"
      WHERE "familyId" = ${familyId} AND "deletedAt" IS NULL AND status = 'READY' AND type = 'PHOTO'
      GROUP BY 1 ORDER BY 1 DESC`;
    return rows.map((r) => ({ month: r.month, count: Number(r.count) }));
  }

  /** Fotos der Monate für den Assistenten, chronologisch, mit signiertem Thumbnail. */
  async photos(familyId: string, months: string[]) {
    const sorted = [...new Set(months)].sort();
    const wanted = new Set(sorted);
    const [fy, fm] = sorted[0]!.split('-').map(Number) as [number, number];
    const [ly, lm] = sorted[sorted.length - 1]!.split('-').map(Number) as [number, number];
    const rows = await this.prisma.media.findMany({
      where: { familyId, deletedAt: null, status: 'READY', type: 'PHOTO', takenAt: { gte: new Date(Date.UTC(fy, fm - 1, 1)), lt: new Date(Date.UTC(ly, lm, 1)) } },
      select: { id: true, takenAt: true, width: true, height: true, caption: true, _count: { select: { comments: true } } },
      orderBy: [{ takenAt: 'asc' }, { id: 'asc' }],
      take: 5000,
    });
    return rows
      .filter((m) => wanted.has(monthKeyUtc(m.takenAt)))
      .map((m) => ({
        id: m.id,
        takenAt: iso(m.takenAt),
        width: m.width,
        height: m.height,
        caption: m.caption,
        commentCount: m._count.comments,
        thumbUrl: this.signer.sign(mediaPaths(m.id).thumb400, LINK_TTL),
      }));
  }

  /** Vorschlag berechnen und speichern; das Rendern läuft im Worker. */
  async create(familyId: string, userId: string, input: CreateBookInput, lang: Lang) {
    const { months, title, pages } = await this.plan(familyId, input, lang);
    if (pages.length === 0) throw Errors.conflict('In diesem Zeitraum gibt es keine Fotos.', 'BOOK_EMPTY');
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
        layout: input.layout,
        months,
        onlyCommented: input.onlyCommented,
        pages: pages as unknown as Prisma.InputJsonValue,
        pageCount: pages.length,
        mediaCount: countMedia(pages),
        // Entwurf: erst prüfen, dann «PDF erstellen» (requestRender)
        status: 'DRAFT',
      },
      include,
    });
    return book;
  }

  /** Titel oder Seitenliste ändern. Das Buch wird wieder zum Entwurf; ein vorhandenes PDF ist damit veraltet und wird entfernt. */
  async update(book: BookRow, input: UpdateBookInput) {
    const data: Prisma.PhotoBookUpdateInput = { status: 'DRAFT', error: null, pdfBytes: null };
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
      const pages = await this.checkPages(book.familyId, input.pages);
      data.pages = pages as unknown as Prisma.InputJsonValue;
      data.pageCount = pages.length;
      data.mediaCount = countMedia(pages);
    }
    const updated = await this.prisma.photoBook.update({ where: { id: book.id }, data, include });
    // Veraltetes PDF und alte Seitenvorschauen weg; neu erst über «PDF erstellen»
    await this.storage.removeQuietly(this.storage.bookDir(book.familyId, book.id));
    return updated;
  }

  /**
   * Seiten vom Client prüfen: alle Fotos gehören zum Album und sind fertig; Seitenverhältnisse kommen immer aus den
   * Fotodaten, nicht vom Client.
   */
  private async checkPages(familyId: string, pages: BookPage[]): Promise<BookPage[]> {
    const ids = [...new Set(pages.flatMap(pageMediaIds))];
    const found = await this.prisma.media.findMany({
      where: { id: { in: ids }, familyId, deletedAt: null, status: 'READY', type: 'PHOTO' },
      select: { id: true, width: true, height: true },
    });
    if (found.length !== ids.length) throw Errors.badRequest('Mindestens ein Foto gehört nicht zu diesem Album.', 'BOOK_MEDIA_INVALID');
    const aspects = new Map(found.map((m) => [m.id, aspectOf(m)]));
    return pages.map((p) => (p.type === 'photos' ? { ...p, items: p.items.map((i) => ({ ...i, aspect: aspects.get(i.mediaId) })) } : p));
  }

  /** Eine (bearbeitete) Seite als WebP rendern, ohne zu speichern – Kontroll-Assistent. */
  async previewPage(book: BookRow, page: BookPage): Promise<{ image: Buffer; slots: Record<string, number> }> {
    const [checked] = await this.checkPages(book.familyId, [page]);
    // Fotos dieser Seite, nicht der gespeicherten – die Seite kann gerade bearbeitet sein
    const env = await this.renderEnvFor(book.familyId, book.id, pageMediaIds(checked!), { dpi: 90, previewWidth: 900, log: { info() {}, warn() {} } });
    return renderPagePreview(checked!, book.format, env);
  }

  /** «PDF erstellen»: Druck-PDF und Seitenvorschauen im Worker rendern (auch nach einem Fehler). */
  async requestRender(book: BookRow) {
    if (book.status === 'RENDERING') return book;
    const updated = await this.prisma.photoBook.update({ where: { id: book.id }, data: { status: 'RENDERING', error: null }, include });
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

  /** Pfade der Fotos fürs Rendern: Original in voller Auflösung, bei HEIC oder fehlendem Original das Thumbnail. */
  private async renderEnv(book: Pick<PhotoBook, 'id' | 'familyId' | 'pages'>, env: BookRenderEnv): Promise<RenderEnv> {
    const ids = [...new Set((book.pages as unknown as BookPage[]).flatMap(pageMediaIds))];
    return this.renderEnvFor(book.familyId, book.id, ids, env);
  }

  private async renderEnvFor(familyId: string, bookId: string, ids: string[], env: BookRenderEnv): Promise<RenderEnv> {
    const media = await this.prisma.media.findMany({ where: { id: { in: ids } }, select: { id: true, mimeType: true, deletedAt: true } });
    const byId = new Map(media.map((m) => [m.id, m]));
    return {
      dpi: env.dpi ?? 300,
      previewWidth: env.previewWidth ?? 600,
      photoPath: async (mediaId) => {
        const m = byId.get(mediaId);
        if (!m || m.deletedAt) return null;
        const ext = MIME_EXTENSIONS[m.mimeType]?.ext;
        const thumb = this.storage.thumbPath(familyId, mediaId, 1600);
        // HEIC kann sharp ohne libheif nicht lesen → Thumbnail (1600 px); sonst das Original in voller Auflösung
        if (!ext || ext === 'heic' || ext === 'heif') return (await this.storage.exists(thumb)) ? thumb : null;
        const original = this.storage.originalPath(familyId, mediaId, ext);
        if (await this.storage.exists(original)) return original;
        return (await this.storage.exists(thumb)) ? thumb : null;
      },
      log: (msg, extra) => env.log.warn({ bookId, ...extra }, msg),
    };
  }

  /** Vom Worker: Seiten rastern, PDF und Vorschauen schreiben, Status setzen. */
  async render(bookId: string, env: BookRenderEnv): Promise<PhotoBook> {
    const book = await this.get(bookId);
    // Veralteter Auftrag (Buch inzwischen geändert oder schon fertig)
    if (book.status !== 'RENDERING') return book;
    const pages = book.pages as unknown as BookPage[];
    const dir = this.storage.bookDir(book.familyId, book.id);
    await this.storage.ensureDir(dir);
    const renderEnv = await this.renderEnv(book, env);
    try {
      const result = await renderBook(pages, book.format, renderEnv, { pdfPath: this.pdfPath(book), pageDir: dir });
      // Nur übernehmen, wenn niemand das Buch inzwischen geändert hat (dann ist es wieder ein Entwurf)
      const done = await this.prisma.photoBook.updateMany({
        where: { id: book.id, status: 'RENDERING', updatedAt: book.updatedAt },
        data: { status: 'READY', error: null, pageCount: result.pageCount, pdfBytes: result.pdfBytes, renderedAt: new Date() },
      });
      if (done.count === 0) {
        env.log.info({ bookId }, 'book changed while rendering – result discarded');
        await this.storage.removeQuietly(dir);
      } else {
        env.log.info({ bookId, pages: result.pageCount, bytes: result.pdfBytes }, 'book ready');
      }
      return this.prisma.photoBook.findUniqueOrThrow({ where: { id: book.id } });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      env.log.warn({ bookId, reason }, 'book failed');
      await this.prisma.photoBook.updateMany({ where: { id: book.id, status: 'RENDERING' }, data: { status: 'FAILED', error: reason.slice(0, 1000) } });
      return this.prisma.photoBook.findUniqueOrThrow({ where: { id: book.id } });
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

function coverMediaId(b: Pick<PhotoBook, 'pages'>): string | null {
  const first = (b.pages as unknown as BookPage[])[0];
  return first?.type === 'cover' ? first.mediaId : null;
}
