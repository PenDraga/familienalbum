/**
 * Fotobuch-Renderer: jede Seite wird mit sharp als Bild gerastert, daraus entstehen das PDF (eine JPEG-Seite pro
 * Blatt, pdfkit) und die WebP-Seitenvorschauen. Ein Zeichenweg für beides.
 *
 * Texte laufen über Pango (sharp `text` mit `rgba`), nicht über SVG: nur so kommen Emojis farbig ins Buch
 * (Schrift «Noto Color Emoji» im Server-Image), und Pango bricht Zeilen nach echter Textbreite um.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import sharp, { type OverlayOptions } from 'sharp';
import { coverRects, FORMATS, pageSize, photoRects, textRect, type BookFormat, type BookPage, type FormatSpec, type PageItem, type Rect } from './book-layout.js';

export interface RenderEnv {
  /** Auflösung der Druckseiten (Produktion 300) */
  dpi: number;
  /** Breite der Seitenvorschau in Pixeln */
  previewWidth: number;
  /** Pfad zur Bilddatei eines Fotos (Original oder Thumbnail); null = überspringen */
  photoPath: (mediaId: string) => Promise<string | null>;
  log?: (msg: string, extra?: object) => void;
}

export interface RenderOutput {
  pdfPath: string;
  pageDir: string;
}

const COLORS = {
  paper: '#FFFFFF',
  cream: '#FFF6E9',
  ink: '#2E2A3A',
  muted: '#7C7689',
  accent: '#E8694A',
};
const FONT_DISPLAY = 'Baloo 2';
const FONT_BODY = 'Nunito';
/** Im Docker-Image liegen die Schriften auch im System (fontconfig); lokal (Tests, Mac) lädt sharp sie aus der Datei. */
const FONT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'assets', 'fonts');
const BODY_FONT_FILE = join(FONT_DIR, 'Nunito-Regular.ttf');

export function previewFileName(index: number) {
  return `page_${String(index + 1).padStart(3, '0')}.webp`;
}

/** Rendert alle Seiten; liefert Seitenzahl und PDF-Grösse. */
export async function renderBook(pages: BookPage[], format: BookFormat, env: RenderEnv, out: RenderOutput): Promise<{ pageCount: number; pdfBytes: number }> {
  const spec = FORMATS[format];
  const size = pageSize(spec);
  const px = (mm: number) => Math.round((mm / 25.4) * env.dpi);
  const pt = (mm: number) => (mm / 25.4) * 72;
  await mkdir(out.pageDir, { recursive: true });

  const doc = new PDFDocument({ autoFirstPage: false, info: { Title: 'Familienalbum', Producer: 'Familienalbum' }, compress: true });
  const stream = createWriteStream(out.pdfPath);
  doc.pipe(stream);

  const W = px(size.w);
  const H = px(size.h);
  for (let i = 0; i < pages.length; i++) {
    const jpeg = await renderPage(pages[i]!, spec, { W, H, px, env });
    doc.addPage({ size: [pt(size.w), pt(size.h)], margin: 0 });
    doc.image(jpeg, 0, 0, { width: pt(size.w), height: pt(size.h) });
    await sharp(jpeg).resize({ width: env.previewWidth }).webp({ quality: 78 }).toFile(join(out.pageDir, previewFileName(i)));
  }
  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.once('finish', () => resolve());
    stream.once('error', reject);
  });
  const { size: pdfBytes } = await stat(out.pdfPath);
  return { pageCount: pages.length, pdfBytes };
}

interface Canvas {
  W: number;
  H: number;
  px: (mm: number) => number;
  env: RenderEnv;
}

type Layer = OverlayOptions;

