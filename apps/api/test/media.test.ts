import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';
import { hasFfmpeg, makeJpeg, makeMp4, makePng } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('Verarbeitung (Worker-Logik)', () => {
  it('liest EXIF-Datum, Masse und erzeugt WebP-Thumbnails', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ width: 2000, height: 1200, takenAt: '2023:08:15 14:30:00' });
    const media = await ctx.uploadAndProcess(admin, family, buf);

    expect(media.status).toBe('READY');
    expect(media.width).toBe(2000);
    expect(media.height).toBe(1200);
    expect(media.takenAt.toISOString()).toBe('2023-08-15T14:30:00.000Z');

    const t400 = await sharp(`${ctx.mediaRoot}/${family.id}/${media.id}/thumb_400.webp`).metadata();
    const t1600 = await sharp(`${ctx.mediaRoot}/${family.id}/${media.id}/thumb_1600.webp`).metadata();
    expect(t400.format).toBe('webp');
    expect(t400.width).toBe(400);
    expect(t400.height).toBe(240);
    expect(t1600.width).toBe(1600);
  });

  it('vertauscht Breite/Höhe bei EXIF-Orientierung 6 und richtet die Thumbnails auf', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ width: 800, height: 600, orientation: 6 });
    const media = await ctx.uploadAndProcess(admin, family, buf);
    expect([media.width, media.height]).toEqual([600, 800]);
    const t = await sharp(`${ctx.mediaRoot}/${family.id}/${media.id}/thumb_400.webp`).metadata();
    expect(t.width).toBe(300);
    expect(t.height).toBe(400);
  });

  it('nutzt ohne EXIF den Geräte-Hinweis, vergrössert kleine Bilder nicht', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.uploadAndProcess(admin, family, await makePng(64, 48), {
      name: 'icon.png',
      mimeType: 'image/png',
      takenAt: '2022-02-02T02:02:02.000Z',
    });
    expect(media.status).toBe('READY');
    expect(media.takenAt.toISOString()).toBe('2022-02-02T02:02:02.000Z');
    const t = await sharp(`${ctx.mediaRoot}/${family.id}/${media.id}/thumb_1600.webp`).metadata();
    expect(t.width).toBe(64);
  });

  it('HEIC: kaputte Datei scheitert sauber, echte Datei wird über heif-convert/ffmpeg gewandelt', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const junk = Buffer.from('kein heic '.repeat(400));
    const media = await ctx.uploadAndProcess(admin, family, junk, { name: 'IMG_9.heic', mimeType: 'image/heic' });
    expect(media.status).toBe('FAILED');
    expect(media.processingError).toMatch(/HEIC/);
  });

  it('markiert defekte Dateien als FAILED mit Grund', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const junk = Buffer.from('das ist kein bild '.repeat(500));
    const media = await ctx.uploadAndProcess(admin, family, junk, { name: 'kaputt.jpg' });
    expect(media.status).toBe('FAILED');
    expect(media.processingError).toBeTruthy();
  });

  it.skipIf(!hasFfmpeg())('transkodiert Videos, erzeugt Poster-Thumbnails und liest Dauer/creation_time', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.uploadAndProcess(admin, family, makeMp4(2), { name: 'clip.mp4', mimeType: 'video/mp4' });

    expect(media.status, media.processingError ?? '').toBe('READY');
    expect(media.type).toBe('VIDEO');
    expect(media.width).toBe(320);
    expect(media.height).toBe(240);
    expect(media.durationSec).toBeGreaterThan(1.5);
    expect(media.takenAt.toISOString()).toBe('2024-03-04T05:06:07.000Z');
    expect(existsSync(`${ctx.mediaRoot}/${family.id}/${media.id}/preview.mp4`)).toBe(true);
    const t = await sharp(`${ctx.mediaRoot}/${family.id}/${media.id}/thumb_400.webp`).metadata();
    expect(t.width).toBe(320);
  }, 60_000);
});

