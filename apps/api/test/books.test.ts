import { stat } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookService } from '../src/services/book.service.js';
import { cropBox } from '../src/services/book-render.js';
import { justifiedRects, proposeBook, type BookLayout, type BookPhoto } from '../src/services/book-layout.js';
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
    // Umschlag, März: das Foto mit kurzem Text bleibt mit dem Hochformat-Paar vom selben Tag in der Collage, April
    expect(types).toEqual(['cover', 'chapter', 'auto', 'chapter', 'auto']);
    expect(book.layout).toBe('MIXED');
    expect(book.pages[2].page.items.map((i: { aspect: number }) => i.aspect)).toEqual([1.5, 0.667, 0.667]);
    expect(book.pages[0].page.mediaId).toBe(a.id); // meistkommentiertes Foto als Titelbild
    expect(book.pages[2].page.items[0]).toMatchObject({ mediaId: a.id, caption: 'Erster Schneetag', comments: [{ author: 'Gast', body: 'So schön!' }] });
    expect(book.pages[2].thumbs).toHaveLength(3);
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
    expect(rendered.pageCount).toBe(3); // Umschlag, Kapitel, eine Seite mit beiden Fotos
    expect(rendered.pdfBytes).toBeGreaterThan(1000);
    expect((await stat(ctx.app.storage.bookPdfPath(family.id, created.id))).size).toBe(rendered.pdfBytes);

    const detail = (await (await ctx.as(admin)).get(`/books/${created.id}`)).json();
    expect(detail.status).toBe('READY');
    expect(detail.urls.pdf).toMatch(/\/books\/.*\/pdf\?exp=/);
    expect(detail.pages).toHaveLength(3);
    expect(detail.pages[2].previewUrl).toMatch(/\/pages\/3\?exp=/);

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

  it('Assistent: Monate mit Fotos, Fotos zum Abwählen, Seitenschätzung und Ausschlüsse beim Anlegen', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin('Familie Test');
    const viewer = await ctx.createUser();
    await ctx.addMember(family, viewer, { canUpload: true });
    const ids: string[] = [];
    for (const [i, d] of ['2025-12-24', '2026-02-01', '2026-02-02', '2026-02-03'].entries()) {
      const m = await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 300 + i, height: 200 }), { takenAt: `${d}T10:00:00.000Z` });
      ids.push(m.id);
    }

    expectProblem(await (await ctx.as(viewer)).get(`/families/${family.id}/books/months`), 403, 'PERMISSION_CANCREATEBOOKS');
    const months = (await (await ctx.as(admin)).get(`/families/${family.id}/books/months`)).json();
    expect(months).toEqual([{ month: '2026-02', count: 3 }, { month: '2025-12', count: 1 }]);

    const photos = await (await ctx.as(admin)).get(`/families/${family.id}/books/photos?months=2026-02,2025-12`);
    expect(photos.statusCode, photos.body).toBe(200);
    expect(photos.json().map((p: { id: string }) => p.id)).toEqual(ids);
    expect(photos.json()[0]).toMatchObject({ width: 300, height: 200, commentCount: 0, caption: null });
    expect(photos.json()[0].thumbUrl).toMatch(/\/thumb\/400\?exp=/);
    expectProblem(await (await ctx.as(admin)).get(`/families/${family.id}/books/photos?months=2026-2`), 400);

    const body = { months: ['2026-02'], layout: 'SINGLE' };
    const preview = (await (await ctx.as(admin)).post(`/families/${family.id}/books/preview`, body)).json();
    expect(preview).toEqual({ pageCount: 5, mediaCount: 3, maxPages: 200 }); // Umschlag, Kapitel, 3 Einzelseiten
    const collage = (await (await ctx.as(admin)).post(`/families/${family.id}/books/preview`, { ...body, layout: 'COLLAGE' })).json();
    expect(collage.pageCount).toBe(3);
    const none = (await (await ctx.as(admin)).post(`/families/${family.id}/books/preview`, { ...body, excludeMediaIds: ids })).json();
    expect(none).toEqual({ pageCount: 0, mediaCount: 0, maxPages: 200 });

    const created = await (await ctx.as(admin)).post(`/families/${family.id}/books`, { ...body, excludeMediaIds: [ids[2]] });
    expect(created.statusCode, created.body).toBe(202);
    expect(created.json()).toMatchObject({ layout: 'SINGLE', mediaCount: 2, pageCount: 4 });
    const used = created.json().pages.flatMap((p: { page: { items?: Array<{ mediaId: string }> } }) => p.page.items?.map((i) => i.mediaId) ?? []);
    expect(used).not.toContain(ids[2]);
    expectProblem(await (await ctx.as(admin)).post(`/families/${family.id}/books`, { ...body, excludeMediaIds: ids }), 409, 'BOOK_EMPTY');
  });

  it('Layout: ein Foto pro Seite, gemischt mit Highlight und Tagen zusammen, Collage', () => {
    const photo = (i: number, w: number, h: number, day = i): BookPhoto => ({
      mediaId: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`,
      takenAt: new Date(Date.UTC(2026, 0, day, 8 + i)),
      width: w,
      height: h,
      caption: null,
      comments: [],
    });
    const shape = (layout: BookLayout, photos: BookPhoto[]) =>
      proposeBook(photos, { title: 'T', subtitle: 'S', textMode: 'NONE', layout, lang: 'de' }).map((p) => (p.type === 'photos' ? `${p.template}:${p.items.length}` : p.type));

    const sixDays = [1, 2, 3, 4, 5, 6].map((i) => photo(i, 1200, 800));
    expect(shape('SINGLE', sixDays)).toEqual(['cover', 'chapter', 'auto:1', 'auto:1', 'auto:1', 'auto:1', 'auto:1', 'auto:1']);
    // Tage zusammengelegt (höchstens 3 aus verschiedenen Tagen); Highlight = Querformat in der Monatsmitte,
    // nicht das Umschlagfoto, eingesetzt an der Seitengrenze
    expect(shape('MIXED', sixDays)).toEqual(['cover', 'chapter', 'auto:3', 'one:1', 'auto:2']);
    expect(shape('COLLAGE', sixDays)).toEqual(['cover', 'chapter', 'auto:6']);

    // Fünf Fotos am selben Tag bleiben zusammen und werden gleichmässig geteilt
    const oneDay = [1, 2, 3, 4, 5].map((i) => photo(i, 800, 1200, 7));
    expect(shape('MIXED', oneDay)).toEqual(['cover', 'chapter', 'auto:3', 'auto:2']);

    // Das meistkommentierte Foto kommt auf den Umschlag und wird darum nicht nochmals Highlight;
    // mit Kommentar-Text bekommt es eine eigene Textseite
    const withComment = sixDays.map((p, i) => (i === 3 ? { ...p, comments: [{ author: 'Oma', body: 'Schön' }] } : p));
    const pages = proposeBook(withComment, { title: 'T', subtitle: 'S', textMode: 'NONE', layout: 'MIXED', lang: 'de' });
    expect(pages[0]).toMatchObject({ type: 'cover', mediaId: withComment[3]!.mediaId });
    expect(shape('MIXED', withComment)).toEqual(['cover', 'chapter', 'auto:3', 'one:1', 'auto:2']);
    // Kurzer Kommentar bleibt in der Collage (Seiten mit Text höchstens 3 Fotos), «ein Foto pro Seite» gibt ihm eine Textseite
    const commented = proposeBook(withComment, { title: 'T', subtitle: 'S', textMode: 'COMMENTS', layout: 'MIXED', lang: 'en' });
    expect(commented.map((p) => (p.type === 'photos' ? `${p.template}:${p.items.length}` : p.type))).toEqual(['cover', 'chapter', 'auto:3', 'auto:3']);
    expect(commented[1]).toMatchObject({ title: 'January 2026', subtitle: '6 photos' });
    const single = proposeBook(withComment, { title: 'T', subtitle: 'S', textMode: 'COMMENTS', layout: 'SINGLE', lang: 'de' });
    expect(single.filter((p) => p.type === 'photos' && p.template === 'one_text')).toHaveLength(1);

    // Viel Text (mehr als zwei Kommentare) bekommt auch bei «Gemischt» eine eigene Textseite
    const chatty = sixDays.map((p, i) => (i === 2 ? { ...p, comments: ['a', 'b', 'c'].map((x) => ({ author: x, body: 'Kommentar' })) } : p));
    const chattyPages = proposeBook(chatty, { title: 'T', subtitle: 'S', textMode: 'COMMENTS', layout: 'MIXED', lang: 'de' });
    expect(chattyPages.map((p) => (p.type === 'photos' ? p.template : p.type))).toContain('one_text');

    // Collage: Seiten mit Text höchstens 4 Fotos
    const captioned = [1, 2, 3, 4, 5, 6].map((i) => ({ ...photo(i, 1200, 800, 3), caption: `Foto ${i}` }));
    expect(shape('COLLAGE', captioned)).toEqual(['cover', 'chapter', 'auto:6']);
    const captionedPages = proposeBook(captioned, { title: 'T', subtitle: 'S', textMode: 'CAPTIONS', layout: 'COLLAGE', lang: 'de' });
    expect(captionedPages.map((p) => (p.type === 'photos' ? `${p.template}:${p.items.length}` : p.type))).toEqual(['cover', 'chapter', 'auto:3', 'auto:3']);

    // gleiche Eingabe → gleiches Buch
    expect(JSON.stringify(shape('MIXED', sixDays))).toBe(JSON.stringify(shape('MIXED', sixDays)));
  });

  it('Reihen-Layout: Seitenverhältnisse bleiben, nichts ragt aus dem Satzspiegel', () => {
    const box = { x: 15, y: 15, w: 186, h: 186 };
    const within = (r: { x: number; y: number; w: number; h: number }) =>
      r.x >= box.x - 1e-6 && r.y >= box.y - 1e-6 && r.x + r.w <= box.x + box.w + 1e-6 && r.y + r.h <= box.y + box.h + 1e-6;

    const twoPortraits = justifiedRects(box, [2 / 3, 2 / 3], 4);
    expect(twoPortraits[0]!.y).toBeCloseTo(twoPortraits[1]!.y); // eine Reihe
    expect(twoPortraits[0]!.w / twoPortraits[0]!.h).toBeCloseTo(2 / 3);

    const threeLandscapes = justifiedRects(box, [1.5, 1.5, 1.5], 4);
    expect(threeLandscapes[1]!.y).toBeCloseTo(threeLandscapes[2]!.y); // oben eins gross, unten zwei
    expect(threeLandscapes[0]!.w).toBeGreaterThan(threeLandscapes[1]!.w);

    // Platz für Text unter den Fotos: Reihen werden um den Text höher, nichts überlappt, alles bleibt im Satzspiegel
    const withText = justifiedRects(box, [1.5, 1.5, 0.75], 4, [20, 0, 12]);
    const rowOf = (r: { y: number }) => withText.findIndex((x) => Math.abs(x.y - r.y) < 1e-6);
    for (const [i, r] of withText.entries()) {
      const reserved = Math.max(...withText.filter((x) => rowOf(x) === rowOf(r)).map((_, k) => [20, 0, 12][withText.indexOf(_)] ?? 0), 0);
      const nextTop = Math.min(...withText.filter((x) => x.y > r.y + 1e-6).map((x) => x.y), box.y + box.h);
      expect(r.y + r.h + reserved, JSON.stringify({ i, r })).toBeLessThanOrEqual(nextTop + 1e-6);
    }

    for (const aspects of [[1.5], [0.75], [1.5, 0.75], [1, 1, 1, 1], [1.5, 0.67, 1.5, 0.67, 1.5], [1.33, 1.33, 1.33, 0.75, 0.75, 1.33]]) {
      const rects = justifiedRects(box, aspects, 4);
      expect(rects).toHaveLength(aspects.length);
      rects.forEach((r, i) => {
        expect(within(r), JSON.stringify({ aspects, r })).toBe(true);
        expect(r.w / r.h).toBeCloseTo(aspects[i]!, 3);
      });
    }
  });
  it('Kontroll-Assistent: Einzelseiten-Vorschau, Ausschnitt speichern, Rechte', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin('Familie Test');
    const viewer = await ctx.createUser();
    await ctx.addMember(family, viewer, { canComment: true });
    const portrait = await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 600, height: 900 }), { takenAt: '2026-06-01T10:00:00.000Z' });
    const landscape = await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 900, height: 600, color: '#cc3366' }), { takenAt: '2026-06-02T10:00:00.000Z' });
    const book = (await (await ctx.as(admin)).post(`/families/${family.id}/books`, { months: ['2026-06'] })).json();

    const cover = { ...book.pages[0].page, mediaId: portrait.id, crop: { x: 0.5, y: 0.2, zoom: 1.5 } };
    const preview = await (await ctx.as(admin)).post(`/books/${book.id}/preview-page`, { page: cover });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.headers['content-type']).toBe('image/webp');
    expect(preview.headers['cache-control']).toBe('no-store');
    const meta = await (await import('sharp')).default(preview.rawPayload).metadata();
    expect(meta.width).toBe(900);

    const photoPage = { type: 'photos', template: 'auto', items: [{ mediaId: landscape.id, caption: 'Hallo 👋', comments: [], crop: { x: 0.3, y: 0.6, zoom: 2 } }] };
    expect((await (await ctx.as(admin)).post(`/books/${book.id}/preview-page`, { page: photoPage })).statusCode).toBe(200);
    expectProblem(await (await ctx.as(viewer)).post(`/books/${book.id}/preview-page`, { page: cover }), 403, 'BOOK_NOT_OWNER');
    expectProblem(await (await ctx.as(admin)).post(`/books/${book.id}/preview-page`, { page: { ...cover, crop: { x: 0.5, y: 0.5, zoom: 5 } } }), 400);
    const foreign = await ctx.createFamilyWithAdmin();
    const other = await ctx.uploadAndProcess(foreign.admin, foreign.family, await makeJpeg(), { takenAt: '2026-06-01T00:00:00.000Z' });
    expectProblem(await (await ctx.as(admin)).post(`/books/${book.id}/preview-page`, { page: { ...cover, mediaId: other.id } }), 400, 'BOOK_MEDIA_INVALID');

    // Ausschnitt wird mit den Seiten gespeichert
    const pages = book.pages.map((p: { page: unknown }) => p.page);
    pages[0] = cover;
    const saved = await (await ctx.as(admin)).patch(`/books/${book.id}`, { pages });
    expect(saved.statusCode, saved.body).toBe(202);
    expect(saved.json().pages[0].page.crop).toEqual({ x: 0.5, y: 0.2, zoom: 1.5 });

    // und beim Rendern des ganzen Buchs verwendet
    const svc = new BookService(ctx.prisma, ctx.app.storage, ctx.app.signer, ctx.queue);
    const rendered = await svc.render(book.id, { dpi: 60, previewWidth: 200, log: silentLog });
    expect(rendered.status, rendered.error ?? '').toBe('READY');
  });

  it('Ausschnitt: Fokuspunkt, Zoom und Ränder', () => {
    // 4000×3000, quadratischer Rahmen: grösster Ausschnitt 3000×3000
    expect(cropBox(4000, 3000, 1, { x: 0.5, y: 0.5, zoom: 1 })).toEqual({ left: 500, top: 0, width: 3000, height: 3000 });
    // Fokus ganz links bleibt im Bild
    expect(cropBox(4000, 3000, 1, { x: 0, y: 0.5, zoom: 1 })).toEqual({ left: 0, top: 0, width: 3000, height: 3000 });
    // Zoom 2 um einen Punkt oben rechts
    expect(cropBox(4000, 3000, 1, { x: 0.9, y: 0.1, zoom: 2 })).toEqual({ left: 2500, top: 0, width: 1500, height: 1500 });
    // breiter Rahmen auf einem Hochformat: Höhe wird knapp, Fokus oben hält Köpfe im Bild
    expect(cropBox(2000, 3000, 2, { x: 0.5, y: 0.15, zoom: 1 })).toEqual({ left: 0, top: 0, width: 2000, height: 1000 });
    expect(cropBox(2000, 3000, 2, { x: 0.5, y: 0.5, zoom: 1 })).toEqual({ left: 0, top: 1000, width: 2000, height: 1000 });
  });
});
