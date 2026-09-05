import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('Zugriff auf /admin/*', () => {
  it('ist für normale Benutzer und Familien-Admins gesperrt', async () => {
    const { admin: familyAdmin } = await ctx.createFamilyWithAdmin();
    const c = await ctx.as(familyAdmin);
    expectProblem(await c.get('/admin/users'), 403, 'ADMIN_REQUIRED');
    expectProblem(await c.get('/admin/stats'), 403, 'ADMIN_REQUIRED');
    expectProblem(await c.post('/admin/users', { email: 'x@test.local', password: 'Passw0rd!x', displayName: 'X' }), 403, 'ADMIN_REQUIRED');
    expectProblem(await (await ctx.as(null)).get('/admin/users'), 401);
  });
});

describe('POST /admin/users', () => {
  it('legt Benutzer an, der sich anmelden kann', async () => {
    const admin = await ctx.createAdmin();
    const res = await (await ctx.as(admin)).post('/admin/users', { email: 'Neu@Test.local', password: 'Passw0rd!neu', displayName: ' Neu ' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ email: 'neu@test.local', displayName: 'Neu', isAdmin: false, isDisabled: false });
    expect(res.json().passwordHash).toBeUndefined();
    expect((await ctx.login('neu@test.local', 'Passw0rd!neu')).statusCode).toBe(200);
  });

  it('kann weitere globale Admins anlegen', async () => {
    const admin = await ctx.createAdmin();
    const res = await (await ctx.as(admin)).post('/admin/users', { email: 'a2@test.local', password: 'Passw0rd!x', displayName: 'A2', isAdmin: true });
    expect(res.json().isAdmin).toBe(true);
  });

  it('doppelte E-Mail → 409', async () => {
    const admin = await ctx.createAdmin();
    await ctx.createUser({ email: 'dup@test.local' });
    expectProblem(
      await (await ctx.as(admin)).post('/admin/users', { email: 'DUP@test.local', password: 'Passw0rd!x', displayName: 'D' }),
      409,
      'EMAIL_TAKEN',
    );
  });
});

describe('GET /admin/users', () => {
  it('listet mit Suche und Paginierung', async () => {
    const admin = await ctx.createAdmin({ email: 'admin@test.local', displayName: 'Admin' });
    await ctx.createUser({ email: 'oma@test.local', displayName: 'Oma Erika' });
    await ctx.createUser({ email: 'opa@test.local', displayName: 'Opa Hans' });
    const c = await ctx.as(admin);

    const all = await c.get('/admin/users');
    expect(all.json().total).toBe(3);
    expect(all.json().items).toHaveLength(3);

    const search = await c.get('/admin/users?q=erika');
    expect(search.json().items.map((u: { email: string }) => u.email)).toEqual(['oma@test.local']);

    const page = await c.get('/admin/users?limit=1&offset=1');
    expect(page.json().items).toHaveLength(1);
    expect(page.json().total).toBe(3);
  });
});