describe('GET /families/:id/timeline', () => {
  it('gruppiert nach Monat, neueste zuerst, und paginiert per Cursor', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const dates = ['2024-05-10', '2024-05-02', '2024-04-20', '2024-01-01', '2023-12-31'];
    for (const [i, d] of dates.entries()) {
      await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 100 + i, height: 80 }), { takenAt: `${d}T12:00:00.000Z` });
    }
    const c = await ctx.as(admin);

    const p1 = await c.get(`/families/${family.id}/timeline?limit=3`);
    expect(p1.statusCode, p1.body).toBe(200);
    expect(p1.json().groups.map((g: { month: string; items: unknown[] }) => [g.month, g.items.length])).toEqual([
      ['2024-05', 2],
      ['2024-04', 1],
    ]);
    expect(p1.json().nextCursor).toBeTruthy();

    const p2 = await c.get(`/families/${family.id}/timeline?limit=3&cursor=${encodeURIComponent(p1.json().nextCursor)}`);
    expect(p2.json().groups.map((g: { month: string; items: unknown[] }) => [g.month, g.items.length])).toEqual([
      ['2024-01', 1],
      ['2023-12', 1],
    ]);
    expect(p2.json().nextCursor).toBeNull();

    const may = await c.get(`/families/${family.id}/timeline?month=2024-05`);
    expect(may.json().groups).toHaveLength(1);
    expect(may.json().groups[0].items).toHaveLength(2);

    const months = await c.get(`/families/${family.id}/timeline/months`);
    expect(months.json()).toEqual([
      { month: '2024-05', count: 2 },
      { month: '2024-04', count: 1 },
      { month: '2024-01', count: 1 },
      { month: '2023-12', count: 1 },
    ]);

    expectProblem(await c.get(`/families/${family.id}/timeline?cursor=kaputt`), 400, 'INVALID_CURSOR');
  });

  it('liefert signierte URLs passend zu den Rechten und blendet Gelöschtes aus', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const viewer = await ctx.createUser();
    await ctx.addMember(family, viewer, { canComment: true });
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
    const deleted = await ctx.uploadAndProcess(admin, family, await makeJpeg({ color: '#00ff00' }));
    await (await ctx.as(admin)).delete(`/media/${deleted.id}`);

    const asAdmin = (await (await ctx.as(admin)).get(`/families/${family.id}/timeline`)).json();
    const asViewer = (await (await ctx.as(viewer)).get(`/families/${family.id}/timeline`)).json();

    expect(asAdmin.groups[0].items).toHaveLength(1);
    const a = asAdmin.groups[0].items[0];
    expect(a.id).toBe(media.id);
    expect(a.canEdit).toBe(true);
    expect(a.urls.thumb400).toMatch(new RegExp(`^/api/v1/media/${media.id}/thumb/400\\?exp=\\d+&sig=`));
    expect(a.urls.original).toMatch(/\/original\?exp=/);
    expect(a.urls.preview).toBeNull();

    const v = asViewer.groups[0].items[0];
    expect(v.canEdit).toBe(false);
    expect(v.urls.thumb400).toBeTruthy();
    expect(v.urls.original).toBeNull();
  });

  it('zeigt PROCESSING allen, FAILED nur dem Uploader', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const viewer = await ctx.createUser();
    await ctx.addMember(family, viewer);
    const processing = await ctx.upload(admin, family, await makeJpeg());
    const failed = await ctx.uploadAndProcess(admin, family, Buffer.from('kaputt'.repeat(100)), { name: 'x.jpg' });
    expect(failed.status).toBe('FAILED');

    const ids = (r: { groups: Array<{ items: Array<{ id: string }> }> }) => r.groups.flatMap((g) => g.items.map((i) => i.id)).sort();
    expect(ids((await (await ctx.as(admin)).get(`/families/${family.id}/timeline`)).json())).toEqual([processing.id, failed.id].sort());
    expect(ids((await (await ctx.as(viewer)).get(`/families/${family.id}/timeline`)).json())).toEqual([processing.id]);

    const dto = (await (await ctx.as(viewer)).get(`/media/${processing.id}`)).json();
    expect(dto.status).toBe('PROCESSING');
    expect(dto.urls.thumb400).toBeNull();
  });

  it('ist nur für Mitglieder', async () => {
    const { family } = await ctx.createFamilyWithAdmin();
    const outsider = await ctx.createUser();
    expectProblem(await (await ctx.as(outsider)).get(`/families/${family.id}/timeline`), 403, 'NOT_A_MEMBER');
  });
});

