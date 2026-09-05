import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('POST /families', () => {
  it('legt eine Familie an, optional mit erstem Familien-Admin', async () => {
    const admin = await ctx.createAdmin();
    const firstAdmin = await ctx.createUser();

    const res = await (await ctx.as(admin)).post('/families', { name: '  Familie Muster ', initialAdminUserId: firstAdmin.id });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().name).toBe('Familie Muster');

    const members = await ctx.prisma.familyMember.findMany({ where: { familyId: res.json().id } });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: firstAdmin.id, isFamilyAdmin: true, canUpload: true, canDownload: true, canComment: true });

    // Der globale Admin ist NICHT automatisch Mitglied.
    expect((await (await ctx.as(admin)).get(`/families/${res.json().id}`)).statusCode).toBe(403);
  });

  it('lehnt unbekannte initialAdminUserId ab', async () => {
    const admin = await ctx.createAdmin();
    const res = await (await ctx.as(admin)).post('/families', { name: 'X', initialAdminUserId: '00000000-0000-4000-8000-000000000000' });
    expectProblem(res, 404, 'USER_NOT_FOUND');
    expect(await ctx.prisma.family.count()).toBe(0);
  });

  it('ist nur für globale Admins', async () => {
    const user = await ctx.createUser();
    expectProblem(await (await ctx.as(user)).post('/families', { name: 'X' }), 403, 'ADMIN_REQUIRED');
  });

  it('validiert den Namen', async () => {
    const admin = await ctx.createAdmin();
    expectProblem(await (await ctx.as(admin)).post('/families', { name: '   ' }), 400, 'VALIDATION_ERROR');
  });
});

describe('GET /families', () => {
  it('listet nur eigene Familien mit Rechten und Mitgliederzahl', async () => {
    const user = await ctx.createUser();
    const a = await ctx.createFamily('A');
    const b = await ctx.createFamily('B');
    await ctx.createFamily('C');
    await ctx.addMember(a, user, { canUpload: true });
    await ctx.addMember(b, user, { isFamilyAdmin: true });
    await ctx.addMember(b, await ctx.createUser());

    const res = await (await ctx.as(user)).get('/families');
    expect(res.statusCode, res.body).toBe(200);
    const list = res.json();
    expect(list.map((f: { name: string }) => f.name)).toEqual(['A', 'B']);
    expect(list[0].membership).toMatchObject({ canUpload: true, isFamilyAdmin: false });
    expect(list[0].memberCount).toBe(1);
    expect(list[1].memberCount).toBe(2);
  });

  it('ist leer ohne Mitgliedschaften', async () => {
    const user = await ctx.createUser();
    expect((await (await ctx.as(user)).get('/families')).json()).toEqual([]);
  });
});

describe('GET /families/:id', () => {
  it('liefert die Familie für Mitglieder', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin('Test');
    const res = await (await ctx.as(admin)).get(`/families/${family.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: family.id, name: 'Test', memberCount: 1, membership: { isFamilyAdmin: true } });
  });

  it('404 für unbekannte Familie, 400 für ungültige UUID', async () => {
    const user = await ctx.createUser();
    expectProblem(await (await ctx.as(user)).get('/families/00000000-0000-4000-8000-000000000000'), 404, 'FAMILY_NOT_FOUND');
    expectProblem(await (await ctx.as(user)).get('/families/nicht-uuid'), 400, 'VALIDATION_ERROR');
  });
});

describe('PATCH /families/:id', () => {
  it('Familien-Admin darf umbenennen, Mitglied nicht', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser();
    await ctx.addMember(family, member);

    expectProblem(await (await ctx.as(member)).patch(`/families/${family.id}`, { name: 'Neu' }), 403, 'PERMISSION_ISFAMILYADMIN');

    const res = await (await ctx.as(admin)).patch(`/families/${family.id}`, { name: 'Neu' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Neu');
  });
});

describe('DELETE /families/:id', () => {
  it('globaler Admin löscht inkl. Mitgliedschaften und Einladungen', async () => {
    const { family, admin: familyAdmin } = await ctx.createFamilyWithAdmin();
    await ctx.prisma.invite.create({
      data: { familyId: family.id, createdById: familyAdmin.id, code: 'ABCDEFGHJK', expiresAt: new Date(Date.now() + 1e6), canUpload: false, canDownload: false, canComment: true },
    });
    const globalAdmin = await ctx.createAdmin();

    expectProblem(await (await ctx.as(familyAdmin)).delete(`/families/${family.id}`), 403, 'ADMIN_REQUIRED');

    const res = await (await ctx.as(globalAdmin)).delete(`/families/${family.id}`);
    expect(res.statusCode).toBe(204);
    expect(await ctx.prisma.family.count()).toBe(0);
    expect(await ctx.prisma.familyMember.count()).toBe(0);
    expect(await ctx.prisma.invite.count()).toBe(0);
    // Benutzer bleiben erhalten
    expect(await ctx.prisma.user.count({ where: { id: familyAdmin.id } })).toBe(1);

    expectProblem(await (await ctx.as(globalAdmin)).delete(`/families/${family.id}`), 404, 'FAMILY_NOT_FOUND');
  });
});
