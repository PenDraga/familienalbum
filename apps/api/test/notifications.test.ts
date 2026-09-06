import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeMedia } from '../src/services/notification.service.js';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

const token = (n: string) => `fcm-token-${n}-${'x'.repeat(30)}`;

describe('POST/DELETE /devices', () => {
  it('registriert Tokens pro Benutzer, hängt sie bei Kontowechsel um und entfernt sie', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    expect((await (await ctx.as(a)).post('/devices', { fcmToken: token('1'), platform: 'android' })).statusCode).toBe(204);
    expect((await (await ctx.as(a)).post('/devices', { fcmToken: token('1'), platform: 'android' })).statusCode).toBe(204);
    expect(await ctx.prisma.device.count()).toBe(1);

    // Gleiches Gerät, anderer Benutzer angemeldet
    await (await ctx.as(b)).post('/devices', { fcmToken: token('1'), platform: 'android' });
    expect((await ctx.prisma.device.findUniqueOrThrow({ where: { fcmToken: token('1') } })).userId).toBe(b.id);

    // Fremde dürfen das Token nicht löschen
    await (await ctx.as(a)).delete('/devices', { fcmToken: token('1') });
    expect(await ctx.prisma.device.count()).toBe(1);
    await (await ctx.as(b)).delete('/devices', { fcmToken: token('1') });
    expect(await ctx.prisma.device.count()).toBe(0);

    expectProblem(await (await ctx.as(null)).post('/devices', { fcmToken: token('1'), platform: 'ios' }), 401);
    expectProblem(await (await ctx.as(a)).post('/devices', { fcmToken: 'kurz', platform: 'ios' }), 400, 'VALIDATION_ERROR');
  });
});

describe('Push: neue Medien (Digest)', () => {
  it('bündelt mehrere Uploads zu einer Nachricht an alle anderen Mitglieder', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const oma = await ctx.createUser({ displayName: 'Oma' });
    const opa = await ctx.createUser({ displayName: 'Opa' });
    await ctx.addMember(family, oma);
    await ctx.addMember(family, opa);
    await (await ctx.as(oma)).post('/devices', { fcmToken: token('oma-handy'), platform: 'ios' });
    await (await ctx.as(oma)).post('/devices', { fcmToken: token('oma-tablet'), platform: 'android' });
    await (await ctx.as(admin)).post('/devices', { fcmToken: token('admin'), platform: 'android' });

    await ctx.uploadAndProcess(admin, family, await makeJpeg({ color: '#111111' }));
    await ctx.uploadAndProcess(admin, family, await makeJpeg({ color: '#222222' }));
    // Der Worker reiht pro fertigem Medium einen Digest-Job ein (BullMQ dedupliziert per jobId)
    expect(ctx.queue.notifications).toEqual([
      { familyId: family.id, uploaderId: admin.id },
      { familyId: family.id, uploaderId: admin.id },
    ]);

    const outcome = await ctx.app.notifications.notifyNewMedia(family.id, admin.id);
    expect(outcome).toEqual({ recipients: 2, sent: 2, count: 2 });
    expect(ctx.push.sent).toHaveLength(1);
    const [msg] = ctx.push.sent;
    expect(msg!.tokens.sort()).toEqual([token('oma-handy'), token('oma-tablet')].sort());
    expect(msg!.message.title).toBe(family.name);
    expect(msg!.message.body).toContain('2 neue Fotos');
    expect(msg!.message.data).toMatchObject({ type: 'media', familyId: family.id, count: '2' });

    // Zweiter Lauf: nichts Neues → keine zweite Nachricht
    expect(await ctx.app.notifications.notifyNewMedia(family.id, admin.id)).toEqual({ recipients: 0, sent: 0, count: 0 });
    expect(ctx.push.sent).toHaveLength(1);
  });

  it('entfernt Tokens, die FCM als ungültig meldet', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const oma = await ctx.createUser();
    await ctx.addMember(family, oma);
    await (await ctx.as(oma)).post('/devices', { fcmToken: token('alt'), platform: 'android' });
    await (await ctx.as(oma)).post('/devices', { fcmToken: token('neu'), platform: 'android' });
    ctx.push.invalid.add(token('alt'));

    await ctx.uploadAndProcess(admin, family, await makeJpeg());
    const outcome = await ctx.app.notifications.notifyNewMedia(family.id, admin.id);
    expect(outcome.sent).toBe(1);
    expect((await ctx.prisma.device.findMany()).map((d) => d.fcmToken)).toEqual([token('neu')]);
  });

  it('schickt nichts, wenn niemand sonst in der Familie ist oder das Medium gelöscht wurde', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
    expect(await ctx.app.notifications.notifyNewMedia(family.id, admin.id)).toEqual({ recipients: 0, sent: 0, count: 1 });

    await (await ctx.as(admin)).delete(`/media/${media.id}`);
    await ctx.prisma.media.update({ where: { id: media.id }, data: { notifiedAt: null } });
    expect(await ctx.app.notifications.notifyNewMedia(family.id, admin.id)).toEqual({ recipients: 0, sent: 0, count: 0 });
  });

  it('formuliert Fotos und Videos korrekt', () => {
    expect(describeMedia(1, 0)).toBe('1 neues Foto');
    expect(describeMedia(3, 0)).toBe('3 neue Fotos');
    expect(describeMedia(0, 1)).toBe('1 neues Video');
    expect(describeMedia(2, 2)).toBe('2 neue Fotos und 2 neue Videos');
  });
});

