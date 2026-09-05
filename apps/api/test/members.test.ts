import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('GET /families/:id/members', () => {
  it('listet Mitglieder mit Anzeigename, Flags – Admins zuerst, ohne E-Mail', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser({ displayName: 'Oma' });
    await ctx.addMember(family, member, { canComment: true });

    const res = await (await ctx.as(member)).get(`/families/${family.id}/members`);
    expect(res.statusCode, res.body).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(2);
    expect(list[0].userId).toBe(admin.id);
    expect(list[1]).toMatchObject({
      userId: member.id,
      user: { id: member.id, displayName: 'Oma' },
      isFamilyAdmin: false,
      canComment: true,
      canUpload: false,
    });
    expect(list[1].user.email).toBeUndefined();
    // Der Admin war noch nie aktiv (lastSeenAt des abrufenden Mitglieds wird asynchron gesetzt).
    expect(list[0].lastSeenAt).toBeNull();
  });
});

describe('PATCH /families/:id/members/:userId', () => {
  it('ändert einzelne Flags', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser();
    await ctx.addMember(family, member);

    const res = await (await ctx.as(admin)).patch(`/families/${family.id}/members/${member.id}`, { canUpload: true, canDownload: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ canUpload: true, canDownload: true, canComment: false, isFamilyAdmin: false });
  });

  it('kann weitere Familien-Admins ernennen und wieder degradieren', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser();
    await ctx.addMember(family, member);
    const c = await ctx.as(admin);

    expect((await c.patch(`/families/${family.id}/members/${member.id}`, { isFamilyAdmin: true })).json().isFamilyAdmin).toBe(true);
    // Jetzt gibt es zwei Admins – der erste darf sich selbst degradieren.
    expect((await c.patch(`/families/${family.id}/members/${admin.id}`, { isFamilyAdmin: false })).statusCode).toBe(200);
    // ... und danach nichts mehr ändern.
    expectProblem(await c.patch(`/families/${family.id}/members/${member.id}`, { canUpload: true }), 403, 'PERMISSION_ISFAMILYADMIN');
  });

  it('verhindert, dass der letzte Familien-Admin degradiert wird', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const res = await (await ctx.as(admin)).patch(`/families/${family.id}/members/${admin.id}`, { isFamilyAdmin: false });
    expectProblem(res, 409, 'LAST_FAMILY_ADMIN');
  });

  it('404 für Nicht-Mitglied, 400 bei leerem Body', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const stranger = await ctx.createUser();
    const c = await ctx.as(admin);
    expectProblem(await c.patch(`/families/${family.id}/members/${stranger.id}`, { canUpload: true }), 404, 'MEMBER_NOT_FOUND');
    expectProblem(await c.patch(`/families/${family.id}/members/${admin.id}`, {}), 400, 'VALIDATION_ERROR');
  });
});

describe('DELETE /families/:id/members/:userId', () => {
  it('Familien-Admin entfernt Mitglied', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser();
    await ctx.addMember(family, member);

    const res = await (await ctx.as(admin)).delete(`/families/${family.id}/members/${member.id}`);
    expect(res.statusCode).toBe(204);
    expect(await ctx.prisma.familyMember.count({ where: { familyId: family.id } })).toBe(1);
  });

  it('Mitglied darf selbst austreten, aber niemand anderen entfernen', async () => {
    const { family } = await ctx.createFamilyWithAdmin();
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.addMember(family, a);
    await ctx.addMember(family, b);

    expectProblem(await (await ctx.as(a)).delete(`/families/${family.id}/members/${b.id}`), 403, 'PERMISSION_ISFAMILYADMIN');
    expect((await (await ctx.as(a)).delete(`/families/${family.id}/members/${a.id}`)).statusCode).toBe(204);
    // Nach dem Austritt kein Zugriff mehr
    expectProblem(await (await ctx.as(a)).get(`/families/${family.id}`), 403, 'NOT_A_MEMBER');
  });

  it('der letzte Familien-Admin kann nicht entfernt werden', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    expectProblem(await (await ctx.as(admin)).delete(`/families/${family.id}/members/${admin.id}`), 409, 'LAST_FAMILY_ADMIN');
  });
});
