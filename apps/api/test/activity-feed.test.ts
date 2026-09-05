import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, expectProblem } from './helpers/app.js';
import { makeJpeg } from './helpers/fixtures.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.resetDb());

async function setup() {
  const { family, admin } = await ctx.createFamilyWithAdmin();
  const other = await ctx.createUser({ displayName: 'Anna' });
  await ctx.addMember(family, other, { canComment: true, canUpload: true });
  const a = await ctx.uploadAndProcess(admin, family, await makeJpeg({ color: '#101010' }));
  const b = await ctx.uploadAndProcess(admin, family, await makeJpeg({ color: '#202020' }));
  const comment = await (await ctx.as(other)).post(`/media/${a.id}/comments`, { body: 'So süss!  Wann war das?' });
  expect(comment.statusCode, comment.body).toBe(201);
  return { family, admin, other, a, b, commentId: comment.json().id as string };
}

describe('GET /families/:id/activity/feed', () => {
  it('fasst Uploads derselben Person zu einer Serie zusammen und listet Kommentare, neueste zuerst', async () => {
    const { family, admin, other, a, b, commentId } = await setup();

    const res = await (await ctx.as(admin)).get(`/families/${family.id}/activity/feed`);
    expect(res.statusCode, res.body).toBe(200);
    const { items, nextCursor } = res.json();
    expect(nextCursor).toBeNull();
    expect(items).toHaveLength(2);

    expect(items[0]).toMatchObject({
      id: `comment-${commentId}`,
      type: 'COMMENT',
      actor: { id: other.id, displayName: 'Anna' },
      mine: false,
      unread: true,
      comment: { id: commentId, body: 'So süss! Wann war das?', mediaId: a.id },
    });
    expect(items[0].media[0].id).toBe(a.id);
    expect(items[0].media[0].thumb400).toContain(`/media/${a.id}/thumb/400?`);

    expect(items[1]).toMatchObject({ id: `upload-${b.id}`, type: 'UPLOAD', mine: true, unread: false, count: 2, photos: 2, videos: 0 });
    expect(items[1].media.map((m: { id: string }) => m.id)).toEqual([b.id, a.id]);

    // Aus Sicht des anderen Mitglieds: Upload fremd und ungelesen, eigener Kommentar nicht
    const asOther = (await (await ctx.as(other)).get(`/families/${family.id}/activity/feed`)).json();
    expect(asOther.items[0]).toMatchObject({ type: 'COMMENT', mine: true, unread: false });
    expect(asOther.items[1]).toMatchObject({ type: 'UPLOAD', mine: false, unread: true });
  });

  it('paginiert über den Zeitpunkt', async () => {
    const { family, admin, b } = await setup();
    const first = (await (await ctx.as(admin)).get(`/families/${family.id}/activity/feed?limit=1`)).json();
    expect(first.items).toHaveLength(1);
    expect(first.items[0].type).toBe('COMMENT');
    expect(first.nextCursor).not.toBeNull();

    const second = (await (await ctx.as(admin)).get(`/families/${family.id}/activity/feed?limit=1&cursor=${first.nextCursor}`)).json();
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).toBe(`upload-${b.id}`);
    expect(second.nextCursor).toBeNull();

    expectProblem(await (await ctx.as(admin)).get(`/families/${family.id}/activity/feed?cursor=xyz`), 400, 'INVALID_CURSOR');
  });

  it('nur für Mitglieder', async () => {
    const { family } = await setup();
    expectProblem(await (await ctx.as(await ctx.createUser())).get(`/families/${family.id}/activity/feed`), 403, 'NOT_A_MEMBER');
  });
});

describe('Ungelesen-Zähler und „gesehen“', () => {
  it('zählt ab Beitritt, nach POST seen ab jetzt', async () => {
    const { family, admin, other } = await setup();

    // Admin: nur der fremde Kommentar ist neu
    const before = (await (await ctx.as(admin)).get(`/families/${family.id}/activity`)).json();
    expect(before).toMatchObject({ newMedia: 0, newComments: 1 });

    // Anna: beide Uploads sind fremd
    const forOther = (await (await ctx.as(other)).get(`/families/${family.id}/activity`)).json();
    expect(forOther).toMatchObject({ newMedia: 2, newComments: 0 });

    const seen = await (await ctx.as(other)).post(`/families/${family.id}/activity/seen`);
    expect(seen.statusCode, seen.body).toBe(200);
    const after = (await (await ctx.as(other)).get(`/families/${family.id}/activity`)).json();
    expect(after).toMatchObject({ newMedia: 0, newComments: 0, since: seen.json().seenAt });

    const feed = (await (await ctx.as(other)).get(`/families/${family.id}/activity/feed`)).json();
    expect(feed.items.every((i: { unread: boolean }) => i.unread === false)).toBe(true);
    expect(feed.seenAt).toBe(seen.json().seenAt);
  });

  it('explizites since funktioniert weiterhin', async () => {
    const { family, admin } = await setup();
    const res = (await (await ctx.as(admin)).get(`/families/${family.id}/activity?since=${encodeURIComponent(new Date().toISOString())}`)).json();
    expect(res).toMatchObject({ newMedia: 0, newComments: 0 });
  });
});
