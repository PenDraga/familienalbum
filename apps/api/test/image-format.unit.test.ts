// Unit-Test ohne Datenbank: Container-Erkennung an den ersten Bytes (Dateiendung vom Client ist unzuverlässig).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sniffImageContainer, sniffImageFile } from '../src/lib/image-format.js';

function bmff(major: string, ...compatible: string[]) {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  return Buffer.concat([Buffer.from([0, 0, 0, size]), Buffer.from('ftyp'), Buffer.from(brands, 'latin1'), Buffer.alloc(16)]);
}

describe('sniffImageContainer', () => {
  it('erkennt JPEG, PNG, GIF und WebP', () => {
    expect(sniffImageContainer(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]))).toBe('jpeg');
    expect(sniffImageContainer(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).toBe('png');
    expect(sniffImageContainer(Buffer.from('GIF89a', 'latin1'))).toBe('gif');
    expect(sniffImageContainer(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('webp');
  });

  it('erkennt HEIC/HEIF und AVIF am ftyp-Brand', () => {
    expect(sniffImageContainer(bmff('heic', 'mif1', 'heix'))).toBe('heif');
    expect(sniffImageContainer(bmff('mif1', 'heic'))).toBe('heif');
    expect(sniffImageContainer(bmff('avif', 'mif1'))).toBe('avif');
    // unbekannter Major-Brand, AVIF nur als kompatibler Brand
    expect(sniffImageContainer(bmff('xxxx', 'avif'))).toBe('avif');
  });

  it('liefert unknown für Fremdformate und leere Eingaben', () => {
    expect(sniffImageContainer(new Uint8Array())).toBe('unknown');
    expect(sniffImageContainer(Buffer.from('%PDF-1.7'))).toBe('unknown');
  });
});

describe('sniffImageFile', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fa-format-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('liest die Kennung aus der Datei – "FullSizeRender.heic" mit JPEG-Inhalt ist JPEG', async () => {
    const path = join(dir, 'FullSizeRender.heic');
    await writeFile(path, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]));
    expect(await sniffImageFile(path)).toBe('jpeg');
  });

  it('erkennt eine echte HEIC-Datei', async () => {
    const path = join(dir, 'echt.heic');
    await writeFile(path, bmff('heic', 'mif1'));
    expect(await sniffImageFile(path)).toBe('heif');
  });
});
