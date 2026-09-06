import { execFile } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

export interface RecapSource {
  kind: 'photo' | 'video';
  /** Foto: thumb_1600.webp; Video: preview.mp4 */
  path: string;
  /** Video: Gesamtlänge, damit der Ausschnitt aus der Mitte kommt */
  durationSec?: number | null;
}

export interface RecapBuildOptions {
  sources: RecapSource[];
  title: string;
  subtitle: string;
  /** Abspann-Zeile, z.B. Musik-Nachweis */
  credit: string;
  photoSeconds: number;
  clipSeconds: number;
  fontPath: string;
  musicPath: string | null;
  ffmpegPath: string;
  workDir: string;
  outVideo: string;
  outPoster: string;
  log?: (msg: string, extra?: object) => void;
}

export const RECAP_W = 1920;
export const RECAP_H = 1080;
const FPS = 30;
const FADE = 0.5;
const TITLE_SECONDS = 3;
const END_SECONDS = 4;

/**
 * Baut aus Fotos und Video-Ausschnitten ein 1080p-Video: Titelkarte, jedes Foto mit sanfter Kamerafahrt
 * (Ken Burns) vor unscharfem Hintergrund, Ausschnitte aus der Mitte der Videos, weiche Überblendungen,
 * Abspann, Musik mit Ein- und Ausblendung. Alles über ffmpeg, in zwei Schritten: erst ein Segment pro
 * Medium (parallelisierbar, robust), dann ein Durchlauf, der alles überblendet und die Musik legt.
 */
