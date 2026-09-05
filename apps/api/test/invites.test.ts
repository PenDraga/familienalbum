import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateInviteCode } from '../src/services/invite.service.js';
import { TestContext, expectProblem } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

async function createInvite(overrides: Record<string, unknown> = {}) {
  const { family, admin } = await ctx.createFamilyWithAdmin();
  const res = await (await ctx.as(admin)).post(`/families/${family.id}/invites`, overrides);
  expect(res.statusCode, res.body).toBe(201);
  return { family, admin, invite: res.json() as { id: string; code: string; expiresAt: string; maxUses: number; uses: number } };
}

describe('Einladungs-Code', () => {
  it('besteht aus gut lesbaren Zeichen', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInviteCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
    }
  });
});

describe('POST /families/:id/invites', () => {
  it('erzeugt eine Einladung mit Defaults (7 Tage, 1 Nutzung, nur kommentieren)', async () => {
    const { invite, family, admin } = await createInvite();
    expect(invite).toMatchObject({ familyId: family.id, createdById: admin.id, maxUses: 1, uses: 0, canUpload: false, canDownload: false, canComment: true });
    const hours = (new Date(invite.expiresAt).getTime() - Date.now()) / 3600e3;
    expect(hours).toBeGreaterThan(24 * 7 - 1);
    expect(hours).toBeLessThanOrEqual(24 * 7);
  });

  it('übernimmt Flags und Limits', async () => {
    const { invite } = await createInvite({ expiresInHours: 1, maxUses: 5, canUpload: true, canDownload: true, canComment: false });
    expect(invite).toMatchObject({ maxUses: 5, canUpload: true, canDownload: true, canComment: false });
  });

  it('nur Familien-Admins', async () => {
    const { family } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser();
    await ctx.addMember(family, member, { canUpload: true, canDownload: true, canComment: true });
    expectProblem(await (await ctx.as(member)).post(`/families/${family.id}/invites`, {}), 403, 'PERMISSION_ISFAMILYADMIN');
  });
});

describe('GET/DELETE /families/:id/invites', () => {
  it('listet nur aktive Einladungen und erlaubt Widerruf', async () => {
    const { family, admin, invite } = await createInvite();
    const c = await ctx.as(admin);
    const used = (await c.post(`/families/${family.id}/invites`, { maxUses: 1 })).json();
    await ctx.prisma.invite.update({ where: { id: used.id }, data: { uses: 1 } });
    const expired = (await c.post(`/families/${family.id}/invites`, {})).json();
    await ctx.prisma.invite.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const list = await c.get(`/families/${family.id}/invites`);
    expect(list.json().map((i: { id: string }) => i.id)).toEqual([invite.id]);

    expect((await c.delete(`/families/${family.id}/invites/${invite.id}`)).statusCode).toBe(204);
    expect((await c.get(`/families/${family.id}/invites`)).json()).toEqual([]);
    expectProblem(await c.delete(`/families/${family.id}/invites/${invite.id}`), 404, 'INVITE_NOT_FOUND');
  });

  it('Widerruf über eine fremde Familie ist nicht möglich', async () => {
    const { invite } = await createInvite();
    const { family: other, admin: otherAdmin } = await ctx.createFamilyWithAdmin();
    expectProblem(await (await ctx.as(otherAdmin)).delete(`/families/${other.id}/invites/${invite.id}`), 404, 'INVITE_NOT_FOUND');
    expect(await ctx.prisma.invite.count()).toBe(1);
  });
});

describe('GET /invites/:code', () => {
  it('zeigt Familienname und Gültigkeit ohne Login', async () => {
    const { invite, family } = await createInvite({ canUpload: true });
    const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/invites/${invite.code.toLowerCase()}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ familyName: family.name, isValid: true, canUpload: true });
    expect(res.json().code).toBeUndefined();
  });

  it('404 bei unbekanntem Code', async () => {
    expectProblem(await ctx.app.inject({ method: 'GET', url: '/api/v1/invites/ZZZZZZZZZZ' }), 404, 'INVITE_NOT_FOUND');
  });
});

