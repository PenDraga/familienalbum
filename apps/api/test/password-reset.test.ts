import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { NoopMailer } from '../src/services/mail.service.js';
import { TestContext, expectProblem } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => {
  ctx.mail.sent.length = 0;
  return ctx.resetDb();
});

function tokenFromMail(text: string) {
  const m = /\/reset\?token=([A-Za-z0-9_-]+)/.exec(text);
  expect(m, text).not.toBeNull();
  return m![1]!;
}

describe('POST /auth/password-reset', () => {
  it('schickt einen Link mit Token an bekannte Adressen – unbekannte bekommen dieselbe Antwort ohne Mail', async () => {
    const user = await ctx.createUser({ email: 'anna@example.com', displayName: 'Anna' });

    const known = await (await ctx.as(null)).post('/auth/password-reset', { email: 'Anna@Example.com' });
    expect(known.statusCode, known.body).toBe(204);
    expect(ctx.mail.sent).toHaveLength(1);
    expect(ctx.mail.sent[0]!.to).toBe('anna@example.com');
    expect(ctx.mail.sent[0]!.text).toContain('https://album.test/reset?token=');
    expect(ctx.mail.sent[0]!.text).toContain('Hallo Anna');

    const unknown = await (await ctx.as(null)).post('/auth/password-reset', { email: 'niemand@example.com' });
    expect(unknown.statusCode).toBe(204);
    expect(ctx.mail.sent).toHaveLength(1);

    // Token liegt nur gehasht in der DB
    const stored = await ctx.prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toContain(tokenFromMail(ctx.mail.sent[0]!.text));
  });

  it('gesperrte Konten bekommen keine Mail', async () => {
    await ctx.createUser({ email: 'gesperrt@example.com', isDisabled: true });
    const res = await (await ctx.as(null)).post('/auth/password-reset', { email: 'gesperrt@example.com' });
    expect(res.statusCode).toBe(204);
    expect(ctx.mail.sent).toHaveLength(0);
  });

  it('ohne Mail-Versand antwortet der Server mit 503 und meldet es im Health-Check', async () => {
    const app = await buildApp({
      prisma: ctx.prisma,
      config: ctx.app.config,
      mediaQueue: ctx.queue,
      mailer: new NoopMailer(),
      logger: false,
    });
    await app.ready();
    try {
      const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(health.json().features).toEqual({ passwordReset: false });
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/password-reset', payload: { email: 'x@example.com' } });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('PASSWORD_RESET_DISABLED');
    } finally {
      await app.close();
    }
    expect((await (await ctx.as(null)).get('/health')).json().features).toEqual({ passwordReset: true });
  });
});

describe('POST /auth/password-reset/confirm', () => {
  it('setzt das Passwort, verbraucht das Token und beendet alle Sitzungen', async () => {
    const user = await ctx.createUser({ email: 'anna@example.com' });
    const before = (await ctx.login(user.email)).json(); // bestehende Sitzung
    await (await ctx.as(null)).post('/auth/password-reset', { email: user.email });
    const token = tokenFromMail(ctx.mail.sent[0]!.text);

    const res = await (await ctx.as(null)).post('/auth/password-reset/confirm', { token, password: 'neues-passwort-123' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ email: 'anna@example.com' });

    // Neues Passwort gilt, altes nicht mehr
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: 'neues-passwort-123' } })).statusCode).toBe(200);
    expectProblem(await ctx.login(user.email), 401, 'INVALID_CREDENTIALS');

    // Alte Sitzung beendet
    expectProblem(await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: before.tokens.refreshToken } }), 401);

    // Token nur einmal
    expectProblem(await (await ctx.as(null)).post('/auth/password-reset/confirm', { token, password: 'nochmal-12345' }), 400, 'RESET_TOKEN_INVALID');
  });

  it('lehnt abgelaufene, unbekannte und zu kurze Eingaben ab; nur der neueste Link gilt', async () => {
    const user = await ctx.createUser({ email: 'anna@example.com' });
    await (await ctx.as(null)).post('/auth/password-reset', { email: user.email });
    const first = tokenFromMail(ctx.mail.sent[0]!.text);
    await (await ctx.as(null)).post('/auth/password-reset', { email: user.email });
    const second = tokenFromMail(ctx.mail.sent[1]!.text);

    expectProblem(await (await ctx.as(null)).post('/auth/password-reset/confirm', { token: first, password: 'passwort-neu-1' }), 400, 'RESET_TOKEN_INVALID');
    expectProblem(await (await ctx.as(null)).post('/auth/password-reset/confirm', { token: 'x'.repeat(40), password: 'passwort-neu-1' }), 400, 'RESET_TOKEN_INVALID');
    expectProblem(await (await ctx.as(null)).post('/auth/password-reset/confirm', { token: second, password: 'kurz' }), 400, 'VALIDATION_ERROR');

    await ctx.prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectProblem(await (await ctx.as(null)).post('/auth/password-reset/confirm', { token: second, password: 'passwort-neu-1' }), 400, 'RESET_TOKEN_INVALID');
  });
});
