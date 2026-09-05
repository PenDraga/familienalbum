import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD, TestContext, expectProblem } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('POST /auth/login', () => {
  it('gibt Benutzer und Token-Paar zurück', async () => {
    const user = await ctx.createUser({ email: 'anna@test.local' });
    const res = await ctx.login('Anna@Test.local'); // E-Mail wird normalisiert

    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ id: user.id, email: 'anna@test.local', isAdmin: false });
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.tokens.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(body.tokens.accessTokenExpiresIn).toBe(15 * 60);
    expect(typeof body.tokens.refreshToken).toBe('string');
    expect(new Date(body.tokens.refreshTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const stored = await ctx.prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(body.tokens.refreshToken);
  });

  it('lehnt falsches Passwort und unbekannte E-Mail mit derselben Antwort ab', async () => {
    await ctx.createUser({ email: 'anna@test.local' });
    const wrong = await ctx.login('anna@test.local', 'falsch-falsch');
    const unknown = await ctx.login('niemand@test.local');

    expectProblem(wrong, 401, 'INVALID_CREDENTIALS');
    expectProblem(unknown, 401, 'INVALID_CREDENTIALS');
    expect(wrong.json().detail).toBe(unknown.json().detail);
  });

  it('sperrt deaktivierte Konten aus', async () => {
    await ctx.createUser({ email: 'weg@test.local', isDisabled: true });
    expectProblem(await ctx.login('weg@test.local'), 403, 'USER_DISABLED');
  });

  it('validiert den Body als Problem-JSON', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'keine-mail', password: '' },
    });
    const body = expectProblem(res, 400, 'VALIDATION_ERROR');
    expect(body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['body/email', 'body/password']);
  });
});

describe('GET /me', () => {
  it('verlangt ein Token', async () => {
    const res = await (await ctx.as(null)).get('/me');
    expectProblem(res, 401, 'MISSING_TOKEN');
  });

  it('lehnt manipulierte Tokens ab', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: 'Bearer abc.def.ghi' } });
    expectProblem(res, 401, 'TOKEN_INVALID');
  });

  it('liefert Profil mit Familien und Rechten', async () => {
    const user = await ctx.createUser();
    const family = await ctx.createFamily('Müllers');
    await ctx.addMember(family, user, { canUpload: true, canComment: true });

    const res = await (await ctx.as(user)).get('/me');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.id).toBe(user.id);
    expect(body.families).toHaveLength(1);
    expect(body.families[0]).toMatchObject({
      id: family.id,
      name: 'Müllers',
      membership: { isFamilyAdmin: false, canUpload: true, canDownload: false, canComment: true },
    });
  });

  it('sperrt Benutzer aus, die nach Token-Ausgabe deaktiviert wurden', async () => {
    const user = await ctx.createUser();
    const headers = await ctx.authHeaders(user);
    await ctx.prisma.user.update({ where: { id: user.id }, data: { isDisabled: true } });

    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers });
    expectProblem(res, 403, 'USER_DISABLED');
  });
});

describe('POST /auth/refresh', () => {
  it('rotiert das Refresh-Token und erkennt Wiederverwendung', async () => {
    const user = await ctx.createUser({ email: 'r@test.local' });
    const first = (await ctx.login('r@test.local')).json().tokens;

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().user.id).toBe(user.id);
    const secondTokens = second.json().tokens;
    expect(secondTokens.refreshToken).not.toBe(first.refreshToken);

    // Altes Token nochmals benutzen → Diebstahlverdacht: alle Sitzungen enden.
    const reuse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expectProblem(reuse, 401, 'REFRESH_REUSED');

    const third = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: secondTokens.refreshToken },
    });
    expectProblem(third, 401, 'REFRESH_REUSED');
  });

  it('lehnt unbekannte und abgelaufene Tokens ab', async () => {
    const user = await ctx.createUser({ email: 'e@test.local' });
    const tokens = (await ctx.login('e@test.local')).json().tokens;
    await ctx.prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expectProblem(
      await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: tokens.refreshToken } }),
      401,
      'REFRESH_EXPIRED',
    );
    expectProblem(
      await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: 'x'.repeat(64) } }),
      401,
      'REFRESH_INVALID',
    );
  });
});

describe('POST /auth/logout', () => {
  it('widerruft das Refresh-Token', async () => {
    await ctx.createUser({ email: 'l@test.local' });
    const tokens = (await ctx.login('l@test.local')).json().tokens;

    const logout = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken: tokens.refreshToken } });
    expect(logout.statusCode).toBe(204);

    const refresh = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: tokens.refreshToken } });
    expectProblem(refresh, 401, 'REFRESH_REUSED');
  });

  it('beendet mit all:true alle Sitzungen, verlangt dafür aber ein Access-Token', async () => {
    const user = await ctx.createUser({ email: 'a@test.local' });
    const t1 = (await ctx.login('a@test.local')).json().tokens;
    const t2 = (await ctx.login('a@test.local')).json().tokens;

    expectProblem(await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { all: true } }), 401);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${t1.accessToken}` },
      payload: { all: true },
    });
    expect(res.statusCode).toBe(204);

    const active = await ctx.prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(active).toBe(0);
    expectProblem(
      await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: t2.refreshToken } }),
      401,
    );
  });

  it('braucht refreshToken oder all', async () => {
    expectProblem(await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: {} }), 400, 'LOGOUT_TARGET_MISSING');
  });
});

describe('Fehlerformat', () => {
  it('unbekannte Routen liefern Problem-JSON', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/gibt-es-nicht' });
    expectProblem(res, 404, 'ROUTE_NOT_FOUND');
    expect(res.json().instance).toBe('/api/v1/gibt-es-nicht');
  });

  it(`Standard-Passwort für Tests ist gesetzt (${DEFAULT_PASSWORD.length} Zeichen)`, () => {
    expect(DEFAULT_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });
});
