import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('Sprache', () => {
  it('Fehlermeldungen folgen Accept-Language (de Standard, en auf Wunsch)', async () => {
    const { family } = await ctx.createFamilyWithAdmin();
    const stranger = await ctx.createUser();
    const token = await ctx.accessToken(stranger);
    const de = await ctx.app.inject({ method: 'GET', url: `/api/v1/families/${family.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(de.json()).toMatchObject({ code: 'NOT_A_MEMBER', detail: 'Du bist kein Mitglied dieses Albums.' });
    const en = await ctx.app.inject({ method: 'GET', url: `/api/v1/families/${family.id}`, headers: { authorization: `Bearer ${token}`, 'accept-language': 'en-US,en;q=0.9' } });
    expect(en.json()).toMatchObject({ code: 'NOT_A_MEMBER', detail: 'You are not a member of this album.' });
    const fr = await ctx.app.inject({ method: 'GET', url: `/api/v1/families/${family.id}`, headers: { authorization: `Bearer ${token}`, 'accept-language': 'fr-CH' } });
    expect(fr.json().detail).toBe('Du bist kein Mitglied dieses Albums.');
  });

  it('Push-Texte folgen der Sprache des Geräts', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const oma = await ctx.createUser({ displayName: 'Oma' });
    const uncle = await ctx.createUser({ displayName: 'Uncle' });
    await ctx.addMember(family, oma, { canComment: true });
    await ctx.addMember(family, uncle, { canComment: true });
    await (await ctx.as(oma)).post('/devices', { fcmToken: 'o'.repeat(40), platform: 'ios' });
    await (await ctx.as(uncle)).post('/devices', { fcmToken: 'u'.repeat(40), platform: 'android', locale: 'en-GB' });
    await ctx.uploadAndProcess(admin, family, await makeJpeg());
    await ctx.app.notifications.notifyNewMedia(family.id, admin.id);
    const forOma = ctx.push.sent.find((s) => s.tokens.includes('o'.repeat(40)))!;
    const forUncle = ctx.push.sent.find((s) => s.tokens.includes('u'.repeat(40)))!;
    expect(forOma.message.body).toMatch(/hat 1 neues Foto hinzugefügt$/);
    expect(forUncle.message.body).toMatch(/added 1 new photo$/);
    expect(forOma.tokens).not.toContain('u'.repeat(40));
  });
});
