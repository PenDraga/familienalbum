import { existsSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_CHUNK_SIZE, TestContext, expectProblem, sha256 } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

const okBody = (buf: Buffer, over: Record<string, unknown> = {}) => ({
  sha256: sha256(buf),
  sizeBytes: buf.length,
  originalName: 'ferien.jpg',
  mimeType: 'image/jpeg',
  ...over,
});

describe('POST /families/:id/uploads', () => {
  it('legt eine Session mit Chunk-Aufteilung an', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ width: 400, height: 300, noise: true });
    const res = await (await ctx.as(admin)).post(`/families/${family.id}/uploads`, okBody(buf));

    expect(res.statusCode, res.body).toBe(201);
    const s = res.json();
    expect(s).toMatchObject({
      familyId: family.id,
      sha256: sha256(buf),
      sizeBytes: buf.length,
      chunkSize: TEST_CHUNK_SIZE,
      totalChunks: Math.ceil(buf.length / TEST_CHUNK_SIZE),
      receivedChunks: [],
    });
    expect(s.totalChunks).toBeGreaterThan(1);
  });

  it('verlangt canUpload', async () => {
    const { family } = await ctx.createFamilyWithAdmin();
    const viewer = await ctx.createUser();
    await ctx.addMember(family, viewer, { canDownload: true, canComment: true });
    const buf = await makeJpeg({ noise: true });
    expectProblem(await (await ctx.as(viewer)).post(`/families/${family.id}/uploads`, okBody(buf)), 403, 'PERMISSION_CANUPLOAD');
  });

  it('lehnt unbekannte Typen (z.B. HEIC) mit 415 und Hinweis ab', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const res = await (await ctx.as(admin)).post(`/families/${family.id}/uploads`, okBody(buf, { mimeType: 'image/heic' }));
    const body = expectProblem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(body.detail).toMatch(/JPEG/);
  });

  it('validiert den Hash und lehnt zu grosse Dateien ab', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const c = await ctx.as(admin);
    expectProblem(await c.post(`/families/${family.id}/uploads`, okBody(buf, { sha256: 'xyz' })), 400, 'VALIDATION_ERROR');
    expectProblem(await c.post(`/families/${family.id}/uploads`, okBody(buf, { sizeBytes: 60 * 1024 * 1024 })), 413, 'FILE_TOO_LARGE');
  });

  it('erkennt Duplikate pro Familie (409 mit mediaId), erlaubt dieselbe Datei in anderer Familie', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const media = await ctx.upload(admin, family, buf);

    const dup = await (await ctx.as(admin)).post(`/families/${family.id}/uploads`, okBody(buf));
    const body = expectProblem(dup, 409, 'DUPLICATE_MEDIA');
    expect(body.mediaId).toBe(media.id);

    const other = await ctx.createFamily();
    await ctx.addMember(other, admin, { canUpload: true });
    expect((await (await ctx.as(admin)).post(`/families/${other.id}/uploads`, okBody(buf))).statusCode).toBe(201);
  });

  it('gibt eine offene Session derselben Datei zurück (Resume)', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const c = await ctx.as(admin);
    const first = (await c.post(`/families/${family.id}/uploads`, okBody(buf))).json();
    await c.put(`/uploads/${first.id}/chunks/0`, buf.subarray(0, TEST_CHUNK_SIZE));

    const second = (await c.post(`/families/${family.id}/uploads`, okBody(buf))).json();
    expect(second.id).toBe(first.id);
    expect(second.receivedChunks).toEqual([0]);

    const get = await c.get(`/uploads/${first.id}`);
    expect(get.json().receivedChunks).toEqual([0]);
  });

  it('räumt ein soft-gelöschtes Duplikat weg und erlaubt den Neu-Upload', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const media = await ctx.uploadAndProcess(admin, family, buf);
    expect((await (await ctx.as(admin)).delete(`/media/${media.id}`)).statusCode).toBe(204);

    const again = await ctx.uploadAndProcess(admin, family, buf);
    expect(again.id).not.toBe(media.id);
    expect(await ctx.prisma.media.count({ where: { familyId: family.id } })).toBe(1);
  });
});

