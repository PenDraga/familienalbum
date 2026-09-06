import { open } from 'node:fs/promises';

export type ImageContainer = 'jpeg' | 'png' | 'gif' | 'webp' | 'heif' | 'avif' | 'unknown';

/** ISO-BMFF-Brands, die libheif als HEIF/HEIC dekodiert (Bilder und Bildsequenzen). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/**
 * Erkennt das Container-Format an den ersten Bytes. Dateiendung und MIME-Typ vom Client sind unzuverlässig:
 * iOS liefert bearbeitete Fotos als "FullSizeRender.heic", obwohl die Datei oft ein JPEG ist.
 */
export function sniffImageContainer(head: Uint8Array): ImageContainer {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 3) === 'PNG') return 'png';
  if (head.length >= 6 && ascii(head, 0, 3) === 'GIF') return 'gif';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp';
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') {
    const major = ascii(head, 8, 4);
    if (AVIF_BRANDS.has(major)) return 'avif';
    if (HEIF_BRANDS.has(major)) return 'heif';
    // Major-Brand unbekannt → kompatible Brands ab Byte 16 prüfen
    for (let i = 16; i + 4 <= head.length; i += 4) {
      const brand = ascii(head, i, 4);
      if (AVIF_BRANDS.has(brand)) return 'avif';
      if (HEIF_BRANDS.has(brand)) return 'heif';
    }
    return 'heif';
  }
  return 'unknown';
}

export async function sniffImageFile(path: string): Promise<ImageContainer> {
  const fh = await open(path, 'r');
  try {
    const buf = new Uint8Array(64);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return sniffImageContainer(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  let s = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}
