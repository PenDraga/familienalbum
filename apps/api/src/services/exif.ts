import exifReader from 'exif-reader';
import type { FfprobeData } from 'fluent-ffmpeg';
import sharp from 'sharp';

/** Anzeigbare Aufnahme-Metadaten (Auszug aus EXIF bzw. Video-Tags). Alles optional. */
export interface ExifSummary {
  [key: string]: unknown;
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  /** Blende, z.B. 1.8 */
  fNumber?: number;
  /** Belichtungszeit in Sekunden, z.B. 0.004 */
  exposureTime?: number;
  iso?: number;
  /** Brennweite in mm */
  focalLength?: number;
  /** Kleinbild-äquivalente Brennweite in mm */
  focalLength35?: number;
  orientation?: number;
  /** Original-Aufnahmezeit laut Datei (ISO), unabhängig von takenAt in der DB */
  originalDateTime?: string;
  gps?: { lat: number; lon: number; alt?: number };
}

type Rational = number | { numerator?: number; denominator?: number } | undefined;

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  const r = v as Rational;
  if (r && typeof r === 'object' && r.numerator !== undefined && r.denominator) return r.numerator / r.denominator;
  return undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\0/g, '').trim();
  return t.length ? t : undefined;
}

function dms(parts: unknown, ref: unknown): number | undefined {
  if (!Array.isArray(parts) || parts.length < 2) return undefined;
  const [d, m, s] = parts.map((p) => num(p) ?? 0);
  const value = d! + m! / 60 + (s ?? 0) / 3600;
  return ref === 'S' || ref === 'W' ? -value : value;
}

/** EXIF aus einer Bilddatei lesen (sharp liefert den rohen EXIF-Block, exif-reader parst ihn). */
export async function readPhotoExif(path: string): Promise<ExifSummary | null> {
  const meta = await sharp(path, { failOn: 'none' }).metadata();
  if (!meta.exif) return null;
  try {
    const raw = exifReader(meta.exif) as unknown as Record<string, Record<string, unknown> | undefined>;
    const image = raw.Image ?? {};
    const photo = raw.Photo ?? raw.exif ?? {};
    const gps = raw.GPSInfo ?? raw.gps ?? {};
    const out: ExifSummary = {
      make: str(image.Make),
      model: str(image.Model),
      lens: str(photo.LensModel),
      software: str(image.Software),
      fNumber: num(photo.FNumber),
      exposureTime: num(photo.ExposureTime),
      iso: num(photo.ISOSpeedRatings ?? photo.PhotographicSensitivity),
      focalLength: num(photo.FocalLength),
      focalLength35: num(photo.FocalLengthIn35mmFilm),
      orientation: num(image.Orientation),
    };
    const dto = photo.DateTimeOriginal ?? photo.DateTimeDigitized ?? image.DateTime;
    if (dto instanceof Date && !Number.isNaN(dto.getTime())) out.originalDateTime = dto.toISOString();
    const lat = dms(gps.GPSLatitude, gps.GPSLatitudeRef);
    const lon = dms(gps.GPSLongitude, gps.GPSLongitudeRef);
    if (lat !== undefined && lon !== undefined) {
      out.gps = { lat: round(lat, 6), lon: round(lon, 6) };
      const alt = num(gps.GPSAltitude);
      if (alt !== undefined) out.gps.alt = round(alt, 1);
    }
    return compact(out);
  } catch {
    return null;
  }
}

/** Aufnahme-Metadaten aus Video-Tags (QuickTime/MP4, v.a. iPhone). */
export function readVideoExif(probe: FfprobeData): ExifSummary | null {
  const tags = (probe.format.tags ?? {}) as Record<string, unknown>;
  const get = (...keys: string[]) => keys.map((k) => str(tags[k])).find((v) => v !== undefined);
  const out: ExifSummary = {
    make: get('com.apple.quicktime.make', 'make'),
    model: get('com.apple.quicktime.model', 'model'),
    software: get('com.apple.quicktime.software', 'software', 'encoder'),
  };
  const created = get('com.apple.quicktime.creationdate', 'creation_time');
  if (created) {
    const d = new Date(created);
    if (!Number.isNaN(d.getTime())) out.originalDateTime = d.toISOString();
  }
  // ISO 6709, z.B. "+47.3769+008.5417+430.000/"
  const loc = get('com.apple.quicktime.location.ISO6709', 'location');
  const m = loc ? /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?/.exec(loc) : null;
  if (m) {
    out.gps = { lat: round(Number(m[1]), 6), lon: round(Number(m[2]), 6) };
    if (m[3]) out.gps.alt = round(Number(m[3]), 1);
  }
  const result = compact(out);
  return Object.keys(result).length ? result : null;
}

function round(v: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;
}