async function renderPage(page: BookPage, spec: FormatSpec, c: Canvas): Promise<Buffer> {
  const layers: Layer[] = [];
  let background = COLORS.paper;
  const size = pageSize(spec);

  if (page.type === 'cover') {
    background = COLORS.cream;
    const { photo, band } = coverRects(spec);
    if (page.mediaId) {
      const layer = await photoLayer(page.mediaId, photo, 'cover', c);
      if (layer) layers.push(layer);
    }
    layers.push(...(await coverBandLayers(toPx(band, c.px), page.title, page.subtitle, c)));
  } else if (page.type === 'chapter') {
    background = COLORS.cream;
    layers.push(...(await chapterLayers(toPx({ x: 0, y: 0, w: size.w, h: size.h }, c.px), page.title, page.subtitle, c)));
  } else {
    const rects = photoRects(spec, page.template, page.items.length, page.items.map((i) => i.aspect ?? 1.5));
    for (let i = 0; i < page.items.length; i++) {
      const r = rects[i];
      if (!r) break;
      const layer = await photoLayer(page.items[i]!.mediaId, r, r.fit, c);
      if (layer) layers.push(layer);
    }
    const tr = textRect(spec, page.template);
    if (tr && !page.hideText) {
      const layer = await textBlockLayer(toPx(tr, c.px), page.items[0]!, c);
      if (layer) layers.push(layer);
    }
  }

  return sharp({ create: { width: c.W, height: c.H, channels: 3, background } })
    .composite(layers)
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

function toPx(r: Rect, px: (mm: number) => number): Rect {
  return { x: px(r.x), y: px(r.y), w: Math.max(1, px(r.w)), h: Math.max(1, px(r.h)) };
}

/** Foto in ein Rechteck: `cover` füllt und beschneidet mittig, `contain` passt ein und zentriert. */
async function photoLayer(mediaId: string, rect: Rect, fit: 'cover' | 'contain', c: Canvas): Promise<Layer | null> {
  const path = await c.env.photoPath(mediaId);
  if (!path) return null;
  const r = toPx(rect, c.px);
  try {
    const image = sharp(path, { failOn: 'none', animated: false }).rotate();
    const buf = await image
      .resize({ width: r.w, height: r.h, fit: fit === 'cover' ? 'cover' : 'inside', position: 'centre', withoutEnlargement: false })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });
    // bei contain zentrieren
    const left = r.x + Math.round((r.w - buf.info.width) / 2);
    const top = r.y + Math.round((r.h - buf.info.height) / 2);
    return { input: buf.data, left, top };
  } catch (err) {
    c.env.log?.('book: Foto übersprungen', { mediaId, err: (err as Error).message.split('\n')[0] });
    return null;
  }
}

