import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from './helpers/app.js';
import { hasFfmpeg, makeJpeg, makeMp4 } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('GET /families/:id/timeline – Filter', () => {
  it('type=PHOTO|VIDEO und commented=true grenzen die Timeline ein', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const a = await ctx.uploadAndProcess(admin, family, await makeJpeg(), { takenAt: '2026-08-01T10:00:00.000Z' });
    const b = await ctx.uploadAndProcess(admin, family, await makeJpeg({ width: 50, height: 40 }), { takenAt: '2026-08-02T10:00:00.000Z' });
    await (await ctx.as(admin)).post(`/media/${b.id}/comments`, { body: 'schön' });
    const video = hasFfmpeg() ? await ctx.uploadAndProcess(admin, family, makeMp4(), { name: 'clip.mp4', mimeType: 'video/mp4', takenAt: '2026-08-03T10:00:00.000Z' }) : null;

    const ids = async (query: string) => {
      const res = await (await ctx.as(admin)).get(`/families/${family.id}/timeline${query}`);
      expect(res.statusCode).toBe(200);
      return (res.json().groups as Array<{ items: Array<{ id: string }> }>).flatMap((g) => g.items.map((i) => i.id));
    };

    expect(await ids('?type=PHOTO')).toEqual([b.id, a.id]);
    expect(await ids('?commented=true')).toEqual([b.id]);
    expect(await ids('?type=PHOTO&commented=true')).toEqual([b.id]);
    if (video) {
      expect(await ids('?type=VIDEO')).toEqual([video.id]);
      // Reihenfolge des Videos hängt vom Aufnahmedatum aus den Dateimetadaten ab – nur die Menge prüfen
      expect((await ids('')).sort()).toEqual([video.id, b.id, a.id].sort());
    }
    expect((await (await ctx.as(admin)).get(`/families/${family.id}/timeline?type=AUDIO`)).statusCode).toBe(400);
  });
});