describe('POST /invites/:code/accept – angemeldet', () => {
  it('macht den Benutzer mit den Einladungs-Flags zum Mitglied', async () => {
    const { invite, family } = await createInvite({ canUpload: true, canComment: false });
    const user = await ctx.createUser();

    const res = await (await ctx.as(user)).post(`/invites/${invite.code}/accept`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      family: { id: family.id, name: family.name, createdAt: family.createdAt.toISOString() },
      membership: { isFamilyAdmin: false, canUpload: true, canDownload: false, canComment: false },
    });

    expect((await (await ctx.as(user)).get(`/families/${family.id}`)).statusCode).toBe(200);
    expect((await ctx.prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(1);
  });

  it('bereits Mitglied → 409, Nutzung wird nicht verbraucht', async () => {
    const { invite, admin } = await createInvite();
    expectProblem(await (await ctx.as(admin)).post(`/invites/${invite.code}/accept`), 409, 'ALREADY_MEMBER');
    expect((await ctx.prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(0);
  });

  it('aufgebrauchte oder abgelaufene Einladungen → 410', async () => {
    const { invite } = await createInvite({ maxUses: 1 });
    const u1 = await ctx.createUser();
    const u2 = await ctx.createUser();
    expect((await (await ctx.as(u1)).post(`/invites/${invite.code}/accept`)).statusCode).toBe(200);
    expectProblem(await (await ctx.as(u2)).post(`/invites/${invite.code}/accept`), 410, 'INVITE_USED_UP');

    const { invite: old } = await createInvite();
    await ctx.prisma.invite.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expectProblem(await (await ctx.as(u2)).post(`/invites/${old.code}/accept`), 410, 'INVITE_EXPIRED');
  });

  it('mehrfach nutzbare Einladung zählt hoch', async () => {
    const { invite } = await createInvite({ maxUses: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await (await ctx.as(await ctx.createUser())).post(`/invites/${invite.code}/accept`)).statusCode).toBe(200);
    }
    expectProblem(await (await ctx.as(await ctx.createUser())).post(`/invites/${invite.code}/accept`), 410, 'INVITE_USED_UP');
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/invites/${invite.code}` })).json().isValid).toBe(false);
  });

  it('ungültiges Access-Token → 401 (kein Fallback auf Registrierung)', async () => {
    const { invite } = await createInvite();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/invites/${invite.code}/accept`,
      headers: { authorization: 'Bearer kaputt' },
      payload: { email: 'x@test.local', password: 'Passw0rd!x', displayName: 'X' },
    });
    expectProblem(res, 401, 'TOKEN_INVALID');
    expect(await ctx.prisma.user.count({ where: { email: 'x@test.local' } })).toBe(0);
  });
});

describe('POST /invites/:code/accept – Registrierung', () => {
  it('legt Konto + Mitgliedschaft an und gibt Tokens zurück', async () => {
    const { invite, family } = await createInvite({ canDownload: true });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/invites/${invite.code}/accept`,
      payload: { email: 'Neu@Test.local', password: 'Passw0rd!neu', displayName: 'Neu' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ email: 'neu@test.local', displayName: 'Neu', isAdmin: false });
    expect(body.membership).toMatchObject({ canDownload: true, isFamilyAdmin: false });
    expect(body.tokens.accessToken).toBeTypeOf('string');

    // Token funktioniert sofort, Login geht auch
    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${body.tokens.accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().families[0].id).toBe(family.id);
    expect((await ctx.login('neu@test.local', 'Passw0rd!neu')).statusCode).toBe(200);
  });

  it('ohne Login und ohne Registrierungsdaten → 400', async () => {
    const { invite } = await createInvite();
    expectProblem(await ctx.app.inject({ method: 'POST', url: `/api/v1/invites/${invite.code}/accept` }), 400, 'REGISTRATION_REQUIRED');
    expectProblem(
      await ctx.app.inject({ method: 'POST', url: `/api/v1/invites/${invite.code}/accept`, payload: { email: 'a@b.c', password: 'kurz', displayName: 'A' } }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('bestehende E-Mail → 409, keine Nutzung verbraucht', async () => {
    const { invite } = await createInvite();
    await ctx.createUser({ email: 'da@test.local' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/invites/${invite.code}/accept`,
      payload: { email: 'da@test.local', password: 'Passw0rd!x', displayName: 'Da' },
    });
    expectProblem(res, 409, 'EMAIL_TAKEN');
    expect((await ctx.prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(0);
  });

  it('bei aufgebrauchter Einladung wird kein Konto angelegt (Transaktion)', async () => {
    const { invite } = await createInvite({ maxUses: 1 });
    await ctx.prisma.invite.update({ where: { id: invite.id }, data: { uses: 1 } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/invites/${invite.code}/accept`,
      payload: { email: 'nie@test.local', password: 'Passw0rd!x', displayName: 'Nie' },
    });
    expectProblem(res, 410, 'INVITE_USED_UP');
    expect(await ctx.prisma.user.count({ where: { email: 'nie@test.local' } })).toBe(0);
  });
});