/** Pango-Markup: nur &, <, > maskieren (Emojis und Umlaute bleiben, wie sie sind). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(text: string, o: { size: number; color: string; family?: string; weight?: string }): string {
  return `<span font_family="${o.family ?? FONT_BODY}" font_weight="${o.weight ?? 'normal'}" font_size="${Math.round(o.size * 1024)}" foreground="${o.color}">${esc(text)}</span>`;
}

/** Text als RGBA-Bild (Pango); Grössen in Pixeln (dpi 72 → 1 pt = 1 px). */
async function pangoText(markup: string, width: number, align: 'left' | 'centre', lineGap: number): Promise<{ data: Buffer; width: number; height: number }> {
  const out = await sharp({ text: { text: markup, font: `${FONT_BODY} 12`, fontfile: BODY_FONT_FILE, width: Math.max(1, Math.round(width)), wrap: 'word', align, rgba: true, dpi: 72, spacing: Math.round(lineGap) } })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

function bar(x: number, y: number, w: number, h: number): Layer {
  return { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="${COLORS.accent}"/></svg>`), left: Math.round(x), top: Math.round(y) };
}

/** Titelband des Umschlags: Akzentstrich, Titel (höchstens zwei Zeilen), Zeitraum; vertikal zentriert. */
async function coverBandLayers(band: Rect, title: string, subtitle: string, c: Canvas): Promise<Layer[]> {
  const titlePx = c.px(11);
  const subPx = c.px(5);
  const t = await pangoText(span(title, { size: titlePx, color: COLORS.ink, family: FONT_DISPLAY, weight: '800' }), band.w * 0.85, 'centre', titlePx * 0.1);
  const sub = subtitle ? await pangoText(span(subtitle, { size: subPx, color: COLORS.muted }), band.w * 0.85, 'centre', 0) : null;
  const barW = c.px(24);
  const barH = Math.max(2, c.px(1.2));
  const gap = c.px(4);
  const titleH = Math.min(t.height, titlePx * 2.6);
  const total = barH + gap + titleH + (sub ? gap * 0.6 + sub.height : 0);
  let y = band.y + Math.max(gap, (band.h - total) / 2);
  const layers: Layer[] = [bar(band.x + (band.w - barW) / 2, y, barW, barH)];
  y += barH + gap;
  const titleImg = t.height > titleH ? await sharp(t.data).extract({ left: 0, top: 0, width: t.width, height: Math.round(titleH) }).toBuffer() : t.data;
  layers.push({ input: titleImg, left: Math.round(band.x + (band.w - t.width) / 2), top: Math.round(y) });
  y += titleH + gap * 0.6;
  if (sub) layers.push({ input: sub.data, left: Math.round(band.x + (band.w - sub.width) / 2), top: Math.round(y) });
  return layers;
}

/** Kapitelseite: Monat gross, Akzentstrich, Anzahl Fotos – mittig. */
async function chapterLayers(full: Rect, title: string, subtitle: string, c: Canvas): Promise<Layer[]> {
  const t = await pangoText(span(title, { size: c.px(14), color: COLORS.ink, family: FONT_DISPLAY, weight: '800' }), full.w * 0.8, 'centre', 0);
  const sub = await pangoText(span(subtitle, { size: c.px(5.5), color: COLORS.muted }), full.w * 0.8, 'centre', 0);
  const barW = c.px(20);
  const barH = Math.max(2, c.px(1.2));
  const gap = c.px(5);
  const total = t.height + gap + barH + gap + sub.height;
  let y = (full.h - total) / 2;
  const layers: Layer[] = [{ input: t.data, left: Math.round((full.w - t.width) / 2), top: Math.round(y) }];
  y += t.height + gap;
  layers.push(bar((full.w - barW) / 2, y, barW, barH));
  y += barH + gap;
  layers.push({ input: sub.data, left: Math.round((full.w - sub.width) / 2), top: Math.round(y) });
  return layers;
}

/**
 * Bildunterschrift (gross) und Kommentare (Autor in Akzentfarbe, Text normal) im Textfeld. Passt der Block
 * nicht, fallen Kommentare von hinten weg; passt auch die Unterschrift allein nicht, wird unten abgeschnitten.
 */
async function textBlockLayer(box: Rect, item: PageItem, c: Canvas): Promise<Layer | null> {
  const captionPx = c.px(5);
  const bodyPx = c.px(3.6);
  const build = (comments: PageItem['comments']) => {
    const parts: string[] = [];
    if (item.caption) parts.push(span(item.caption, { size: captionPx, color: COLORS.ink, family: FONT_DISPLAY, weight: '800' }));
    for (const cm of comments) {
      parts.push(`${span(cm.author, { size: bodyPx, color: COLORS.accent, weight: '700' })}\n${span(cm.body, { size: bodyPx, color: COLORS.ink })}`);
    }
    return parts.join('\n\n');
  };
  if (!item.caption && item.comments.length === 0) return null;
  let comments = item.comments;
  for (;;) {
    const markup = build(comments);
    if (!markup) return null;
    const t = await pangoText(markup, box.w, 'left', bodyPx * 0.35);
    if (t.height <= box.h || comments.length === 0) {
      const input = t.height > box.h ? await sharp(t.data).extract({ left: 0, top: 0, width: t.width, height: box.h }).toBuffer() : t.data;
      return { input, left: box.x, top: box.y };
    }
    comments = comments.slice(0, -1);
  }
}
