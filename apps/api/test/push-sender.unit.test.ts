// Unit-Test ohne Datenbank: Ein kaputter FIREBASE_SERVICE_ACCOUNT darf den Start nicht abbrechen.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NoopPushSender, createPushSender } from '../src/services/push.js';

let dir: string;
const logged: Array<{ o: object; msg: string }> = [];
const log = { error: (o: object, msg: string) => void logged.push({ o, msg }) };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fa-push-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createPushSender', () => {
  it('ohne Konfiguration: Noop, kein Log', () => {
    logged.length = 0;
    expect(createPushSender(undefined, log)).toBeInstanceOf(NoopPushSender);
    expect(createPushSender('', log)).toBeInstanceOf(NoopPushSender);
    expect(logged).toHaveLength(0);
  });

  it('fehlende Datei: Noop mit Hinweis auf den Container-Pfad', () => {
    logged.length = 0;
    const sender = createPushSender(join(dir, 'gibt-es-nicht.json'), log);
    expect(sender).toBeInstanceOf(NoopPushSender);
    expect(sender.enabled).toBe(false);
    expect(logged).toHaveLength(1);
    expect((logged[0]!.o as { reason: string }).reason).toContain('nicht gefunden');
  });

  it('falscher Inhalt (kein Dienstkonto): Noop mit Grund', async () => {
    logged.length = 0;
    const path = join(dir, 'falsch.json');
    await writeFile(path, JSON.stringify({ apiKey: 'AIza…', appId: '1:2:ios:3' }));
    expect(createPushSender(path, log)).toBeInstanceOf(NoopPushSender);
    expect((logged[0]!.o as { reason: string }).reason).toContain('project_id');
  });

  it('kaputtes JSON: Noop statt Absturz', async () => {
    logged.length = 0;
    const path = join(dir, 'kaputt.json');
    await writeFile(path, '{ nicht json');
    expect(createPushSender(path, log)).toBeInstanceOf(NoopPushSender);
    expect(logged).toHaveLength(1);
  });
});
