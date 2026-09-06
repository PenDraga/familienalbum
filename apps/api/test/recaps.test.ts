import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('Rückblicke', () => {
  it('legt einen Monats-Rückblick an, reiht den Job ein und listet ihn; ohne Medien 409', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const viewer = await ctx.createUser({ displayName: 'Gast' });
    await ctx.addMember(family, viewer, { canUpload: false });
    await ctx.uploadAndProcess(admin, family, await makeJpeg(), { takenAt: '2026-08-10T10:00:00.000Z' });

    expectProblem(await (await ctx.as(admin)).post(`/families/${family.id}/recaps`, { kind: 'MONTH', period: '2026-07' }), 409, 'RECAP_EMPTY');
    expectProblem(await (await ctx.as(admin)).post(`/families/${family.id}/recaps`, { kind: 'MONTH', period: 'August' }), 400);
    expectProblem(await (await ctx.as(viewer)).post(`/families/${family.id}/recaps`, { kind: 'MONTH', period: '2026-08' }), 403);

    const res = await (await ctx.as(admin)).post(`/families/${family.id}/recaps`, { kind: 'MONTH', period: '2026-08' });
    expect(res.statusCode).toBe(202);
    const recap = res.json();
    expect(recap).toMatchObject({ kind: 'MONTH', period: '2026-08', title: 'August 2026', status: 'PROCESSING', urls: { video: null, poster: null } });
    expect(ctx.queue.recaps).toEqual([recap.id]);

    // nochmals anlegen, solange er baut → derselbe Datensatz, kein zweiter Job
    const again = await (await ctx.as(admin)).post(`/families/${family.id}/recaps`, { kind: 'MONTH', period: '2026-08' });
    expect(again.json().id).toBe(recap.id);
    expect(ctx.queue.recaps).toHaveLength(1);

    const list = (await (await ctx.as(viewer)).get(`/families/${family.id}/recaps`)).json();
    expect(list.map((r: { id: string }) => r.id)).toEqual([recap.id]);

    // Video/Poster erst nach READY
    expectProblem(await (await ctx.as(viewer)).get(`/recaps/${recap.id}/video`), 404, 'RECAP_NOT_READY');

    // Löschen nur Familien-Admin
    expectProblem(await (await ctx.as(viewer)).delete(`/recaps/${recap.id}`), 403);
    expect((await (await ctx.as(admin)).delete(`/recaps/${recap.id}`)).statusCode).toBe(204);
    expect((await (await ctx.as(admin)).get(`/families/${family.id}/recaps`)).json()).toEqual([]);
  });

  it('«An diesem Tag» findet Medien vom selben Kalendertag in früheren Monaten und Jahren', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, now.getUTCDate(), 9));
    const lastYear = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate(), 15));
    const other = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate() === 1 ? 2 : 1, 15));
    // Monatsüberlauf (29.–31.) macht den Test schwankend – dann nur das Jahr prüfen
    const monthValid = lastMonth.getUTCDate() === now.getUTCDate();
    const a = await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 100, height: 80 }), { takenAt: lastMonth.toISOString() });
    const b = await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 120, height: 80 }), { takenAt: lastYear.toISOString() });
    await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 140, height: 80 }), { takenAt: other.toISOString() });

    const res = await (await ctx.as(admin)).get(`/families/${family.id}/on-this-day`);
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups as Array<{ label: string; monthsAgo: number; items: Array<{ id: string }> }>;
    if (monthValid) expect(groups.find((g) => g.monthsAgo === 1)?.items.map((i) => i.id)).toEqual([a.id]);
    const year = groups.find((g) => g.monthsAgo === 12)!;
    expect(year.label).toBe('Vor 1 Jahr');
    expect(year.items.map((i) => i.id)).toEqual([b.id]);
  });
});
