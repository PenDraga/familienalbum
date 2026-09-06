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
  // Globaler Admin als gewöhnliches Mitglied (kein Familien-Admin) – darf trotzdem moderieren (ADR-0003)
  const globalAdmin = await ctx.createUser({ displayName: 'Global', isAdmin: true });
  await ctx.addMember(family, globalAdmin, { canComment: true });
  const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
  return { family, admin, commenter, viewer, globalAdmin, media };
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
  it('liefert chronologisch mit canEdit/canDelete je nach Rolle', async () => {
    const { commenter, admin, viewer, globalAdmin, media } = await setup();
    await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'erster' });
    await (await ctx.as(admin)).post(`/media/${media.id}/comments`, { body: 'zweiter' });

    const asViewer = (await (await ctx.as(viewer)).get(`/media/${media.id}/comments`)).json();
    expect(asViewer.map((c: { body: string }) => c.body)).toEqual(['erster', 'zweiter']);
    expect(asViewer.map((c: { canDelete: boolean }) => c.canDelete)).toEqual([false, false]);

    const asCommenter = (await (await ctx.as(commenter)).get(`/media/${media.id}/comments`)).json();
    expect(asCommenter.map((c: { canDelete: boolean }) => c.canDelete)).toEqual([true, false]);

    const asAdmin = (await (await ctx.as(admin)).get(`/media/${media.id}/comments`)).json();
    expect(asAdmin.map((c: { canDelete: boolean }) => c.canDelete)).toEqual([true, true]);
    expect(asAdmin.map((c: { canEdit: boolean }) => c.canEdit)).toEqual([true, true]);

    const asGlobal = (await (await ctx.as(globalAdmin)).get(`/media/${media.id}/comments`)).json();
    expect(asGlobal.map((c: { canDelete: boolean; canEdit: boolean }) => [c.canEdit, c.canDelete])).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(asViewer.every((c: { editedAt: string | null }) => c.editedAt === null)).toBe(true);
  });
});

describe('PATCH /comments/:id', () => {
  it('Autor, Familien-Admin und globaler Admin dürfen bearbeiten, andere nicht; editedAt wird gesetzt', async () => {
    const { commenter, admin, viewer, globalAdmin, media } = await setup();
    const c = (await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'Tippfehlr' })).json();

    expectProblem(await (await ctx.as(viewer)).patch(`/comments/${c.id}`, { body: 'x' }), 403, 'NOT_COMMENT_OWNER');

    const byAuthor = await (await ctx.as(commenter)).patch(`/comments/${c.id}`, { body: '  Tippfehler  ' });
    expect(byAuthor.statusCode).toBe(200);
    expect(byAuthor.json().body).toBe('Tippfehler');
    expect(byAuthor.json().editedAt).not.toBeNull();

    const byAdmin = await (await ctx.as(admin)).patch(`/comments/${c.id}`, { body: 'vom Familien-Admin' });
    expect(byAdmin.statusCode).toBe(200);
    expect(byAdmin.json().body).toBe('vom Familien-Admin');

    const byGlobal = await (await ctx.as(globalAdmin)).patch(`/comments/${c.id}`, { body: 'vom globalen Admin' });
    expect(byGlobal.statusCode).toBe(200);
    expect(byGlobal.json().author.displayName).toBe('Oma'); // Autor bleibt

    expectProblem(await (await ctx.as(commenter)).patch(`/comments/${c.id}`, { body: '   ' }), 400);
    expectProblem(await (await ctx.as(commenter)).patch(`/comments/00000000-0000-0000-0000-000000000000`, { body: 'x' }), 404);
  });
});

describe('DELETE /comments/:id', () => {
  it('Autor, Familien-Admin und globaler Admin dürfen löschen, andere nicht', async () => {
    const { commenter, admin, viewer, globalAdmin, media } = await setup();
    const c1 = (await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'a' })).json();
    const c2 = (await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'b' })).json();
    const c3 = (await (await ctx.as(commenter)).post(`/media/${media.id}/comments`, { body: 'c' })).json();

    expectProblem(await (await ctx.as(viewer)).delete(`/comments/${c1.id}`), 403, 'NOT_COMMENT_OWNER');
    expect((await (await ctx.as(commenter)).delete(`/comments/${c1.id}`)).statusCode).toBe(204);
    expect((await (await ctx.as(admin)).delete(`/comments/${c2.id}`)).statusCode).toBe(204);
    expect((await (await ctx.as(globalAdmin)).delete(`/comments/${c3.id}`)).statusCode).toBe(204);
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
