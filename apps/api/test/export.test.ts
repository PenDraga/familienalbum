import AdmZip from 'adm-zip';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg, makePng } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

async function setup() {
  const { family, admin } = await ctx.createFamilyWithAdmin();
  const oma = await ctx.createUser({ displayName: 'Oma' });
  await ctx.addMember(family, oma, { canComment: true, canDownload: false });
  const a = await ctx.uploadAndProcess(admin, family, await makeJpeg(), { name: 'Strand.jpg', takenAt: '2026-08-15T10:00:00.000Z' });
  const b = await ctx.uploadAndProcess(admin, family, await makePng(), { name: 'Kuchen.png', takenAt: '2026-09-03T19:50:12.000Z' });
  const comment = (await (await ctx.as(oma)).post(`/media/${b.id}/comments`, { body: 'Mmh ♥️' })).json();
  return { family, admin, oma, a, b, comment };
}

describe('Export', () => {
  it('liefert ein ZIP mit Originalen nach Jahr/Monat, index.json und Kommentaren', async () => {
    const { family, admin, a, b, comment } = await setup();
    const res = await (await ctx.as(admin)).get(`/families/${family.id}/export/alle`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('.zip');

    const zip = new AdmZip(res.rawPayload);
    const names = zip.getEntries().map((e) => e.entryName).sort();
    expect(names).toEqual(['2026/08/2026-08-15_100000_Strand.jpg', '2026/09/2026-09-03_195012_Kuchen.png', 'LIESMICH.txt', 'index.json', 'kommentare.md']);

    const index = JSON.parse(zip.readAsText('index.json')) as { count: number; media: Array<Record<string, unknown>> };
    expect(index.count).toBe(2);
    expect(index.media.map((m) => m.id)).toEqual([a.id, b.id]);
    const kuchen = index.media[1]!;
    expect(kuchen).toMatchObject({ file: '2026/09/2026-09-03_195012_Kuchen.png', originalName: 'Kuchen.png', uploader: { displayName: expect.any(String) } });
    expect(kuchen.comments).toEqual([expect.objectContaining({ id: comment.id, body: 'Mmh ♥️', author: expect.objectContaining({ displayName: 'Oma' }) })]);

    expect(zip.readAsText('kommentare.md')).toContain('**Oma**');
    // Originale unverändert
    const original = zip.readFile('2026/08/2026-08-15_100000_Strand.jpg')!;
    expect(original.length).toBe(a.sizeBytes);
  });

  it('exportiert nur den gewünschten Monat und lehnt kaputte Zeiträume ab', async () => {
    const { family, admin } = await setup();
    const res = await (await ctx.as(admin)).get(`/families/${family.id}/export/2026-09`);
    expect(res.statusCode).toBe(200);
    const names = new AdmZip(res.rawPayload).getEntries().map((e) => e.entryName);
    expect(names.filter((n) => n.endsWith('.jpg') || n.endsWith('.png'))).toEqual(['2026/09/2026-09-03_195012_Kuchen.png']);

    expectProblem(await (await ctx.as(admin)).get(`/families/${family.id}/export/2026-13`), 400);
    expectProblem(await (await ctx.as(admin)).get(`/families/${family.id}/export/gestern`), 400);
  });

  it('verlangt canDownload; signierter Link funktioniert ohne Token und läuft ab', async () => {
    const { family, admin, oma } = await setup();
    expectProblem(await (await ctx.as(oma)).get(`/families/${family.id}/export/alle`), 403);
    expectProblem(await (await ctx.as(oma)).get(`/families/${family.id}/export-link/alle`), 403);
    expectProblem(await (await ctx.as(null)).get(`/families/${family.id}/export/alle`), 401);

    const link = (await (await ctx.as(admin)).get(`/families/${family.id}/export-link/2026-09`)).json() as { url: string; scope: string };
    expect(link.scope).toBe('2026-09');
    expect(link.url).toMatch(/^\/api\/v1\/families\/.+\/export\/2026-09\?exp=\d+&sig=/);

    const anonymous = await ctx.app.inject({ method: 'GET', url: link.url });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.headers['content-type']).toBe('application/zip');

    const tampered = await ctx.app.inject({ method: 'GET', url: link.url.replace('2026-09', 'alle') });
    expectProblem(tampered, 401, 'SIGNATURE_INVALID');
  });

  it('Doppelte Dateinamen im selben Moment werden durchnummeriert, gelöschte Medien fehlen', async () => {
    const { family, admin, a } = await setup();
    await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 32, height: 32 }), { name: 'Strand.jpg', takenAt: '2026-08-15T10:00:00.000Z' });
    await (await ctx.as(admin)).delete(`/media/${a.id}`);
    const res = await (await ctx.as(admin)).get(`/families/${family.id}/export/2026-08`);
    const names = new AdmZip(res.rawPayload).getEntries().map((e) => e.entryName);
    expect(names.filter((n) => n.endsWith('.jpg'))).toEqual(['2026/08/2026-08-15_100000_Strand.jpg']);
  });
});
