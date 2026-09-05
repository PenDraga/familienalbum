/**
 * Rechtematrix (CLAUDE.md): Der Hook `requireFamilyPermission` wird für jede Berechtigung gegen
 * alle relevanten Mitgliedschafts-Konstellationen geprüft. Die Testrouten sind bewusst minimal,
 * damit die Matrix unabhängig von konkreten Fach-Routen (Upload/Download kommen erst in M2) gilt.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requireFamilyPermission, type FamilyPermission } from '../src/plugins/permissions.js';
import { TestContext, expectProblem, type MemberFlags } from './helpers/app.js';

const PERMISSIONS: FamilyPermission[] = ['member', 'isFamilyAdmin', 'canUpload', 'canDownload', 'canComment'];

async function testRoutes(app: FastifyInstance) {
  for (const perm of PERMISSIONS) {
    app.get(
      `/api/v1/test/families/:id/${perm}`,
      { preHandler: requireFamilyPermission(perm) },
      async (request) => ({ ok: true, membership: request.membership, userId: request.user?.id }),
    );
  }
  // Family-ID aus einer anderen Stelle als `params.id` auflösen (wie später bei /media/:id)
  app.get(
    '/api/v1/test/by-query/canUpload',
    { preHandler: requireFamilyPermission('canUpload', (req) => (req.query as { familyId?: string }).familyId) },
    async () => ({ ok: true }),
  );
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create(testRoutes);
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

type Actor = 'anonymous' | 'non-member' | 'global-admin-non-member' | { flags: MemberFlags };

interface Row {
  name: string;
  actor: Actor;
  expected: Record<FamilyPermission, number>;
}

const ALL_FORBIDDEN: Record<FamilyPermission, number> = {
  member: 403,
  isFamilyAdmin: 403,
  canUpload: 403,
  canDownload: 403,
  canComment: 403,
};

const MATRIX: Row[] = [
  {
    name: 'nicht angemeldet',
    actor: 'anonymous',
    expected: { member: 401, isFamilyAdmin: 401, canUpload: 401, canDownload: 401, canComment: 401 },
  },
  { name: 'Nicht-Mitglied', actor: 'non-member', expected: ALL_FORBIDDEN },
  {
    name: 'globaler Admin ohne Mitgliedschaft (umgeht Familienrechte NICHT)',
    actor: 'global-admin-non-member',
    expected: ALL_FORBIDDEN,
  },
  {
    name: 'Mitglied ohne Flags',
    actor: { flags: {} },
    expected: { member: 200, isFamilyAdmin: 403, canUpload: 403, canDownload: 403, canComment: 403 },
  },
  {
    name: 'Mitglied mit canUpload',
    actor: { flags: { canUpload: true } },
    expected: { member: 200, isFamilyAdmin: 403, canUpload: 200, canDownload: 403, canComment: 403 },
  },
  {
    name: 'Mitglied mit canDownload',
    actor: { flags: { canDownload: true } },
    expected: { member: 200, isFamilyAdmin: 403, canUpload: 403, canDownload: 200, canComment: 403 },
  },
  {
    name: 'Mitglied mit canComment',
    actor: { flags: { canComment: true } },
    expected: { member: 200, isFamilyAdmin: 403, canUpload: 403, canDownload: 403, canComment: 200 },
  },
  {
    name: 'Familien-Admin ohne weitere Flags (Admin impliziert keine Upload/Download-Rechte)',
    actor: { flags: { isFamilyAdmin: true } },
    expected: { member: 200, isFamilyAdmin: 200, canUpload: 403, canDownload: 403, canComment: 403 },
  },
  {
    name: 'Familien-Admin mit allen Flags',
    actor: { flags: { isFamilyAdmin: true, canUpload: true, canDownload: true, canComment: true } },
    expected: { member: 200, isFamilyAdmin: 200, canUpload: 200, canDownload: 200, canComment: 200 },
  },
];

describe('requireFamilyPermission – Rechtematrix', () => {
  for (const row of MATRIX) {
    for (const perm of PERMISSIONS) {
      it(`${row.name} → ${perm}: ${row.expected[perm]}`, async () => {
        const family = await ctx.createFamily();
        // Ein weiteres Mitglied, damit die Familie nie leer ist.
        await ctx.addMember(family, await ctx.createUser(), { isFamilyAdmin: true });

        let headers: Record<string, string> = {};
        if (row.actor === 'non-member') {
          headers = await ctx.authHeaders(await ctx.createUser());
        } else if (row.actor === 'global-admin-non-member') {
          headers = await ctx.authHeaders(await ctx.createAdmin());
        } else if (typeof row.actor === 'object') {
          const user = await ctx.createUser();
          await ctx.addMember(family, user, row.actor.flags);
          headers = await ctx.authHeaders(user);
        }

        const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/test/families/${family.id}/${perm}`, headers });
        expect(res.statusCode, `${row.name} / ${perm}: ${res.body}`).toBe(row.expected[perm]);

        if (res.statusCode === 200) {
          const body = res.json();
          expect(body.membership.familyId).toBe(family.id);
          expect(body.membership.userId).toBe(body.userId);
        } else {
          expectProblem(res, row.expected[perm]);
        }
      });
    }
  }

  it('liefert 404 für unbekannte Familien statt 403', async () => {
    const user = await ctx.createUser();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/test/families/00000000-0000-4000-8000-000000000000/member',
      headers: await ctx.authHeaders(user),
    });
    expectProblem(res, 404, 'FAMILY_NOT_FOUND');
  });

  it('nennt die fehlende Berechtigung im Fehlercode', async () => {
    const family = await ctx.createFamily();
    const user = await ctx.createUser();
    await ctx.addMember(family, user);
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/test/families/${family.id}/canUpload`,
      headers: await ctx.authHeaders(user),
    });
    expectProblem(res, 403, 'PERMISSION_CANUPLOAD');
  });

  it('kann die Family-ID aus einer anderen Quelle als params.id lesen', async () => {
    const family = await ctx.createFamily();
    const user = await ctx.createUser();
    await ctx.addMember(family, user, { canUpload: true });
    const headers = await ctx.authHeaders(user);

    const ok = await ctx.app.inject({ method: 'GET', url: `/api/v1/test/by-query/canUpload?familyId=${family.id}`, headers });
    expect(ok.statusCode, ok.body).toBe(200);

    const missing = await ctx.app.inject({ method: 'GET', url: '/api/v1/test/by-query/canUpload', headers });
    expectProblem(missing, 400, 'FAMILY_ID_MISSING');
  });

  it('aktualisiert lastSeenAt beim Zugriff', async () => {
    const family = await ctx.createFamily();
    const user = await ctx.createUser();
    await ctx.addMember(family, user);

    await ctx.app.inject({ method: 'GET', url: `/api/v1/test/families/${family.id}/member`, headers: await ctx.authHeaders(user) });
    // Update läuft asynchron (fire-and-forget) – kurz warten.
    await new Promise((r) => setTimeout(r, 200));

    const m = await ctx.prisma.familyMember.findUniqueOrThrow({ where: { userId_familyId: { userId: user.id, familyId: family.id } } });
    expect(m.lastSeenAt).not.toBeNull();
  });
});

describe('Rechtematrix auf echten Routen', () => {
  it('Familie sehen / Mitglieder auflisten: nur Mitglieder', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser();
    await ctx.addMember(family, member);
    const outsider = await ctx.createUser();
    const globalAdmin = await ctx.createAdmin();

    for (const url of [`/families/${family.id}`, `/families/${family.id}/members`]) {
      expect((await (await ctx.as(admin)).get(url)).statusCode).toBe(200);
      expect((await (await ctx.as(member)).get(url)).statusCode).toBe(200);
      expect((await (await ctx.as(outsider)).get(url)).statusCode).toBe(403);
      expect((await (await ctx.as(globalAdmin)).get(url)).statusCode).toBe(403);
      expect((await (await ctx.as(null)).get(url)).statusCode).toBe(401);
    }
  });

  it('Mitglieder-Flags ändern, Einladungen erzeugen, Mitglied entfernen: nur isFamilyAdmin', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const member = await ctx.createUser();
    await ctx.addMember(family, member);
    const victim = await ctx.createUser();
    await ctx.addMember(family, victim);
    const globalAdmin = await ctx.createAdmin();

    const attempts = async (actor: typeof member) => {
      const c = await ctx.as(actor);
      return [
        (await c.patch(`/families/${family.id}/members/${victim.id}`, { canUpload: true })).statusCode,
        (await c.post(`/families/${family.id}/invites`, {})).statusCode,
        (await c.delete(`/families/${family.id}/members/${victim.id}`)).statusCode,
      ];
    };

    expect(await attempts(member)).toEqual([403, 403, 403]);
    expect(await attempts(globalAdmin)).toEqual([403, 403, 403]);
    expect(await attempts(admin)).toEqual([200, 201, 204]);
  });

  it('User anlegen, Familien anlegen/löschen, Statistik: nur globaler Admin', async () => {
    const { family, admin: familyAdmin } = await ctx.createFamilyWithAdmin();
    const globalAdmin = await ctx.createAdmin();

    const attempts = async (actor: typeof familyAdmin) => {
      const c = await ctx.as(actor);
      return [
        (await c.get('/admin/users')).statusCode,
        (await c.post('/admin/users', { email: `n-${actor.id}@test.local`, password: 'Passw0rd!x', displayName: 'N' })).statusCode,
        (await c.get('/admin/stats')).statusCode,
        (await c.post('/families', { name: 'Neu' })).statusCode,
        (await c.delete(`/families/${family.id}`)).statusCode,
      ];
    };

    expect(await attempts(familyAdmin)).toEqual([403, 403, 403, 403, 403]);
    expect(await attempts(globalAdmin)).toEqual([200, 201, 200, 201, 204]);
  });
});