describe('PUT /uploads/:id/chunks/:index', () => {
  it('prüft Eigentümer, Index und Chunk-Grösse', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const other = await ctx.createUser();
    const buf = await makeJpeg({ noise: true });
    const c = await ctx.as(admin);
    const s = (await c.post(`/families/${family.id}/uploads`, okBody(buf))).json();

    const send = async (user: typeof admin, index: number, data: Buffer) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${s.id}/chunks/${index}`,
        headers: { ...(await ctx.authHeaders(user)), 'content-type': 'application/octet-stream' },
        payload: data,
      });

    expectProblem(await send(other, 0, buf.subarray(0, TEST_CHUNK_SIZE)), 404, 'UPLOAD_NOT_FOUND');
    expectProblem(await send(admin, s.totalChunks, buf.subarray(0, 10)), 400, 'CHUNK_INDEX_OUT_OF_RANGE');
    expectProblem(await send(admin, 0, buf.subarray(0, 100)), 400, 'CHUNK_SIZE_MISMATCH');
    expectProblem(await send(admin, 0, Buffer.concat([buf.subarray(0, TEST_CHUNK_SIZE), Buffer.alloc(10)])), 400, 'CHUNK_TOO_LARGE');

    const ok = await send(admin, 1, buf.subarray(TEST_CHUNK_SIZE, 2 * TEST_CHUNK_SIZE));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().receivedChunks).toEqual([1]);

    // Wiederholung ist idempotent
    await send(admin, 1, buf.subarray(TEST_CHUNK_SIZE, 2 * TEST_CHUNK_SIZE));
    expect((await c.get(`/uploads/${s.id}`)).json().receivedChunks).toEqual([1]);
  });

  it('lehnt abgelaufene Sessions ab (410)', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const c = await ctx.as(admin);
    const s = (await c.post(`/families/${family.id}/uploads`, okBody(buf))).json();
    await ctx.prisma.uploadSession.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectProblem(await c.post(`/uploads/${s.id}/complete`), 410, 'UPLOAD_EXPIRED');
  });
});

describe('POST /uploads/:id/complete', () => {
  it('verlangt alle Chunks und nennt die fehlenden', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const c = await ctx.as(admin);
    const s = (await c.post(`/families/${family.id}/uploads`, okBody(buf))).json();
    const body = expectProblem(await c.post(`/uploads/${s.id}/complete`), 400, 'CHUNKS_MISSING');
    expect(body.missing).toEqual(Array.from({ length: s.totalChunks }, (_, i) => i));
  });

  it('erkennt Hash-Fehler, verwirft die Session und legt kein Medium an', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const wrong = Buffer.from(buf);
    wrong[100] = wrong[100]! ^ 0xff;
    const c = await ctx.as(admin);
    const s = (await c.post(`/families/${family.id}/uploads`, okBody(buf))).json();
    for (let i = 0; i < s.totalChunks; i++) {
      await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${s.id}/chunks/${i}`,
        headers: { ...(await ctx.authHeaders(admin)), 'content-type': 'application/octet-stream' },
        payload: wrong.subarray(i * TEST_CHUNK_SIZE, (i + 1) * TEST_CHUNK_SIZE),
      });
    }
    expectProblem(await c.post(`/uploads/${s.id}/complete`), 400, 'HASH_MISMATCH');
    expect(await ctx.prisma.media.count()).toBe(0);
    expect(await ctx.prisma.uploadSession.count()).toBe(0);
    expect(existsSync(`${ctx.mediaRoot}/${family.id}`) ? readdirSync(`${ctx.mediaRoot}/${family.id}`) : []).toEqual([]);
  });

  it('legt das Medium an, reiht den Job ein und räumt die Session auf', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const media = await ctx.upload(admin, family, buf, { name: 'Ferien 2024.jpg', takenAt: '2024-07-01T10:00:00.000Z' });

    expect(media.status).toBe('PROCESSING');
    expect(ctx.queue.enqueued).toEqual([media.id]);
    expect(await ctx.prisma.uploadSession.count()).toBe(0);
    expect(existsSync(`${ctx.mediaRoot}/_uploads`) ? readdirSync(`${ctx.mediaRoot}/_uploads`) : []).toEqual([]);
    expect(existsSync(`${ctx.mediaRoot}/${family.id}/${media.id}/original.jpg`)).toBe(true);

    const row = await ctx.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(row).toMatchObject({ type: 'PHOTO', originalName: 'Ferien 2024.jpg', sizeBytes: buf.length, sha256: sha256(buf) });
    expect(row.takenAt.toISOString()).toBe('2024-07-01T10:00:00.000Z');
  });

  it('verwirft unplausible takenAt-Hinweise (z.B. 1970 aus dem Browser)', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const before = Date.now();
    const media = await ctx.upload(admin, family, await makeJpeg({ noise: true }), { takenAt: '1970-01-01T00:00:00.000Z' });
    const row = await ctx.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(row.takenAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('DELETE /uploads/:id bricht ab und löscht Chunks', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const buf = await makeJpeg({ noise: true });
    const c = await ctx.as(admin);
    const s = (await c.post(`/families/${family.id}/uploads`, okBody(buf))).json();
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/uploads/${s.id}/chunks/0`,
      headers: { ...(await ctx.authHeaders(admin)), 'content-type': 'application/octet-stream' },
      payload: buf.subarray(0, TEST_CHUNK_SIZE),
    });
    expect((await c.delete(`/uploads/${s.id}`)).statusCode).toBe(204);
    expect(existsSync(`${ctx.mediaRoot}/_uploads/${s.id}`)).toBe(false);
    expectProblem(await c.get(`/uploads/${s.id}`), 404, 'UPLOAD_NOT_FOUND');
  });
});
