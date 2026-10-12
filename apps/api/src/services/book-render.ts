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
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import { coverRects, FORMATS, hasText, inner, justifiedRects, pageSize, photoRects, type BookFormat, type BookPage, type Crop, type FormatSpec, type PageItem, type Rect } from './book-layout.js';

export interface RenderEnv {
  /** Auflösung der Druckseiten (Produktion 300) */
  dpi: number;
  /** Breite der Seitenvorschau in Pixeln */
  previewWidth: number;
  /** Pfad zur Bilddatei eines Fotos (Original oder Thumbnail); null = überspringen */
  photoPath: (mediaId: string) => Promise<string | null>;
  log?: (msg: string, extra?: object) => void;
  /** Wird gefüllt: Seitenverhältnis (Breite/Höhe) des Platzes je Foto, das den Platz füllt – für den Ausschnitt-Rahmen in der App */
  slots?: Map<string, number>;
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
  /** Kommentartext: etwas weicher als die Beschreibung */
  body: '#4A4458',
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
/** Eine einzelne Seite als WebP (Kontroll-Assistent): gleicher Zeichenweg wie das Buch, nur kleinere Auflösung. */
export async function renderPagePreview(page: BookPage, format: BookFormat, env: RenderEnv): Promise<{ image: Buffer; slots: Record<string, number> }> {
  const spec = FORMATS[format];
  const size = pageSize(spec);
  const px = (mm: number) => Math.round((mm / 25.4) * env.dpi);
  const slots = new Map<string, number>();
  const jpeg = await renderPage(page, spec, { W: px(size.w), H: px(size.h), px, env: { ...env, slots } });
  const image = await sharp(jpeg).resize({ width: env.previewWidth }).webp({ quality: 82 }).toBuffer();
  return { image, slots: Object.fromEntries([...slots].map(([id, a]) => [id, Math.round(a * 1000) / 1000])) };
}

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
      const area = toPx(photo, c.px);
      const aspect = await photoAspect(page.mediaId, c);
      let rect = area;
      if (aspect !== null && aspect < 1.05) {
        // Hochformat nicht ins breite Band schneiden, sondern gerahmt auf den Umschlag stellen
        const margin = c.px(spec.bleed + spec.margin);
        const h = area.h - margin * 1.5;
        rect = { x: area.x + (area.w - h * aspect) / 2, y: area.y + margin, w: h * aspect, h };
      }
      const layer = await photoLayerPx(page.mediaId, rect, 'cover', c, page.crop);
      if (layer) layers.push(layer);
    }
    layers.push(...(await coverBandLayers(toPx(band, c.px), page.title, page.subtitle, c)));
  } else if (page.type === 'chapter') {
    background = COLORS.cream;
    layers.push(...(await chapterLayers(toPx({ x: 0, y: 0, w: size.w, h: size.h }, c.px), page.title, page.subtitle, c)));
  } else if (page.template === 'one_text') {
    layers.push(...(await photoWithTextLayers(page.items[0]!, spec, c, page.hideText ?? false)));
  } else if (page.template === 'auto' && !page.hideText && page.items.some(hasText)) {
    layers.push(...(await collageWithTextLayers(page.items, spec, c)));
  } else {
    const rects = photoRects(spec, page.template, page.items.length, page.items.map((i) => i.aspect ?? 1.5));
    for (let i = 0; i < page.items.length; i++) {
      const r = rects[i];
      if (!r) break;
      const layer = await photoLayerPx(page.items[i]!.mediaId, toPx(r, c.px), r.fit, c, page.items[i]!.crop);
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
/** Seitenverhältnis nach EXIF-Drehung, null wenn die Datei fehlt. */
async function photoAspect(mediaId: string, c: Canvas): Promise<number | null> {
  const path = await c.env.photoPath(mediaId);
  if (!path) return null;
  try {
    const meta = await sharp(path, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) return null;
    const swap = (meta.orientation ?? 1) >= 5;
    return swap ? meta.height / meta.width : meta.width / meta.height;
  } catch {
    return null;
  }
}

/** Ausschnitt im Seitenverhältnis `aspect` um den Fokuspunkt, verkleinert um den Zoom, innerhalb des Fotos. */
export function cropBox(width: number, height: number, aspect: number, crop: Crop): { left: number; top: number; width: number; height: number } {
  const baseW = Math.min(width, height * aspect);
  const baseH = baseW / aspect;
  const zoom = Math.min(4, Math.max(1, crop.zoom));
  const w = Math.max(1, Math.min(width, Math.round(baseW / zoom)));
  const h = Math.max(1, Math.min(height, Math.round(baseH / zoom)));
  const clamp = (v: number, max: number) => Math.min(Math.max(0, Math.round(v)), max);
  return { left: clamp(crop.x * width - w / 2, width - w), top: clamp(crop.y * height - h / 2, height - h), width: w, height: h };
}

/**
 * Foto in ein Rechteck (Pixel). `cover` füllt: mit gesetztem Ausschnitt um dessen Fokuspunkt und Zoom, sonst
 * auf den bildwichtigsten Bereich (sharp «attention»: Kontraste, Hauttöne) statt stur auf die Mitte.
 * `contain` passt das ganze Foto ein und zentriert es.
 */
async function photoLayerPx(mediaId: string, rect: Rect, fit: 'cover' | 'contain', c: Canvas, crop?: Crop): Promise<Layer | null> {
  const path = await c.env.photoPath(mediaId);
  if (!path) return null;
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(1, Math.round(rect.w)), h: Math.max(1, Math.round(rect.h)) };
  if (fit === 'cover') c.env.slots?.set(mediaId, r.w / r.h);
  try {
    let image: Sharp;
    if (fit === 'cover' && crop) {
      const oriented = await sharp(path, { failOn: 'none', animated: false }).rotate().raw().toBuffer({ resolveWithObject: true });
      const box = cropBox(oriented.info.width, oriented.info.height, r.w / r.h, crop);
      image = sharp(oriented.data, { raw: { width: oriented.info.width, height: oriented.info.height, channels: oriented.info.channels } })
        .extract(box)
        .resize({ width: r.w, height: r.h, fit: 'fill' });
    } else {
      image = sharp(path, { failOn: 'none', animated: false })
        .rotate()
        .resize({ width: r.w, height: r.h, fit: fit === 'cover' ? 'cover' : 'inside', position: fit === 'cover' ? sharp.strategy.attention : 'centre', withoutEnlargement: false });
    }
    const buf = await image.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
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

/** Ein gesetztes Textstück relativ zur oberen linken Ecke des Textblocks. */
interface Piece {
  input: Buffer;
  dx: number;
  dy: number;
}

/**
 * Beschreibung und Kommentare als Block in der gegebenen Breite: Beschreibung in Baloo 2, darunter die Kommentare
 * wie Zitate (feine Akzentlinie links, Name in Akzentfarbe, Text etwas weicher). Ist der Block höher als `maxH`,
 * fallen Kommentare von hinten weg; eine zu lange Beschreibung wird unten abgeschnitten.
 */
async function textStack(item: PageItem, width: number, maxH: number, c: Canvas, compact = false): Promise<{ pieces: Piece[]; height: number; width: number }> {
  // kompakt: unter Fotos in einer Collage
  const captionPx = c.px(compact ? 3.7 : 4.6);
  const bodyPx = c.px(compact ? 2.9 : 3.3);
  const authorPx = c.px(compact ? 2.6 : 2.9);
  const gap = c.px(compact ? 1.8 : 3.2);
  const indent = c.px(compact ? 2.6 : 3.4);
  const barW = Math.max(2, c.px(0.6));
  const pieces: Piece[] = [];
  let height = 0;
  let used = 0;
  if (item.caption) {
    const t = await pangoText(span(item.caption, { size: captionPx, color: COLORS.ink, family: FONT_DISPLAY, weight: '800' }), width, 'left', captionPx * 0.12);
    const h = Math.min(t.height, Math.round(maxH));
    pieces.push({ input: h < t.height ? await sharp(t.data).extract({ left: 0, top: 0, width: t.width, height: h }).toBuffer() : t.data, dx: 0, dy: 0 });
    height = h;
    used = t.width;
  }
  let comments = item.comments;
  while (comments.length > 0) {
    const markup = comments
      .map((cm) => `${span(cm.author, { size: authorPx, color: COLORS.accent, weight: '700' })}\n${span(cm.body, { size: bodyPx, color: COLORS.body })}`)
      .join(`\n${span(' ', { size: bodyPx * 0.45, color: COLORS.body })}\n`);
    const t = await pangoText(markup, width - indent, 'left', bodyPx * 0.28);
    const top = height > 0 ? height + gap : 0;
    if (top + t.height <= maxH) {
      const bar = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${barW}" height="${t.height}"><rect width="${barW}" height="${t.height}" rx="${barW / 2}" fill="${COLORS.accent}" fill-opacity="0.55"/></svg>`);
      pieces.push({ input: bar, dx: 0, dy: top }, { input: t.data, dx: indent, dy: top });
      height = top + t.height;
      used = Math.max(used, indent + t.width);
      break;
    }
    comments = comments.slice(0, -1);
  }
  return { pieces, height, width: used };
}

function place(pieces: Piece[], x: number, y: number): Layer[] {
  return pieces.map((p) => ({ input: p.input, left: Math.round(x + p.dx), top: Math.round(y + p.dy) }));
}

/**
 * Seite «Bild mit Text».
 * - Querformat: Foto oben, Beschreibung und Kommentare direkt darunter, genau so breit wie das Foto; Foto und Text
 *   zusammen vertikal zentriert. Viel Text macht das Foto kleiner (höchstens 45 % der Höhe für Text).
 * - Hoch- oder quadratisches Format auf quadratischer oder querer Seite: Text rechts neben dem Foto, bündig mit
 *   dessen Unterkante (darunter würde das Foto zu klein).
 * Das Foto wird nie beschnitten.
 */
async function photoWithTextLayers(item: PageItem, spec: FormatSpec, c: Canvas, hideText: boolean): Promise<Layer[]> {
  const box = toPx(inner(spec), c.px);
  const aspect = item.aspect ?? 1.5;
  const gap = c.px(5);
  const layers: Layer[] = [];
  const hasText = !hideText && (!!item.caption || item.comments.length > 0);

  if (!hasText) {
    const w = Math.min(box.w, box.h * aspect);
    const h = w / aspect;
    const photo = await photoLayerPx(item.mediaId, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }, 'cover', c, item.crop);
    return photo ? [photo] : [];
  }

  if (aspect < 1.05 && box.w / box.h >= 0.95) {
    // nebeneinander
    const photoW = Math.min(box.h * aspect, box.w * 0.6);
    const photoH = photoW / aspect;
    // Textspalte höchstens 85 mm breit (lesbar); Foto und Text als Gruppe waagrecht zentriert
    const textW = Math.min(box.w - photoW - gap, c.px(85));
    const x = box.x + (box.w - (photoW + gap + textW)) / 2;
    const y = box.y + (box.h - photoH) / 2;
    const photo = await photoLayerPx(item.mediaId, { x, y, w: photoW, h: photoH }, 'cover', c, item.crop);
    if (photo) layers.push(photo);
    const stack = await textStack(item, textW, photoH, c);
    layers.push(...place(stack.pieces, x + photoW + gap, y + photoH - stack.height));
    return layers;
  }

  // untereinander: Textbreite = Fotobreite; zweimal nachrechnen, weil schmalerer Text höher wird
  let w = Math.min(box.w, box.h * aspect);
  let stack = await textStack(item, w, box.h * 0.45, c);
  for (let k = 0; k < 2; k++) {
    const h = Math.min(w / aspect, box.h - stack.height - gap);
    const next = Math.min(box.w, h * aspect);
    if (Math.abs(next - w) < 2) break;
    w = next;
    stack = await textStack(item, w, box.h * 0.45, c);
  }
  const h = Math.min(w / aspect, box.h - stack.height - gap);
  w = h * aspect;
  const total = h + gap + stack.height;
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - total) / 2;
  const photo = await photoLayerPx(item.mediaId, { x, y, w, h }, 'cover', c, item.crop);
  if (photo) layers.push(photo);
  layers.push(...place(stack.pieces, x, y + h + gap));
  return layers;
}

/**
 * Collage mit Text: Fotos in Reihen (Seitenverhältnis bleibt), unter jedem Foto seine Beschreibung und kurze
 * Kommentare in Fotobreite. Der Platz für den Text wird pro Reihe reserviert, die Fotos werden entsprechend kleiner.
 * Zweimal nachgemessen, weil sich mit der Fotobreite auch die Texthöhe ändert.
 */
async function collageWithTextLayers(items: PageItem[], spec: FormatSpec, c: Canvas): Promise<Layer[]> {
  const box = toPx(inner(spec), c.px);
  const gutter = c.px(spec.gutter) * 1.6;
  const textGap = c.px(1.8);
  const maxText = box.h * 0.2;
  const aspects = items.map((i) => i.aspect ?? 1.5);
  let below = items.map(() => 0);
  let rects = justifiedRects(box, aspects, gutter, below);
  for (let k = 0; k < 3; k++) {
    const heights = await Promise.all(items.map(async (it, i) => (hasText(it) ? (await textStack(it, rects[i]!.w, maxText, c, true)).height + textGap : 0)));
    below = heights;
    rects = justifiedRects(box, aspects, gutter, below);
  }
  const layers: Layer[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = rects[i]!;
    const photo = await photoLayerPx(items[i]!.mediaId, r, 'cover', c, items[i]!.crop);
    if (photo) layers.push(photo);
    if (hasText(items[i]!) && below[i]! > 0) {
      // höchstens so hoch wie reserviert – nichts ragt in die nächste Reihe
      const stack = await textStack(items[i]!, r.w, below[i]! - textGap, c, true);
      layers.push(...place(stack.pieces, r.x, r.y + r.h + textGap));
    }
  }
  return layers;
}
