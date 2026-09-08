import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg, makePng } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('GET /families/:id/storage', () => {
  it('summiert Originale pro Typ, ohne gelöschte Medien; Admins sehen den freien Platz', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const a = await ctx.uploadAndProcess(admin, family, await makeJpeg(), { name: 'a.jpg' });
    const b = await ctx.uploadAndProcess(admin, family, await makePng(), { name: 'b.png', mimeType: 'image/png' });
    const gone = await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 32, height: 32 }), { name: 'c.jpg' });
    await (await ctx.as(admin)).delete(`/media/${gone.id}`);

    const res = await (await ctx.as(admin)).get(`/families/${family.id}/storage`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ photoBytes: a.sizeBytes + b.sizeBytes, videoBytes: 0, photoCount: 2, videoCount: 0, totalBytes: a.sizeBytes + b.sizeBytes });
    expect(body.disk).toEqual({ totalBytes: expect.any(Number), freeBytes: expect.any(Number) });
    expect(body.disk.totalBytes).toBeGreaterThan(body.disk.freeBytes);
  });

  it('Mitglieder sehen den Verbrauch, aber keinen freien Platz; Fremde nicht', async () => {
    const { family } = await ctx.createFamilyWithAdmin();
    const oma = await ctx.createUser();
    await ctx.addMember(family, oma, { canComment: true });
    const res = await (await ctx.as(oma)).get(`/families/${family.id}/storage`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ totalBytes: 0, photoBytes: 0, videoBytes: 0, photoCount: 0, videoCount: 0, disk: null });

    const stranger = await ctx.createUser();
    expectProblem(await (await ctx.as(stranger)).get(`/families/${family.id}/storage`), 403);
    expectProblem(await (await ctx.as(null)).get(`/families/${family.id}/storage`), 401);
  });

  it('GET /admin/families liefert Fotos/Videos und Bytes pro Album', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const globalAdmin = await ctx.createAdmin();
    const empty = await ctx.createFamily('Leer');
    const a = await ctx.uploadAndProcess(admin, family, await makeJpeg(), { name: 'a.jpg' });
    const res = await (await ctx.as(globalAdmin)).get('/admin/families');
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<Record<string, unknown>>;
    expect(list.find((f) => f.id === family.id)).toMatchObject({ photoCount: 1, videoCount: 0, totalBytes: a.sizeBytes, mediaCount: 1 });
    expect(list.find((f) => f.id === empty.id)).toMatchObject({ photoCount: 0, videoCount: 0, totalBytes: 0, mediaCount: 0 });
  });
});
