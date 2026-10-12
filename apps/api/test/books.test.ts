import { stat } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookService } from '../src/services/book.service.js';
import { proposeBook, type BookPhoto } from '../src/services/book-layout.js';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

const silentLog = { info() {}, warn() {} };

describe('Fotobuch', () => {
  it('legt ein Buch mit Umschlag, Kapiteln und Fotoseiten an, reiht das Rendern ein und prüft die Rechte', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin('Familie Test');
    const viewer = await ctx.createUser({ displayName: 'Gast' });
    await ctx.addMember(family, viewer, { canComment: true });
    const maker = await ctx.createUser({ displayName: 'Tante' });
    await ctx.addMember(family, maker, { canCreateBooks: true });

    const a = await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 1200, height: 800 }), { takenAt: '2026-03-05T10:00:00.000Z' });
    await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 800, height: 1200, color: '#cc3366' }), { takenAt: '2026-03-05T11:00:00.000Z' });
    await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 800, height: 1200, color: '#33cc66' }), { takenAt: '2026-03-05T12:00:00.000Z' });
    await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 1200, height: 800, color: '#999999' }), { takenAt: '2026-04-20T12:00:00.000Z' });
    await (await ctx.as(admin)).patch(`/media/${a.id}`, { caption: 'Erster Schneetag' });
    expect((await (await ctx.as(viewer)).post(`/media/${a.id}/comments`, { body: 'So schön!' })).statusCode).toBe(201);

    // Rechte: ohne canCreateBooks 403, leerer Zeitraum 409
    expectProblem(await (await ctx.as(viewer)).post(`/families/${family.id}/books`, { months: ['2026-03'] }), 403, 'PERMISSION_CANCREATEBOOKS');
    expectProblem(await (await ctx.as(maker)).post(`/families/${family.id}/books`, { months: ['2025-01'] }), 409, 'BOOK_EMPTY');
    expectProblem(await (await ctx.as(maker)).post(`/families/${family.id}/books`, { months: ['2026-3'] }), 400);

    const res = await (await ctx.as(maker)).post(`/families/${family.id}/books`, { months: ['2026-04', '2026-03'], textMode: 'COMMENTS' });
    expect(res.statusCode, res.body).toBe(202);
    const book = res.json();
    expect(book).toMatchObject({
      title: 'Familie Test',
      format: 'SQUARE_21',
      textMode: 'COMMENTS',
      months: ['2026-03', '2026-04'],
      status: 'PROCESSING',
      mediaCount: 4,
      canEdit: true,
      urls: { pdf: null, cover: null },
    });
    const types = book.pages.map((p: { page: { type: string; template?: string } }) => p.page.template ?? p.page.type);
    // Umschlag, März, Foto mit Text (Kommentar), Hochformat-Paar, April, Querformat allein
    expect(types).toEqual(['cover', 'chapter', 'one_text', 'two', 'chapter', 'one']);
    expect(book.pages[0].page.mediaId).toBe(a.id); // meistkommentiertes Foto als Titelbild
    expect(book.pages[2].page.items[0]).toMatchObject({ mediaId: a.id, caption: 'Erster Schneetag', comments: [{ author: 'Gast', body: 'So schön!' }] });
    expect(book.pages[2].thumbs).toHaveLength(1);
    expect(ctx.queue.books).toEqual([book.id]);

    // Liste und Detail für alle Mitglieder; Ändern/Löschen nur Ersteller oder Album-Admin
    const list = (await (await ctx.as(viewer)).get(`/families/${family.id}/books`)).json();
    expect(list.map((b: { id: string; canEdit: boolean }) => [b.id, b.canEdit])).toEqual([[book.id, false]]);
    expect((await (await ctx.as(viewer)).get(`/books/${book.id}`)).statusCode).toBe(200);
    expectProblem(await (await ctx.as(viewer)).patch(`/books/${book.id}`, { title: 'Nö' }), 403, 'BOOK_NOT_OWNER');
    expectProblem(await (await ctx.as(viewer)).get(`/books/${book.id}/pdf`), 404, 'BOOK_NOT_READY');

    const renamed = await (await ctx.as(admin)).patch(`/books/${book.id}`, { title: 'Frühling' });
    expect(renamed.statusCode, renamed.body).toBe(202);
    expect(renamed.json().title).toBe('Frühling');
    expect(renamed.json().pages[0].page.title).toBe('Frühling');
    expect(ctx.queue.books).toEqual([book.id, book.id]);

    // Seiten ersetzen: fremdes Foto → 400
    const foreign = await ctx.createFamilyWithAdmin();
    const other = await ctx.uploadAndProcess(foreign.admin, foreign.family, await makeJpeg(), { takenAt: '2026-03-01T00:00:00.000Z' });
    expectProblem(
      await (await ctx.as(maker)).patch(`/books/${book.id}`, { pages: [{ type: 'photos', template: 'one', items: [{ mediaId: other.id, caption: null, comments: [] }] }] }),
      400,
      'BOOK_MEDIA_INVALID',
    );
    const shrunk = await (await ctx.as(maker)).patch(`/books/${book.id}`, {
      pages: [
        { type: 'cover', mediaId: a.id, title: 'Klein', subtitle: 'März 2026' },
        { type: 'photos', template: 'one', items: [{ mediaId: a.id, caption: null, comments: [] }] },
      ],
    });
    expect(shrunk.statusCode, shrunk.body).toBe(202);
    expect(shrunk.json()).toMatchObject({ pageCount: 2, mediaCount: 1 });

    expectProblem(await (await ctx.as(viewer)).delete(`/books/${book.id}`), 403, 'BOOK_NOT_OWNER');
    expect((await (await ctx.as(maker)).delete(`/books/${book.id}`)).statusCode).toBe(204);
    expectProblem(await (await ctx.as(maker)).get(`/books/${book.id}`), 404, 'BOOK_NOT_FOUND');
  });

  it('rendert PDF und Seitenvorschauen (Worker) und liefert sie signiert aus', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin('Familie Test');
    await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 1200, height: 800 }), { takenAt: '2026-05-01T10:00:00.000Z' });
    await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 600, height: 900, color: '#cc3366' }), { takenAt: '2026-05-02T10:00:00.000Z' });
    const created = (await (await ctx.as(admin)).post(`/families/${family.id}/books`, { months: ['2026-05'], format: 'A4_LANDSCAPE', title: 'Mai' })).json();

    const svc = new BookService(ctx.prisma, ctx.app.storage, ctx.app.signer, ctx.queue);
    const rendered = await svc.render(created.id, { dpi: 60, previewWidth: 200, log: silentLog });
    expect(rendered.status, rendered.error ?? '').toBe('READY');
    expect(rendered.pageCount).toBe(4); // Umschlag, Kapitel, zwei Fotoseiten
    expect(rendered.pdfBytes).toBeGreaterThan(1000);
    expect((await stat(ctx.app.storage.bookPdfPath(family.id, created.id))).size).toBe(rendered.pdfBytes);

    const detail = (await (await ctx.as(admin)).get(`/books/${created.id}`)).json();
    expect(detail.status).toBe('READY');
    expect(detail.urls.pdf).toMatch(/\/books\/.*\/pdf\?exp=/);
    expect(detail.pages).toHaveLength(4);
    expect(detail.pages[3].previewUrl).toMatch(/\/pages\/4\?exp=/);

    // signierte Links ohne Bearer; Bearer eines Mitglieds geht auch
    const pdf = await ctx.app.inject({ method: 'GET', url: detail.urls.pdf });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const page = await ctx.app.inject({ method: 'GET', url: detail.pages[0].previewUrl });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toBe('image/webp');
    expect((await (await ctx.as(admin)).get(`/books/${created.id}/pages/2`)).statusCode).toBe(200);
    expectProblem(await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${created.id}/pdf` }), 401);
  });

  it('Layout: Querformate wechseln zwischen ganzer Seite und Paaren, Vierer-Raster bei vielen kleinen', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 0, 3, h));
    const photo = (i: number, w: number, h: number): BookPhoto => ({ mediaId: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`, takenAt: at(i), width: w, height: h, caption: null, comments: [] });
    const landscapes = [1, 2, 3, 4, 5, 6].map((i) => photo(i, 1200, 800));
    const pages = proposeBook(landscapes, { title: 'T', subtitle: 'S', textMode: 'NONE', lang: 'de' });
    expect(pages.map((p) => (p.type === 'photos' ? p.template : p.type))).toEqual(['cover', 'chapter', 'one', 'two_stacked', 'two_stacked', 'one']);
    expect(pages[1]).toMatchObject({ type: 'chapter', title: 'Januar 2026', subtitle: '6 Fotos' });

    const mixed = [photo(1, 800, 1200), photo(2, 1200, 800), photo(3, 1200, 800), photo(4, 1200, 800)];
    const mixedPages = proposeBook(mixed, { title: 'T', subtitle: 'S', textMode: 'NONE', lang: 'en' });
    expect(mixedPages.map((p) => (p.type === 'photos' ? p.template : p.type))).toEqual(['cover', 'chapter', 'four']);
    expect(mixedPages[1]).toMatchObject({ title: 'January 2026', subtitle: '4 photos' });

    // Text erzwingt «Bild mit Text», gleiche Eingabe → gleiches Ergebnis
    const withText = [{ ...photo(1, 1200, 800), caption: 'Hallo' }, photo(2, 1200, 800)];
    const t1 = proposeBook(withText, { title: 'T', subtitle: 'S', textMode: 'CAPTIONS', lang: 'de' });
    expect(t1.map((p) => (p.type === 'photos' ? p.template : p.type))).toEqual(['cover', 'chapter', 'one_text', 'one']);
    expect(JSON.stringify(t1)).toBe(JSON.stringify(proposeBook(withText, { title: 'T', subtitle: 'S', textMode: 'CAPTIONS', lang: 'de' })));
  });
});
