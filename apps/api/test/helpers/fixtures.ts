import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

/**
 * Erzeugt ein JPEG mit optionalem EXIF-Aufnahmedatum und Orientierung.
 * `noise: true` liefert ein schlecht komprimierbares Bild (mehrere Upload-Chunks).
 */
export async function makeJpeg(
  opts: { width?: number; height?: number; takenAt?: string; orientation?: number; color?: string; noise?: boolean; camera?: boolean } = {},
) {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  let img = (
    opts.noise
      ? sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
      : sharp({ create: { width, height, channels: 3, background: opts.color ?? '#3366cc' } })
  ).jpeg({ quality: 80 });

  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  if (opts.camera) {
    img = img.withExifMerge({
      IFD0: { Make: 'TestCam', Model: 'X1' },
      IFD2: { FNumber: '18/10', ExposureTime: '1/250', ISOSpeedRatings: '400', FocalLength: '26/1', LensModel: 'Test 26mm' },
    });
  }
  if (opts.takenAt) img = img.withExifMerge({ IFD2: { DateTimeOriginal: opts.takenAt } }); // "YYYY:MM:DD HH:MM:SS"

  return img.toBuffer();
}

export async function makePng(width = 64, height = 48) {
  return sharp({ create: { width, height, channels: 4, background: '#ff000080' } }).png().toBuffer();
}

let ffmpegAvailable: boolean | undefined;
export function hasFfmpeg(): boolean {
  if (ffmpegAvailable === undefined) {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      ffmpegAvailable = true;
    } catch {
      ffmpegAvailable = false;
    }
  }
  return ffmpegAvailable;
}

/** Kurzes Testvideo (2 s, 320x240, mit Ton) per ffmpeg. */
export function makeMp4(seconds = 2): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'fa-video-'));
  const out = join(dir, 'test.mp4');
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=320x240:rate=15`,
        '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        '-metadata', 'creation_time=2024-03-04T05:06:07Z',
        out,
      ],
      { stdio: 'ignore' },
    );
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
