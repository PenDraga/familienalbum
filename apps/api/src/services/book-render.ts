/**
 * Fotobuch-Renderer: jede Seite wird mit sharp als Bild gerastert (Fotos + Text als SVG), daraus entstehen
 * das PDF (eine JPEG-Seite pro Blatt, pdfkit) und die WebP-Seitenvorschauen. Ein Zeichenweg für beides.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
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
const FONT_DISPLAY = "'Baloo 2', 'Baloo2', 'Nunito', sans-serif";
const FONT_BODY = "'Nunito', sans-serif";

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
    const bandPx = toPx(band, c.px);
    layers.push(svgLayer(bandPx, coverBandSvg(bandPx, page.title, page.subtitle, c)));
  } else if (page.type === 'chapter') {
    background = COLORS.cream;
    const full = toPx({ x: 0, y: 0, w: size.w, h: size.h }, c.px);
    layers.push(svgLayer(full, chapterSvg(full, page.title, page.subtitle, c)));
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
      const trPx = toPx(tr, c.px);
      const svg = textBlockSvg(trPx, page.items[0]!, c);
      if (svg) layers.push(svgLayer(trPx, svg));
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

function svgLayer(rect: Rect, svg: string): Layer {
  return { input: Buffer.from(svg), left: rect.x, top: rect.y };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Zeilenumbruch nach geschätzter Zeichenbreite (Nunito ≈ 0,52 em). */
function wrap(text: string, fontPx: number, widthPx: number): string[] {
  const maxChars = Math.max(8, Math.floor(widthPx / (fontPx * 0.52)));
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) line = candidate;
      else {
        if (line) lines.push(line);
        line = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function coverBandSvg(band: Rect, title: string, subtitle: string, c: Canvas): string {
  const titlePx = Math.round(c.px(11));
  const subPx = Math.round(c.px(5));
  const cx = band.w / 2;
  const titleLines = wrap(title, titlePx, band.w * 0.85).slice(0, 2);
  const titleY = band.h / 2 - (titleLines.length - 1) * titlePx * 0.6;
  const tspans = titleLines.map((l, i) => `<tspan x="${cx}" dy="${i === 0 ? 0 : titlePx * 1.15}">${esc(l)}</tspan>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${band.w}" height="${band.h}">
  <rect x="0" y="0" width="${band.w}" height="${band.h}" fill="${COLORS.cream}"/>
  <rect x="${cx - c.px(12)}" y="${c.px(9)}" width="${c.px(24)}" height="${c.px(1.2)}" rx="${c.px(0.6)}" fill="${COLORS.accent}"/>
  <text x="${cx}" y="${titleY}" text-anchor="middle" font-family="${FONT_DISPLAY}" font-weight="800" font-size="${titlePx}" fill="${COLORS.ink}">${tspans}</text>
  <text x="${cx}" y="${titleY + titleLines.length * titlePx * 1.15 + subPx * 0.6}" text-anchor="middle" font-family="${FONT_BODY}" font-size="${subPx}" fill="${COLORS.muted}">${esc(subtitle)}</text>
</svg>`;
}

function chapterSvg(full: Rect, title: string, subtitle: string, c: Canvas): string {
  const titlePx = Math.round(c.px(14));
  const subPx = Math.round(c.px(5.5));
  const cx = full.w / 2;
  const cy = full.h / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${full.w}" height="${full.h}">
  <text x="${cx}" y="${cy}" text-anchor="middle" font-family="${FONT_DISPLAY}" font-weight="800" font-size="${titlePx}" fill="${COLORS.ink}">${esc(title)}</text>
  <rect x="${cx - c.px(10)}" y="${cy + c.px(6)}" width="${c.px(20)}" height="${c.px(1.2)}" rx="${c.px(0.6)}" fill="${COLORS.accent}"/>
  <text x="${cx}" y="${cy + c.px(16)}" text-anchor="middle" font-family="${FONT_BODY}" font-size="${subPx}" fill="${COLORS.muted}">${esc(subtitle)}</text>
</svg>`;
}

/** Bildunterschrift (gross) und Kommentare (Autor fett, Text normal) im Textfeld; was nicht passt, fällt weg. */
function textBlockSvg(box: Rect, item: PageItem, c: Canvas): string | null {
  const captionPx = Math.round(c.px(5));
  const bodyPx = Math.round(c.px(3.6));
  const lineH = bodyPx * 1.45;
  const parts: string[] = [];
  let y = 0;
  if (item.caption) {
    const lines = wrap(item.caption, captionPx, box.w).slice(0, 3);
    y += captionPx;
    for (const l of lines) {
      parts.push(`<text x="0" y="${y}" font-family="${FONT_DISPLAY}" font-weight="800" font-size="${captionPx}" fill="${COLORS.ink}">${esc(l)}</text>`);
      y += captionPx * 1.2;
    }
    y += bodyPx * 0.6;
  }
  for (const cm of item.comments) {
    const lines = wrap(cm.body, bodyPx, box.w - bodyPx * 0.3);
    const needed = lineH * (lines.length + 1);
    if (y + needed > box.h) break;
    y += bodyPx;
    parts.push(`<text x="0" y="${y}" font-family="${FONT_BODY}" font-weight="700" font-size="${bodyPx}" fill="${COLORS.accent}">${esc(cm.author)}</text>`);
    y += lineH;
    for (const l of lines) {
      parts.push(`<text x="0" y="${y}" font-family="${FONT_BODY}" font-size="${bodyPx}" fill="${COLORS.ink}">${esc(l)}</text>`);
      y += lineH;
    }
    y += bodyPx * 0.5;
  }
  if (parts.length === 0) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">${parts.join('')}</svg>`;
}
