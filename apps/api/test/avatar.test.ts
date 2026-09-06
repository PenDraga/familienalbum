import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('Profilbild', () => {
  it('setzt, liefert und entfernt das Profilbild; DTOs tragen den signierten Link', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const oma = await ctx.createUser({ displayName: 'Oma' });
    await ctx.addMember(family, oma, { canComment: true });

    const before = (await (await ctx.as(admin)).get('/me')).json();
    expect(before.avatarUrl).toBeNull();

    const upload = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/me/avatar',
      headers: { ...(await ctx.authHeaders(admin)), 'content-type': 'image/jpeg' },
      payload: await makeJpeg({ width: 900, height: 600 }),
    });
    expect(upload.statusCode).toBe(200);
    const { avatarUrl } = upload.json() as { avatarUrl: string };
    expect(avatarUrl).toMatch(/^\/api\/v1\/users\/[^/]+\/avatar\?exp=\d+&sig=.+&v=\d+$/);

    // signierter Link ohne Token, quadratisches WebP
    const img = await ctx.app.inject({ method: 'GET', url: avatarUrl });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    const meta = await sharp(img.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);

    // Bearer eines anderen Mitglieds geht ebenfalls, anonym ohne Signatur nicht
    const path = avatarUrl.split('?')[0]!.replace('/api/v1', '');
    expect((await (await ctx.as(oma)).get(path)).statusCode).toBe(200);
    expectProblem(await (await ctx.as(null)).get(path), 401);

    // Link in Me und in Kommentar-Autoren
    const me = (await (await ctx.as(admin)).get('/me')).json();
    expect(me.avatarUrl).toContain('/avatar?');
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
    const comment = (await (await ctx.as(admin)).post(`/media/${media.id}/comments`, { body: 'hi' })).json();
    expect(comment.author.avatarUrl).toContain(`/users/${admin.id}/avatar?`);
    const members = (await (await ctx.as(oma)).get(`/families/${family.id}/members`)).json() as Array<{ user: { id: string; avatarUrl: string | null } }>;
    expect(members.find((m) => m.user.id === admin.id)!.user.avatarUrl).toContain('/avatar?');
    expect(members.find((m) => m.user.id === oma.id)!.user.avatarUrl).toBeNull();

    // entfernen
    expect((await (await ctx.as(admin)).delete('/me/avatar')).json()).toEqual({ avatarUrl: null });
    expectProblem(await (await ctx.as(oma)).get(path), 404, 'AVATAR_MISSING');
  });

  it('lehnt Nicht-Bilder ab', async () => {
    const { admin } = await ctx.createFamilyWithAdmin();
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/me/avatar',
      headers: { ...(await ctx.authHeaders(admin)), 'content-type': 'application/octet-stream' },
      payload: Buffer.from('kein bild'),
    });
    expectProblem(res, 400, 'AVATAR_UNREADABLE');
  });
});