describe('Datei-Routen', () => {
  it('liefert Thumbnails per Bearer-Token für Mitglieder, sonst 403', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const outsider = await ctx.createUser();
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());

    const ok = await (await ctx.as(admin)).get(`/media/${media.id}/thumb/400`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/webp');
    expect(ok.headers['cache-control']).toMatch(/private/);
    expect((await sharp(ok.rawPayload).metadata()).width).toBe(400);

    expectProblem(await (await ctx.as(outsider)).get(`/media/${media.id}/thumb/400`), 403, 'NOT_A_MEMBER');
    expectProblem(await (await ctx.as(null)).get(`/media/${media.id}/thumb/400`), 401);
    expectProblem(await (await ctx.as(admin)).get(`/media/${media.id}/thumb/999`), 400, 'VALIDATION_ERROR');
  });

  it('akzeptiert signierte URLs ohne Token und lehnt manipulierte/abgelaufene ab', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
    const dto = (await (await ctx.as(admin)).get(`/media/${media.id}`)).json();

    const signed = await ctx.app.inject({ method: 'GET', url: dto.urls.thumb1600 });
    expect(signed.statusCode, signed.body).toBe(200);
    expect(signed.headers['content-type']).toBe('image/webp');

    const tampered = await ctx.app.inject({ method: 'GET', url: dto.urls.thumb1600.replace('sig=', 'sig=x') });
    expectProblem(tampered, 401, 'SIGNATURE_INVALID');

    // Signatur eines anderen Pfads (400er) darf nicht fürs Original gelten
    const url400 = new URL(dto.urls.thumb400, 'http://x');
    const cross = await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${media.id}/original?${url400.searchParams}` });
    expectProblem(cross, 401, 'SIGNATURE_INVALID');

    const expired = dto.urls.thumb1600.replace(/exp=\d+/, 'exp=1000');
    expectProblem(await ctx.app.inject({ method: 'GET', url: expired }), 401, 'SIGNATURE_INVALID');
  });

  it('Original nur mit canDownload, mit Content-Disposition und Range-Support', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const viewer = await ctx.createUser();
    await ctx.addMember(family, viewer);
    const buf = await makeJpeg();
    const media = await ctx.uploadAndProcess(admin, family, buf, { name: 'Sommer Ferien.jpg' });

    expectProblem(await (await ctx.as(viewer)).get(`/media/${media.id}/original`), 403, 'PERMISSION_CANDOWNLOAD');

    const full = await (await ctx.as(admin)).get(`/media/${media.id}/original`);
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/jpeg');
    expect(full.headers['content-disposition']).toMatch(/attachment; filename="Sommer Ferien.jpg"/);
    expect(Buffer.compare(full.rawPayload, buf)).toBe(0);

    const range = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/media/${media.id}/original`,
      headers: { ...(await ctx.authHeaders(admin)), range: 'bytes=10-19' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.headers['content-range']).toBe(`bytes 10-19/${buf.length}`);
    expect(range.rawPayload.length).toBe(10);
    expect(Buffer.compare(range.rawPayload, buf.subarray(10, 20))).toBe(0);

    const bad = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/media/${media.id}/original`,
      headers: { ...(await ctx.authHeaders(admin)), range: 'bytes=99999999-' },
    });
    expect(bad.statusCode).toBe(416);
  });

  it('antwortet 404 solange nicht READY', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.upload(admin, family, await makeJpeg());
    expectProblem(await (await ctx.as(admin)).get(`/media/${media.id}/thumb/400`), 404, 'MEDIA_NOT_READY');
  });
});

describe('PATCH/DELETE /media/:id', () => {
  it('Uploader und Familien-Admin dürfen ändern/löschen, andere Mitglieder nicht', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const uploader = await ctx.createUser();
    const other = await ctx.createUser();
    await ctx.addMember(family, uploader, { canUpload: true });
    await ctx.addMember(family, other, { canUpload: true });
    const media = await ctx.uploadAndProcess(uploader, family, await makeJpeg());

    expectProblem(await (await ctx.as(other)).patch(`/media/${media.id}`, { caption: 'nö' }), 403, 'NOT_OWNER');
    expectProblem(await (await ctx.as(other)).delete(`/media/${media.id}`), 403, 'NOT_OWNER');

    const byUploader = await (await ctx.as(uploader)).patch(`/media/${media.id}`, { caption: '  Am See  ' });
    expect(byUploader.statusCode).toBe(200);
    expect(byUploader.json().caption).toBe('Am See');

    const cleared = await (await ctx.as(admin)).patch(`/media/${media.id}`, { caption: null });
    expect(cleared.json().caption).toBeNull();

    expect((await (await ctx.as(admin)).delete(`/media/${media.id}`)).statusCode).toBe(204);
    expectProblem(await (await ctx.as(admin)).get(`/media/${media.id}`), 404, 'MEDIA_NOT_FOUND');
    expect(existsSync(`${ctx.mediaRoot}/${family.id}/${media.id}`)).toBe(false);
    const row = await ctx.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it('Nicht-Mitglied → 403, unbekannt → 404', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const outsider = await ctx.createUser();
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
    expectProblem(await (await ctx.as(outsider)).get(`/media/${media.id}`), 403, 'NOT_A_MEMBER');
    expectProblem(await (await ctx.as(admin)).get('/media/00000000-0000-4000-8000-000000000000'), 404, 'MEDIA_NOT_FOUND');
  });
});
