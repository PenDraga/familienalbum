import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

describe('GET /media/:id/info', () => {
  it('liefert Kamera- und Belichtungsdaten aus dem EXIF sowie Dateiinfos', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg({ camera: true, takenAt: '2024:06:01 10:00:00' }), { name: 'kamera.jpg' });

    const res = await (await ctx.as(admin)).get(`/media/${media.id}/info`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      originalName: 'kamera.jpg',
      mimeType: 'image/jpeg',
      exif: { make: 'TestCam', model: 'X1', lens: 'Test 26mm', fNumber: 1.8, exposureTime: 0.004, iso: 400, focalLength: 26 },
    });
    expect(res.json().exif.originalDateTime).toBe('2024-06-01T10:00:00.000Z');
  });

  it('liest EXIF für ältere Medien ohne gespeicherten Auszug nach', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg({ camera: true }));
    await ctx.prisma.media.update({ where: { id: media.id }, data: { exif: Prisma_DbNull() } });

    const res = await (await ctx.as(admin)).get(`/media/${media.id}/info`);
    expect(res.json().exif.make).toBe('TestCam');
    expect((await ctx.prisma.media.findUniqueOrThrow({ where: { id: media.id } })).exif).toMatchObject({ make: 'TestCam' });
  });

  it('nur für Mitglieder', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
    expectProblem(await (await ctx.as(await ctx.createUser())).get(`/media/${media.id}/info`), 403, 'NOT_A_MEMBER');
  });
});

describe('PATCH /media/:id takenAt', () => {
  it('verschiebt das Medium in einen anderen Monat', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg({ takenAt: '2024:06:01 10:00:00' }));

    const res = await (await ctx.as(admin)).patch(`/media/${media.id}`, { takenAt: '2023-12-24T18:00:00.000Z' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().takenAt).toBe('2023-12-24T18:00:00.000Z');
    expect(res.json().caption).toBeNull();

    const timeline = (await (await ctx.as(admin)).get(`/families/${family.id}/timeline`)).json();
    expect(timeline.groups[0].month).toBe('2023-12');
  });

  it('verlangt Uploader oder Familien-Admin und mindestens ein Feld', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const other = await ctx.createUser();
    await ctx.addMember(family, other, { canUpload: true });
    const media = await ctx.uploadAndProcess(admin, family, await makeJpeg());
    expectProblem(await (await ctx.as(other)).patch(`/media/${media.id}`, { takenAt: '2023-12-24T18:00:00.000Z' }), 403, 'NOT_OWNER');
    expectProblem(await (await ctx.as(admin)).patch(`/media/${media.id}`, {}), 400, 'VALIDATION_ERROR');
  });
});

describe('POST /families/:id/media/taken-at', () => {
  it('verschiebt mehrere Medien um einen Betrag und überspringt fremde', async () => {
    const { family, admin } = await ctx.createFamilyWithAdmin();
    const other = await ctx.createUser();
    await ctx.addMember(family, other, { canUpload: true });
    const a = await ctx.uploadAndProcess(admin, family, await makeJpeg({ color: '#111111' }), { takenAt: '2024-06-01T10:00:00.000Z' });
    const b = await ctx.uploadAndProcess(admin, family, await makeJpeg({ color: '#222222' }), { takenAt: '2024-06-02T10:00:00.000Z' });
    const foreign = await ctx.uploadAndProcess(other, family, await makeJpeg({ color: '#333333' }), { takenAt: '2024-06-03T10:00:00.000Z' });

    // Als Mitglied ohne Admin: nur eigenes Medium
    const asOther = await (await ctx.as(other)).post(`/families/${family.id}/media/taken-at`, { ids: [a.id, foreign.id], shiftSeconds: 3600 });
    expect(asOther.statusCode, asOther.body).toBe(200);
    expect(asOther.json()).toEqual({ updated: 1, skipped: [a.id] });
    expect((await ctx.prisma.media.findUniqueOrThrow({ where: { id: foreign.id } })).takenAt.toISOString()).toBe('2024-06-03T11:00:00.000Z');

    // Als Familien-Admin: alle, feste Zeit
    const asAdmin = await (await ctx.as(admin)).post(`/families/${family.id}/media/taken-at`, { ids: [a.id, b.id], takenAt: '2022-01-01T12:00:00.000Z' });
    expect(asAdmin.json()).toEqual({ updated: 2, skipped: [] });
    expect((await ctx.prisma.media.findUniqueOrThrow({ where: { id: b.id } })).takenAt.toISOString()).toBe('2022-01-01T12:00:00.000Z');

    expectProblem(
      await (await ctx.as(admin)).post(`/families/${family.id}/media/taken-at`, { ids: [a.id], takenAt: '2022-01-01T12:00:00.000Z', shiftSeconds: 5 }),
      400,
      'VALIDATION_ERROR',
    );
  });
});

// Prisma-DbNull ohne direkten Import im Test (nur für das Zurücksetzen des Feldes)
function Prisma_DbNull() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@prisma/client') as typeof import('@prisma/client')).Prisma.DbNull;
}
