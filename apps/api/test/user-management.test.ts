import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD, TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('POST /families/:id/members – Konto durch Familien-Admin anlegen', () => {
  it('legt Konto und Mitgliedschaft an; die Person kann sich anmelden', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const res = await (await ctx.as(admin)).post(`/families/${family.id}/members`, {
      email: 'Oma@Test.local',
      password: 'Passw0rd!oma',
      displayName: ' Oma ',
      canDownload: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      familyId: family.id,
      user: { displayName: 'Oma' },
      isFamilyAdmin: false,
      canUpload: true,
      canDownload: true,
      canComment: true,
    });
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'oma@test.local' } });
    expect(user.isAdmin).toBe(false);
    expect((await ctx.login('oma@test.local', 'Passw0rd!oma')).statusCode).toBe(200);
    expect((await (await ctx.as(user)).get(`/families/${family.id}`)).statusCode).toBe(200);
  });

  it('bestehende Konten dürfen nicht ungefragt hinzugefügt werden (409, keine Mitgliedschaft)', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const stranger = await ctx.createUser({ email: 'da@test.local' });
    expectProblem(
      await (await ctx.as(admin)).post(`/families/${family.id}/members`, { email: 'da@test.local', password: 'Passw0rd!x', displayName: 'X' }),
      409,
      'EMAIL_TAKEN',
    );
    expect(await ctx.prisma.familyMember.count({ where: { userId: stranger.id } })).toBe(0);
  });

  it('nur Familien-Admins; validiert Passwortlänge', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser();
    await ctx.addMember(family, member, { canUpload: true });
    expectProblem(
      await (await ctx.as(member)).post(`/families/${family.id}/members`, { email: 'n@test.local', password: 'Passw0rd!x', displayName: 'N' }),
      403,
      'PERMISSION_ISFAMILYADMIN',
    );
    expectProblem(
      await (await ctx.as(admin)).post(`/families/${family.id}/members`, { email: 'n@test.local', password: 'kurz', displayName: 'N' }),
      400,
      'VALIDATION_ERROR',
    );
    expect(await ctx.prisma.user.count({ where: { email: 'n@test.local' } })).toBe(0);
  });
});

describe('PATCH /me', () => {
  it('ändert den Anzeigenamen', async () => {
    const user = await ctx.createUser();
    const res = await (await ctx.as(user)).patch('/me', { displayName: ' Neuer Name ' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().displayName).toBe('Neuer Name');
  });

  it('wechselt das Passwort nur mit korrektem aktuellem Passwort und beendet andere Sitzungen', async () => {
    const user = await ctx.createUser({ email: 'pw@test.local' });
    const other = (await ctx.login('pw@test.local')).json().tokens;

    expectProblem(await (await ctx.as(user)).patch('/me', { newPassword: 'NeuesPasswort1' }), 400, 'VALIDATION_ERROR');
    expectProblem(
      await (await ctx.as(user)).patch('/me', { currentPassword: 'falsch-falsch', newPassword: 'NeuesPasswort1' }),
      403,
      'WRONG_PASSWORD',
    );
    expect((await (await ctx.as(user)).patch('/me', { currentPassword: DEFAULT_PASSWORD, newPassword: 'NeuesPasswort1' })).statusCode).toBe(200);

    expect((await ctx.login('pw@test.local')).statusCode).toBe(401);
    expect((await ctx.login('pw@test.local', 'NeuesPasswort1')).statusCode).toBe(200);
    expectProblem(
      await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: other.refreshToken } }),
      401,
    );
  });
});

