import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestContext } from './helpers/app.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(() => ctx.close());

describe('GET /meta', () => {
  it('ist öffentlich und liefert Version und Betreiber (leer, wenn nicht gesetzt)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Familienalbum');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(body.operator).toEqual({ name: null, email: null });
  });
});