describe('PATCH /admin/users/:id', () => {
  it('sperrt Benutzer und beendet deren Sitzungen', async () => {
    const admin = await ctx.createAdmin();
    const user = await ctx.createUser({ email: 'u@test.local' });
    const tokens = (await ctx.login('u@test.local')).json().tokens;

    const res = await (await ctx.as(admin)).patch(`/admin/users/${user.id}`, { isDisabled: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().isDisabled).toBe(true);

    expectProblem(await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: tokens.refreshToken } }), 401);
    expectProblem(
      await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${tokens.accessToken}` } }),
      403,
      'USER_DISABLED',
    );

    // Entsperren funktioniert wieder
    await (await ctx.as(admin)).patch(`/admin/users/${user.id}`, { isDisabled: false });
    expect((await ctx.login('u@test.local')).statusCode).toBe(200);
  });

  it('setzt Passwort und Anzeigename neu', async () => {
    const admin = await ctx.createAdmin();
    const user = await ctx.createUser({ email: 'p@test.local' });
    const res = await (await ctx.as(admin)).patch(`/admin/users/${user.id}`, { password: 'NeuesPasswort1', displayName: 'Neu' });
    expect(res.json().displayName).toBe('Neu');
    expect((await ctx.login('p@test.local')).statusCode).toBe(401);
    expect((await ctx.login('p@test.local', 'NeuesPasswort1')).statusCode).toBe(200);
  });

  it('verhindert Selbst-Degradierung und Selbst-Sperre', async () => {
    const admin = await ctx.createAdmin();
    const c = await ctx.as(admin);
    expectProblem(await c.patch(`/admin/users/${admin.id}`, { isAdmin: false }), 409, 'SELF_DEMOTE');
    expectProblem(await c.patch(`/admin/users/${admin.id}`, { isDisabled: true }), 409, 'SELF_DISABLE');
  });

  it('404 für unbekannte Benutzer, 400 bei leerem Body', async () => {
    const admin = await ctx.createAdmin();
    const c = await ctx.as(admin);
    expectProblem(await c.patch('/admin/users/00000000-0000-4000-8000-000000000000', { displayName: 'X' }), 404, 'USER_NOT_FOUND');
    expectProblem(await c.patch(`/admin/users/${admin.id}`, {}), 400, 'VALIDATION_ERROR');
  });
});

describe('POST /admin/families/:id/members', () => {
  it('fügt einen Benutzer (z.B. den Admin selbst) mit Flags hinzu', async () => {
    const admin = await ctx.createAdmin();
    const family = await ctx.createFamily();

    expectProblem(await (await ctx.as(admin)).get(`/families/${family.id}`), 403, 'NOT_A_MEMBER');

    const res = await (await ctx.as(admin)).post(`/admin/families/${family.id}/members`, { userId: admin.id, isFamilyAdmin: true, canUpload: true });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ userId: admin.id, isFamilyAdmin: true, canUpload: true, canDownload: false, canComment: true });

    expect((await (await ctx.as(admin)).get(`/families/${family.id}`)).statusCode).toBe(200);
    expectProblem(await (await ctx.as(admin)).post(`/admin/families/${family.id}/members`, { userId: admin.id }), 409, 'ALREADY_MEMBER');
  });

  it('404 für unbekannte Familie oder Benutzer', async () => {
    const admin = await ctx.createAdmin();
    const family = await ctx.createFamily();
    const c = await ctx.as(admin);
    expectProblem(await c.post('/admin/families/00000000-0000-4000-8000-000000000000/members', { userId: admin.id }), 404, 'FAMILY_NOT_FOUND');
    expectProblem(await c.post(`/admin/families/${family.id}/members`, { userId: '00000000-0000-4000-8000-000000000000' }), 404, 'USER_NOT_FOUND');
  });
});

describe('GET /admin/stats', () => {
  it('zählt Benutzer, Familien, Medien und Speicher', async () => {
    const admin = await ctx.createAdmin();
    await ctx.createUser({ isDisabled: true });
    const family = await ctx.createFamily();
    await ctx.prisma.media.create({
      data: {
        familyId: family.id,
        uploaderId: admin.id,
        type: 'PHOTO',
        status: 'READY',
        sha256: 'a'.repeat(64),
        originalName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
        takenAt: new Date(),
      },
    });
    await ctx.prisma.media.create({
      data: {
        familyId: family.id,
        uploaderId: admin.id,
        type: 'PHOTO',
        status: 'READY',
        sha256: 'b'.repeat(64),
        originalName: 'b.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1000,
        takenAt: new Date(),
        deletedAt: new Date(),
      },
    });

    const res = await (await ctx.as(admin)).get('/admin/stats');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ users: 2, disabledUsers: 1, families: 1, media: 1, storageBytes: 1234 });
  });
});