describe('Admin: Benutzer-Detail und Familienliste', () => {
  it('GET /admin/users/:id liefert Familien mit Rechten und Gerätezahl', async () => {
    const admin = await ctx.createAdmin();
    const { family, admin: familyAdmin } = await ctx.createFamilyWithAdmin('Muster');
    await (await ctx.as(familyAdmin)).post('/devices', { fcmToken: 'x'.repeat(40), platform: 'android' });

    const res = await (await ctx.as(admin)).get(`/admin/users/${familyAdmin.id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      id: familyAdmin.id,
      deviceCount: 1,
      families: [{ id: family.id, name: 'Muster', membership: { isFamilyAdmin: true, canUpload: true } }],
    });
    expectProblem(await (await ctx.as(admin)).get('/admin/users/00000000-0000-4000-8000-000000000000'), 404, 'USER_NOT_FOUND');
    expectProblem(await (await ctx.as(familyAdmin)).get(`/admin/users/${familyAdmin.id}`), 403, 'ADMIN_REQUIRED');
  });

  it('GET /admin/families zählt Mitglieder und (nicht gelöschte) Medien', async () => {
    const admin = await ctx.createAdmin();
    const { family, admin: familyAdmin } = await ctx.createFamilyWithAdmin('Zählfamilie');
    await ctx.addMember(family, await ctx.createUser());
    await ctx.prisma.media.create({
      data: {
        familyId: family.id,
        uploaderId: familyAdmin.id,
        type: 'PHOTO',
        status: 'READY',
        sha256: 'c'.repeat(64),
        originalName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        takenAt: new Date(),
      },
    });
    await ctx.createFamily('Leer');

    const res = await (await ctx.as(admin)).get('/admin/families');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().map((f: { name: string; memberCount: number; mediaCount: number }) => [f.name, f.memberCount, f.mediaCount])).toEqual([
      ['Leer', 0, 0],
      ['Zählfamilie', 2, 1],
    ]);
    expectProblem(await (await ctx.as(familyAdmin)).get('/admin/families'), 403, 'ADMIN_REQUIRED');
  });
});

describe('DELETE /admin/users/:id – Konto löschen', () => {
  it('anonymisiert das Konto, Fotos und Kommentare bleiben, Anmeldung geht nicht mehr', async () => {
    const admin = await ctx.createAdmin();
    const { family, admin: papa } = await ctx.createFamilyWithAdmin('Muster');
    const oma = await ctx.createUser({ displayName: 'Oma', email: 'oma@test.local', password: 'Geheim-1234' });
    await ctx.addMember(family, oma, { canUpload: true, canComment: true });
    const photo = await ctx.uploadAndProcess(oma, family, await makeJpeg(), { name: 'oma.jpg' });
    await (await ctx.as(oma)).post(`/media/${photo.id}/comments`, { body: 'Mein Foto' });
    await (await ctx.as(oma)).post('/devices', { fcmToken: 'y'.repeat(40), platform: 'ios' });

    const res = await (await ctx.as(admin)).delete(`/admin/users/${oma.id}`);
    expect(res.statusCode, res.body).toBe(204);

    // Foto und Kommentar bleiben, Urheber heisst «Gelöschtes Konto»
    const media = (await (await ctx.as(papa)).get(`/media/${photo.id}`)).json();
    expect(media.uploader.displayName).toBe('Gelöschtes Konto');
    const comments = (await (await ctx.as(papa)).get(`/media/${photo.id}/comments`)).json();
    const first = Array.isArray(comments) ? comments[0] : comments.items[0];
    expect(first.author.displayName).toBe('Gelöschtes Konto');

    // Mitgliedschaft, Geräte, Sitzungen weg; Anmeldung unmöglich; nicht mehr in der Liste
    expect((await (await ctx.as(papa)).get(`/families/${family.id}/members`)).json().map((m: { userId: string }) => m.userId)).not.toContain(oma.id);
    expect((await ctx.login('oma@test.local', 'Geheim-1234')).statusCode).toBe(401);
    expect(await ctx.prisma.device.count({ where: { userId: oma.id } })).toBe(0);
    expect(await ctx.prisma.refreshToken.count({ where: { userId: oma.id } })).toBe(0);
    const list = (await (await ctx.as(admin)).get('/admin/users')).json();
    expect(list.items.map((u: { id: string }) => u.id)).not.toContain(oma.id);
    expectProblem(await (await ctx.as(admin)).get(`/admin/users/${oma.id}`), 404, 'USER_NOT_FOUND');
    expectProblem(await (await ctx.as(admin)).delete(`/admin/users/${oma.id}`), 404, 'USER_NOT_FOUND');
  });

  it('nicht sich selbst, nur globale Admins; ein anderer Admin darf gelöscht werden', async () => {
    const admin = await ctx.createAdmin();
    const { admin: familyAdmin } = await ctx.createFamilyWithAdmin();
    expectProblem(await (await ctx.as(admin)).delete(`/admin/users/${admin.id}`), 409, 'SELF_DELETE');
    expectProblem(await (await ctx.as(familyAdmin)).delete(`/admin/users/${admin.id}`), 403, 'ADMIN_REQUIRED');
    expectProblem(await (await ctx.as(admin)).delete('/admin/users/00000000-0000-4000-8000-000000000000'), 404, 'USER_NOT_FOUND');

    const second = await ctx.createAdmin();
    expect((await (await ctx.as(second)).delete(`/admin/users/${admin.id}`)).statusCode).toBe(204);
    const gone = await ctx.prisma.user.findUnique({ where: { id: admin.id } });
    expect(gone).toMatchObject({ isAdmin: false, isDisabled: true, displayName: 'Gelöschtes Konto' });
    expect(gone!.deletedAt).not.toBeNull();
  });
});
