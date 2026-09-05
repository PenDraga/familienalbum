import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

async function setup() {
  const { family, admin } = await ctx.createFamilyWithAdmin();
  const commenter = await ctx.createUser({ displayName: 'Oma' });
  await ctx.addMember(family, commenter, { canComment: true });
  const viewer = await ctx.createUser({ displayName: 'Nur-Gucker' });
  await ctx.addMember(family, viewer, { canComment: false });
  const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
  return { family, admin, commenter, viewer, media };
}

describe('POST /media/:id/comments', () => {
  it('legt Kommentare an, trimmt und zählt sie im Media-DTO', async () => {
    const { commenter, media, admin } = await setup();
    const res = await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: '  Wie schön!  ' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ mediaId: media.id, body: 'Wie schön!', author: { displayName: 'Oma' }, canDelete: true });

    expect((await (await ctx.as(admin)).get(`/media/${media.id}`)).json().commentCount).toBe(1);
  });

  it('verlangt canComment; Nicht-Mitglieder bekommen 403, unbekannte Medien 404', async () => {
    const { viewer, media } = await setup();
    const outsider = await ctx.createUser();
    expectProblem(await (await ctx.as(viewer)).post(`/media/${media.id}/comments`, { body: 'x' }), 403, 'PERMISSION_CANCOMMENT');
    expectProblem(await (await ctx.as(outsider)).post(`/media/${media.id}/comments`, { body: 'x' }), 403, 'NOT_A_MEMBER');
    expectProblem(await (await ctx.as(viewer)).post('/media/00000000-0000-4000-8000-000000000000/comments', { body: 'x' }), 404, 'MEDIA_NOT_FOUND');
  });

  it('lehnt leere Kommentare und unfertige Medien ab', async () => {
    const { commenter, media, admin, family } = await setup();
    expectProblem(await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: '   ' }), 400, 'VALIDATION_ERROR');
    const processing = await ctx.upload(admin, family, await makeJpeg({ color: '#ff0000' }));
    expectProblem(await (await ctx.as(commenter)).post(`/media/${processing.id}/comments`, { body: 'zu früh' }), 409, 'MEDIA_NOT_READY');
  });
});

describe('GET /media/:id/comments', () => {
  it('liefert chronologisch mit canDelete je nach Rolle', async () => {
    const { commenter, admin, viewer, media } = await setup();
    await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'erster' });
    await (await ctx.as(admin)).post(`/media/${media.id}/comments`, { body: 'zweiter' });

    const asViewer = (await (await ctx.as(viewer)).get(`/media/${media.id}/comments`)).json();
    expect(asViewer.map((c: { body: string }) => c.body)).toEqual(['erster', 'zweiter']);
    expect(asViewer.map((c: { canDelete: boolean }) => c.canDelete)).toEqual([false, false]);

    const asCommenter = (await (await ctx.as(commenter)).get(`/media/${media.id}/comments`)).json();
    expect(asCommenter.map((c: { canDelete: boolean }) => c.canDelete)).toEqual([true, false]);

    const asAdmin = (await (await ctx.as(admin)).get(`/media/${media.id}/comments`)).json();
    expect(asAdmin.map((c: { canDelete: boolean }) => c.canDelete)).toEqual([true, true]);
  });
});

describe('DELETE /comments/:id', () => {
  it('Autor und Familien-Admin dürfen löschen, andere nicht', async () => {
    const { commenter, admin, viewer, media } = await setup();
    const c1 = (await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'a' })).json();
    const c2 = (await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'b' })).json();

    expectProblem(await (await ctx.as(viewer)).delete(`/comments/${c1.id}`), 403, 'NOT_COMMENT_OWNER');
    expect((await (await ctx.as(commenter)).delete(`/comments/${c1.id}`)).statusCode).toBe(204);
    expect((await (await ctx.as(admin)).delete(`/comments/${c2.id}`)).statusCode).toBe(204);
    expectProblem(await (await ctx.as(admin)).delete(`/comments/${c2.id}`), 404, 'COMMENT_NOT_FOUND');
    expect(await ctx.prisma.comment.count()).toBe(0);
  });

  it('Nicht-Mitglieder der Familie kommen nicht an fremde Kommentare', async () => {
    const { commenter, media } = await setup();
    const c = (await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'a' })).json();
    const outsider = await ctx.createUser();
    expectProblem(await (await ctx.as(outsider)).delete(`/comments/${c.id}`), 403, 'NOT_A_MEMBER');
  });

  it('Kommentare verschwinden mit dem Medium (Cascade beim Hard-Delete), Soft-Delete blendet sie aus', async () => {
    const { commenter, admin, media } = await setup();
    const c = (await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'a' })).json();
    await (await ctx.as(admin)).delete(`/media/${media.id}`);
    expectProblem(await (await ctx.as(commenter)).get(`/media/${media.id}/comments`), 404, 'MEDIA_NOT_FOUND');
    expectProblem(await (await ctx.as(commenter)).delete(`/comments/${c.id}`), 404, 'COMMENT_NOT_FOUND');
  });
});
