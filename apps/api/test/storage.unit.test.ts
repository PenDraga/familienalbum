// Unit-Test ohne Datenbank: MediaStorage.remove muss nicht-leere Verzeichnisse und fehlende Pfade
// sauber behandeln (Unraid/FUSE meldete ENOTEMPTY beim Löschen von Medien-Verzeichnissen).
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaStorage } from '../src/lib/storage.js';

let root: string;
let storage: MediaStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fa-storage-'));
  storage = new MediaStorage(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('MediaStorage.remove', () => {
  it('löscht ein Medien-Verzeichnis samt Inhalt und Unterordnern', async () => {
    const dir = storage.mediaDir('fam', 'med');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(join(dir, 'original.jpg'), 'x');
    await writeFile(join(dir, 'thumb_400.webp'), 'y');
    await writeFile(join(dir, 'nested', 'tmp'), 'z');

    await storage.remove(dir);

    expect(await exists(dir)).toBe(false);
  });

  it('ignoriert einen bereits fehlenden Pfad', async () => {
    await expect(storage.remove(storage.mediaDir('fam', 'gibt-es-nicht'))).resolves.toBeUndefined();
  });

  it('removeQuietly liefert den Fehler zurück statt zu werfen', async () => {
    const dir = storage.mediaDir('fam', 'med');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'original.jpg'), 'x');

    expect(await storage.removeQuietly(dir)).toBeNull();
    expect(await exists(dir)).toBe(false);
    // Datei statt Verzeichnis als Wurzel: rm mit force akzeptiert das ebenfalls ohne Fehler
    expect(await storage.removeQuietly(join(root, 'nicht-da'))).toBeNull();
  });
});