describe('Push: Kommentare', () => {
  it('benachrichtigt alle Mitglieder der Familie, nicht den Autor selbst', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const oma = await ctx.createUser({ displayName: 'Oma' });
    const opa = await ctx.createUser({ displayName: 'Opa' });
    const tante = await ctx.createUser({ displayName: 'Tante' });
    for (const u of [oma, opa, tante]) await ctx.addMember(family, u, { canComment: true });
    for (const u of [admin, oma, opa, tante]) {
      await (await ctx.as(u)).post('/devices', { fcmToken: token(u.id), platform: 'android' });
    }
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());

    // Oma kommentiert → alle ausser Oma
    const c1 = (await (await ctx.as(oma)).post(`/media/${media.id}/comments`, { body: 'Herzig!' })).json();
    await ctx.app.notifications.notifyNewComment(c1.id);
    expect(ctx.push.sent.at(-1)!.tokens.sort()).toEqual([token(admin.id), token(opa.id), token(tante.id)].sort());
    expect(ctx.push.sent.at(-1)!.message).toMatchObject({ title: `Oma · ${family.name}`, body: 'Herzig!', data: { type: 'comment', mediaId: media.id } });

    // Opa kommentiert → alle ausser Opa
    const c2 = (await (await ctx.as(opa)).post(`/media/${media.id}/comments`, { body: 'x'.repeat(150) })).json();
    const outcome = await ctx.app.notifications.notifyNewComment(c2.id);
    expect(outcome.recipients).toBe(3);
    expect(ctx.push.sent.at(-1)!.tokens.sort()).toEqual([token(admin.id), token(oma.id), token(tante.id)].sort());
    expect(ctx.push.sent.at(-1)!.message.body).toMatch(/^x{97}…$/);

    // Der Uploader kommentiert selbst → alle ausser ihm
    const c3 = (await (await ctx.as(admin)).post(`/media/${media.id}/comments`, { body: 'Danke' })).json();
    await ctx.app.notifications.notifyNewComment(c3.id);
    expect(ctx.push.sent.at(-1)!.tokens.sort()).toEqual([token(oma.id), token(opa.id), token(tante.id)].sort());
  });

  it('die Route stösst den Push an (asynchron)', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const oma = await ctx.createUser();
    await ctx.addMember(family, oma, { canComment: true });
    await (await ctx.as(admin)).post('/devices', { fcmToken: token('admin'), platform: 'android' });
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());

    await (await ctx.as(oma)).post(`/media/${media.id}/comments`, { body: 'hallo' });
    await new Promise((r) => setTimeout(r, 300));
    expect(ctx.push.sent).toHaveLength(1);
    expect(ctx.push.sent[0]!.tokens).toEqual([token('admin')]);
  });
});

describe('GET /families/:id/activity', () => {
  it('zählt fremde neue Medien und Kommentare seit `since`', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const oma = await ctx.createUser();
    await ctx.addMember(family, oma, { canUpload: true, canComment: true });
    const t0 = new Date().toISOString();

    const own = await ctx.uploadAndProcess(oma, family, await makeJpeg({ color: '#aaaaaa' }));
    const foreign = await ctx.uploadAndProcess(admin, family, await makeJpeg({ color: '#bbbbbb' }));
    await ctx.upload(admin, family, await makeJpeg({ color: '#cccccc' })); // noch PROCESSING → zählt nicht
    await (await ctx.as(admin)).post(`/media/${own.id}/comments`, { body: 'schön' });
    await (await ctx.as(oma)).post(`/media/${foreign.id}/comments`, { body: 'eigener Kommentar' });

    const res = await (await ctx.as(oma)).get(`/families/${family.id}/activity?since=${encodeURIComponent(t0)}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ newMedia: 1, newComments: 1 });

    const later = await (await ctx.as(oma)).get(`/families/${family.id}/activity?since=${encodeURIComponent(res.json().serverTime)}`);
    expect(later.json()).toMatchObject({ newMedia: 0, newComments: 0 });

    expectProblem(await (await ctx.as(oma)).get(`/families/${family.id}/activity?since=gestern`), 400, 'VALIDATION_ERROR');
    const outsider = await ctx.createUser();
    expectProblem(await (await ctx.as(outsider)).get(`/families/${family.id}/activity?since=${encodeURIComponent(t0)}`), 403, 'NOT_A_MEMBER');
  });
});