export async function buildRecapVideo(opts: RecapBuildOptions): Promise<{ durationSec: number }> {
  const log = opts.log ?? (() => {});
  await mkdir(opts.workDir, { recursive: true });
  const segments: Array<{ path: string; seconds: number }> = [];

  // Titelkarte und Abspann als Bild (sharp/SVG) – unabhängig davon, ob ffmpeg drawtext kann
  const title = join(opts.workDir, 'seg_title.mp4');
  const titlePng = join(opts.workDir, 'card_title.png');
  await renderCard(titlePng, opts.fontPath, [{ text: opts.title, size: 132, color: '#2E2A3A', dy: -40 }, { text: opts.subtitle, size: 48, color: '#7C7689', dy: 90 }]);
  await stillSegment(opts, titlePng, title, TITLE_SECONDS, 'fade=t=in:st=0:d=0.6');
  segments.push({ path: title, seconds: TITLE_SECONDS });

  let i = 0;
  for (const s of opts.sources) {
    const out = join(opts.workDir, `seg_${String(i).padStart(3, '0')}.mp4`);
    try {
      if (s.kind === 'photo') {
        await photoSegment(opts, s.path, out, i);
        segments.push({ path: out, seconds: opts.photoSeconds });
      } else {
        await clipSegment(opts, s, out);
        segments.push({ path: out, seconds: opts.clipSeconds });
      }
    } catch (err) {
      // Ein kaputtes Medium soll den ganzen Rückblick nicht verhindern
      log('recap: Segment übersprungen', { path: s.path, err: (err as Error).message.split('\n')[0] });
    }
    i++;
  }
  if (segments.length < 2) throw new Error('Zu wenig verwertbare Medien für einen Rückblick.');

  const end = join(opts.workDir, 'seg_end.mp4');
  const endPng = join(opts.workDir, 'card_end.png');
  await renderCard(endPng, opts.fontPath, [
    { text: 'Familienalbum', size: 110, color: '#2E2A3A', dy: -50 },
    { text: opts.subtitle, size: 46, color: '#7C7689', dy: 60 },
    ...(opts.credit ? [{ text: opts.credit, size: 26, color: '#7C7689', dy: RECAP_H / 2 - 80 }] : []),
  ]);
  await stillSegment(opts, endPng, end, END_SECONDS, `fade=t=out:st=${END_SECONDS - 1}:d=1`);
  segments.push({ path: end, seconds: END_SECONDS });

  // Überblenden: xfade-Kette, Offsets = Summe der Längen minus die bereits verbrauchten Überblendungen
  const args = [...base()];
  for (const s of segments) args.push('-i', s.path);
  const hasMusic = !!opts.musicPath;
  if (hasMusic) args.push('-stream_loop', '-1', '-i', opts.musicPath!);

  const total = segments.reduce((sum, s) => sum + s.seconds, 0) - FADE * (segments.length - 1);
  const filters: string[] = [];
  let prev = '[0:v]';
  let offset = 0;
  for (let k = 1; k < segments.length; k++) {
    offset += segments[k - 1]!.seconds - FADE;
    const label = k === segments.length - 1 ? '[vout]' : `[v${k}]`;
    filters.push(`${prev}[${k}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label}`);
    prev = label;
  }
  if (hasMusic) {
    filters.push(
      `[${segments.length}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=2,afade=t=out:st=${(total - 3).toFixed(3)}:d=3,volume=0.9[aout]`,
    );
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (hasMusic) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  args.push('-t', total.toFixed(3), ...encode(), '-movflags', '+faststart', opts.outVideo);
  await run(opts.ffmpegPath, args, 20 * 60_000);

  // Poster: erstes Foto nach der Titelkarte
  await run(opts.ffmpegPath, [...base(), '-ss', String(TITLE_SECONDS + 0.8), '-i', opts.outVideo, '-frames:v', '1', '-q:v', '3', opts.outPoster]);

  // Segmente aufräumen (Arbeitsordner bleibt dem Aufrufer)
  for (const f of await readdir(opts.workDir)) {
    if (f.startsWith('seg_')) await rm(join(opts.workDir, f), { force: true });
  }
  return { durationSec: Math.round(total * 10) / 10 };
}

/** Foto: unscharfer Hintergrund füllt das Format, das Bild liegt scharf darüber, dazu Zoom/Schwenk. */
async function photoSegment(opts: RecapBuildOptions, path: string, out: string, index: number) {
  const frames = Math.round(opts.photoSeconds * FPS);
  // Abwechslung: hinein / hinaus zoomen, leicht versetzt schwenken
  const zoomIn = index % 2 === 0;
  const zoom = zoomIn ? `min(1+0.0011*on,1.14)` : `max(1.14-0.0011*on,1)`;
  const x = index % 4 < 2 ? `iw/2-(iw/zoom/2)` : `(iw-iw/zoom)*${((index % 4) - 1) / 2}`;
  const filter = [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${RECAP_W}:${RECAP_H}:force_original_aspect_ratio=increase,crop=${RECAP_W}:${RECAP_H},gblur=sigma=28,eq=brightness=-0.06:saturation=0.9[bgb]`,
    `[fg]scale=${RECAP_W}:${RECAP_H}:force_original_aspect_ratio=decrease[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,zoompan=z='${zoom}':x='${x}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${RECAP_W}x${RECAP_H}:fps=${FPS},format=yuv420p[v]`,
  ].join(';');
  await run(opts.ffmpegPath, [...base(), '-i', path, '-filter_complex', filter, '-map', '[v]', '-t', String(opts.photoSeconds), ...encode(), out]);
}

/** Video: Ausschnitt aus der Mitte, gleiche Bildkomposition, ohne Originalton (die Musik trägt). */
async function clipSegment(opts: RecapBuildOptions, s: RecapSource, out: string) {
  const dur = s.durationSec ?? opts.clipSeconds;
  const start = Math.max(0, dur / 2 - opts.clipSeconds / 2);
  const filter = [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${RECAP_W}:${RECAP_H}:force_original_aspect_ratio=increase,crop=${RECAP_W}:${RECAP_H},gblur=sigma=28,eq=brightness=-0.06:saturation=0.9[bgb]`,
    `[fg]scale=${RECAP_W}:${RECAP_H}:force_original_aspect_ratio=decrease[fgs]`,
    // kürzere Videos mit dem letzten Bild auffüllen, damit die Überblendungen aufgehen
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,fps=${FPS},tpad=stop_mode=clone:stop_duration=${opts.clipSeconds},format=yuv420p[v]`,
  ].join(';');
  await run(opts.ffmpegPath, [
    ...base(),
    '-ss', start.toFixed(2), '-t', String(opts.clipSeconds), '-i', s.path,
    '-filter_complex', filter, '-map', '[v]', '-an', '-t', String(opts.clipSeconds),
    ...encode(),
    out,
  ]);
}

/** Standbild (Titel/Abspann) als Segment mit exakter Länge. */
async function stillSegment(opts: RecapBuildOptions, png: string, out: string, seconds: number, extraFilter: string) {
  await run(opts.ffmpegPath, [
    ...base(),
    '-loop', '1', '-framerate', String(FPS), '-t', String(seconds), '-i', png,
    '-vf', `scale=${RECAP_W}:${RECAP_H},${extraFilter},format=yuv420p`,
    '-t', String(seconds),
    ...encode(),
    out,
  ]);
}

interface CardLine {
  text: string;
  size: number;
  color: string;
  /** vertikaler Versatz zur Mitte */
  dy: number;
}

/** Vanille-Karte mit zentriertem Text in der App-Schrift (Baloo 2), als PNG. */
async function renderCard(out: string, fontPath: string, lines: CardLine[]) {
  const family = 'Baloo 2';
  const text = lines
    .map((l) => `<text x="50%" y="${RECAP_H / 2 + l.dy}" text-anchor="middle" dominant-baseline="middle" font-family="'${family}', 'Nunito', 'Helvetica', sans-serif" font-weight="700" font-size="${l.size}" fill="${l.color}">${escapeXml(l.text)}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RECAP_W}" height="${RECAP_H}">
  <style>@font-face { font-family: '${family}'; src: url('file://${fontPath}'); }</style>
  <rect width="100%" height="100%" fill="#FFF8E7"/>
  <circle cx="${RECAP_W - 160}" cy="${RECAP_H + 60}" r="260" fill="#BFE9E3" opacity="0.7"/>
  <circle cx="120" cy="-40" r="200" fill="#FFECB3" opacity="0.8"/>
  <circle cx="${RECAP_W - 80}" cy="120" r="110" fill="#FFD6C9" opacity="0.7"/>
  ${text}
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
}

function escapeXml(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function base() {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin'];
}

function encode() {
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
}

async function run(ffmpeg: string, args: string[], timeout = 5 * 60_000) {
  try {
    await execFileAsync(ffmpeg, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    const reason = (e.stderr ?? '').trim().split('\n').filter(Boolean).slice(-2).join(' | ') || e.message;
    throw new Error(`ffmpeg: ${reason}`);
  }
}
