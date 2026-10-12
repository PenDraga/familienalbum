/**
 * Fotobuch-Layout (ADR-0004): reine Berechnung ohne Dateizugriff.
 * - `proposeBook` macht aus Fotos (nach Aufnahmedatum) einen Seitenvorschlag: Umschlag, Kapitel pro Monat,
 *   Fotoseiten mit wenigen Vorlagen. Deterministisch: gleiche Eingabe → gleiches Buch.
 * - `photoRects`/`textRect` liefern die Rechtecke (mm, inkl. Beschnitt) für den Renderer.
 */

export type BookFormat = 'SQUARE_21' | 'A4_LANDSCAPE' | 'SQUARE_30';
export type BookTextMode = 'NONE' | 'CAPTIONS' | 'COMMENTS';
/** Anordnung: ein Foto pro Seite, gemischt (1–4, Tage zusammen, ein Highlight pro Monat), Collage (bis 6). */
export type BookLayout = 'SINGLE' | 'MIXED' | 'COLLAGE';
/**
 * `auto`: 1–6 Fotos in Reihen nach ihrem Seitenverhältnis (ohne Beschnitt), zentriert im Satzspiegel.
 * Die festen Vorlagen `two`, `two_stacked`, `four` stammen aus der ersten Version und bleiben für ältere Bücher.
 */
export type PageTemplate = 'one' | 'two' | 'two_stacked' | 'four' | 'one_text' | 'auto';

/** Masse in mm. `w`/`h` = Endformat; dazu kommt rundum `bleed`. */
export interface FormatSpec {
  w: number;
  h: number;
  bleed: number;
  margin: number;
  gutter: number;
}

export const FORMATS: Record<BookFormat, FormatSpec> = {
  SQUARE_21: { w: 210, h: 210, bleed: 3, margin: 12, gutter: 4 },
  A4_LANDSCAPE: { w: 297, h: 210, bleed: 3, margin: 12, gutter: 4 },
  SQUARE_30: { w: 300, h: 300, bleed: 3, margin: 15, gutter: 5 },
};

export const MAX_PAGES = 200;
/** Höchstens so viele Kommentare pro Foto im Buch */
export const MAX_COMMENTS = 6;
/** Höchstens so viele Fotos auf einer `auto`-Seite */
export const MAX_PER_PAGE: Record<BookLayout, number> = { SINGLE: 1, MIXED: 4, COLLAGE: 6 };
/** Seitenverhältnis, wenn die Masse fehlen (übliches Querformat) */
const DEFAULT_ASPECT = 1.5;

export interface BookComment {
  author: string;
  body: string;
}

export interface BookPhoto {
  mediaId: string;
  takenAt: Date;
  width: number | null;
  height: number | null;
  caption: string | null;
  comments: BookComment[];
}

/** Bildausschnitt: Fokuspunkt (0–1, relativ zum ganzen Foto) und Zoom (1 = grösstmöglicher Ausschnitt). */
export interface Crop {
  x: number;
  y: number;
  zoom: number;
}

export interface PageItem {
  mediaId: string;
  caption: string | null;
  comments: BookComment[];
  /** Breite / Höhe (nach EXIF-Drehung); für `auto`-Seiten */
  aspect?: number;
  /** Im Kontroll-Assistenten gesetzt; ohne Angabe wählt der Server den bildwichtigsten Bereich */
  crop?: Crop;
}

export type BookPage =
  | { type: 'cover'; mediaId: string | null; title: string; subtitle: string; crop?: Crop }
  | { type: 'chapter'; title: string; subtitle: string }
  | { type: 'photos'; template: PageTemplate; items: PageItem[]; hideText?: boolean };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Lang = 'de' | 'en';

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `JJJJ-MM` → «März 2026» */
export function monthLabel(month: string, lang: Lang = 'de'): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${(lang === 'en' ? MONTHS_EN : MONTHS_DE)[m - 1]} ${y}`;
}

/** Zeitraum aus sortierten Monaten: «Januar – Juni 2026», «2025», «Dezember 2025 – Februar 2026» */
export function periodLabel(months: string[], lang: Lang = 'de'): string {
  if (months.length === 0) return '';
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (first === last) return monthLabel(first, lang);
  const [fy, fm] = first.split('-').map(Number) as [number, number];
  const [ly, lm] = last.split('-').map(Number) as [number, number];
  const names = lang === 'en' ? MONTHS_EN : MONTHS_DE;
  if (fy === ly) {
    if (fm === 1 && lm === 12 && months.length === 12) return String(fy);
    return `${names[fm - 1]} – ${names[lm - 1]} ${fy}`;
  }
  return `${names[fm - 1]} ${fy} – ${names[lm - 1]} ${ly}`;
}

export function monthKeyUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dayKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isPortrait(p: Pick<BookPhoto, 'width' | 'height'>): boolean {
  return p.width !== null && p.height !== null && p.height > p.width;
}

export interface ProposeOptions {
  title: string;
  subtitle: string;
  textMode: BookTextMode;
  layout: BookLayout;
  lang: Lang;
}

/**
 * Seitenvorschlag. Fotos werden nach Aufnahmedatum sortiert, pro Monat ein Kapitel. Fotos mit Text bekommen
 * «Bild mit Text», die übrigen werden je nach Anordnung auf `auto`-Seiten verteilt.
 */
export function proposeBook(photos: BookPhoto[], opts: ProposeOptions): BookPage[] {
  const sorted = [...photos].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime() || a.mediaId.localeCompare(b.mediaId));
  const pages: BookPage[] = [];
  const cover = pickCover(sorted);
  pages.push({ type: 'cover', mediaId: cover?.mediaId ?? null, title: opts.title, subtitle: opts.subtitle });

  for (const [month, inMonth] of groupBy(sorted, (p) => monthKeyUtc(p.takenAt))) {
    const n = inMonth.length;
    const subtitle = opts.lang === 'en' ? `${n} ${n === 1 ? 'photo' : 'photos'}` : `${n} ${n === 1 ? 'Foto' : 'Fotos'}`;
    pages.push({ type: 'chapter', title: monthLabel(month, opts.lang), subtitle });
    pages.push(...layoutMonth(inMonth, opts.textMode, opts.layout, cover?.mediaId ?? null));
  }
  return pages;
}

/** Titelbild: das meistkommentierte Foto, bei Gleichstand das erste. Querformat bevorzugt. */
function pickCover(sorted: BookPhoto[]): BookPhoto | undefined {
  let best: BookPhoto | undefined;
  let bestScore = -1;
  for (const p of sorted) {
    const score = p.comments.length * 2 + (isPortrait(p) ? 0 : 1);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

function groupBy<T>(items: T[], key: (t: T) => string): Array<[string, T[]]> {
  const out: Array<[string, T[]]> = [];
  for (const it of items) {
    const k = key(it);
    const last = out[out.length - 1];
    if (last && last[0] === k) last[1].push(it);
    else out.push([k, [it]]);
  }
  return out;
}

export function aspectOf(p: Pick<BookPhoto, 'width' | 'height'>): number {
  return p.width && p.height ? Math.round((p.width / p.height) * 1000) / 1000 : DEFAULT_ASPECT;
}

function toItem(p: BookPhoto, textMode: BookTextMode): PageItem {
  const base = { mediaId: p.mediaId, aspect: aspectOf(p) };
  if (textMode === 'NONE') return { ...base, caption: null, comments: [] };
  return {
    ...base,
    caption: p.caption?.trim() || null,
    comments: textMode === 'COMMENTS' ? p.comments.slice(0, MAX_COMMENTS).map((c) => ({ author: c.author, body: c.body.trim() })) : [],
  };
}

export function hasText(item: PageItem): boolean {
  return !!item.caption || item.comments.length > 0;
}

/** Viel Text braucht eine eigene Seite «Bild mit Text»; kurzer Text passt unter das Foto in einer Collage. */
function needsOwnPage(item: PageItem): boolean {
  const commentChars = item.comments.reduce((n, c) => n + c.author.length + c.body.length, 0);
  return item.comments.length > 2 || commentChars > 160 || (item.caption?.length ?? 0) > 140;
}

/** Seiten mit Text bekommen weniger Fotos, damit unter jedem Platz bleibt. */
const MAX_WITH_TEXT: Record<BookLayout, number> = { SINGLE: 1, MIXED: 3, COLLAGE: 4 };

type Entry = { photo: BookPhoto; item: PageItem };

/** Ein Monat: Textfotos einzeln, dazwischen Läufe ohne Text; bei «Gemischt» ein ganzseitiges Highlight. */
function layoutMonth(photos: BookPhoto[], textMode: BookTextMode, layout: BookLayout, coverId: string | null): BookPage[] {
  const entries: Entry[] = photos.map((photo) => ({ photo, item: toItem(photo, textMode) }));
  let heroId: string | null = null;
  if (layout === 'MIXED') {
    const plain = entries.filter((e) => !hasText(e.item)).map((e) => e.photo);
    // nicht dasselbe Foto wie auf dem Umschlag
    if (plain.length >= 6) heroId = pickHero(plain.filter((p) => p.mediaId !== coverId))?.mediaId ?? null;
  }

  const pages: BookPage[] = [];
  const takenAt = new Map(entries.map((e) => [e.photo.mediaId, e.photo.takenAt.getTime()]));
  let run: Entry[] = [];
  let hero: Entry | null = null;
  const flush = () => {
    const packed = packRun(run, layout);
    if (hero) {
      // Das Highlight kommt an die Seitengrenze, an der es zeitlich hingehört – so bleiben Tage beisammen
      const t = hero.photo.takenAt.getTime();
      const at = packed.findIndex((p) => p.type === 'photos' && takenAt.get(p.items[0]!.mediaId)! > t);
      // Querformat randabfallend, Hochformat gerahmt (sonst würde zu viel abgeschnitten)
      const page: BookPage = { type: 'photos', template: isPortrait(hero.photo) ? 'auto' : 'one', items: [hero.item] };
      packed.splice(at < 0 ? packed.length : at, 0, page);
      hero = null;
    }
    pages.push(...packed);
    run = [];
  };
  for (const e of entries) {
    if (hasText(e.item) && (layout === 'SINGLE' || needsOwnPage(e.item))) {
      flush();
      pages.push({ type: 'photos', template: 'one_text', items: [e.item] });
    } else if (e.photo.mediaId === heroId) {
      hero = e;
    } else {
      run.push(e);
    }
  }
  flush();
  return pages;
}

/** Highlight: meistkommentiert, sonst das Querformat nächst der Monatsmitte (gibt einen ruhigen Rhythmus). */
function pickHero(photos: BookPhoto[]): BookPhoto | undefined {
  const top = photos.reduce<BookPhoto | undefined>((best, p) => (!best || p.comments.length > best.comments.length ? p : best), undefined);
  if (top && top.comments.length > 0) return top;
  const mid = Math.floor(photos.length / 2);
  const byDistance = photos.map((p, i) => ({ p, d: Math.abs(i - mid) })).sort((x, y) => x.d - y.d);
  return byDistance.find((x) => !isPortrait(x.p))?.p ?? photos[mid];
}

/**
 * Lauf ohne Text auf Seiten verteilen. Fotos eines Tages bleiben zusammen; aufeinanderfolgende Tage werden
 * zusammengelegt, solange sie auf eine Seite passen. Zu grosse Tage werden gleichmässig geteilt.
 */
function packRun(run: Entry[], layout: BookLayout): BookPage[] {
  const max = MAX_PER_PAGE[layout];
  if (run.length === 0) return [];
  if (max === 1) return run.map((e) => ({ type: 'photos', template: 'auto', items: [e.item] }));
  // Beim Zusammenlegen verschiedener Tage etwas luftiger als das Maximum
  const mergeLimit = layout === 'MIXED' ? 3 : max;
  const chunks: Entry[][] = [];
  let current: Entry[] = [];
  for (const [, day] of groupBy(run, (e) => dayKeyUtc(e.photo.takenAt))) {
    if (day.length > max) {
      if (current.length) chunks.push(current);
      current = [];
      chunks.push(...balanced(day, max));
      continue;
    }
    // Ein einzelnes Foto darf bis zum Maximum aufgefüllt werden, sonst bleibt es allein auf der Seite
    const limit = current.length === 1 ? max : mergeLimit;
    if (current.length > 0 && current.length + day.length > limit) {
      chunks.push(current);
      current = [];
    }
    current.push(...day);
  }
  if (current.length) chunks.push(current);
  const withText = MAX_WITH_TEXT[layout];
  return chunks
    .flatMap((c) => (c.length > withText && c.some((e) => hasText(e.item)) ? balanced(c, withText) : [c]))
    .map((c) => ({ type: 'photos', template: 'auto', items: c.map((e) => e.item) }));
}

/** n Elemente auf möglichst gleich volle Seiten mit höchstens `max` verteilen. */
function balanced<T>(items: T[], max: number): T[][] {
  const count = Math.ceil(items.length / max);
  const base = Math.floor(items.length / count);
  const extra = items.length % count;
  const out: T[][] = [];
  let i = 0;
  for (let k = 0; k < count; k++) {
    const size = base + (k < extra ? 1 : 0);
    out.push(items.slice(i, i + size));
    i += size;
  }
  return out;
}

// ---------- Rechtecke ----------

export function pageSize(spec: FormatSpec): { w: number; h: number } {
  return { w: spec.w + 2 * spec.bleed, h: spec.h + 2 * spec.bleed };
}

export function inner(spec: FormatSpec): Rect {
  const off = spec.bleed + spec.margin;
  return { x: off, y: off, w: spec.w - 2 * spec.margin, h: spec.h - 2 * spec.margin };
}

/** Bildrechtecke für eine Fotoseite; `fit` sagt dem Renderer, ob das Bild füllt (beschnitten) oder passt. */
export function photoRects(spec: FormatSpec, template: PageTemplate, count: number, aspects: number[] = []): Array<Rect & { fit: 'cover' | 'contain' }> {
  const full = pageSize(spec);
  const box = inner(spec);
  const g = spec.gutter;
  switch (template) {
    case 'one':
      return [{ x: 0, y: 0, w: full.w, h: full.h, fit: 'cover' }];
    case 'two': {
      const w = (box.w - g) / 2;
      return [0, 1].slice(0, count).map((i) => ({ x: box.x + i * (w + g), y: box.y, w, h: box.h, fit: 'cover' as const }));
    }
    case 'two_stacked': {
      const h = (box.h - g) / 2;
      return [0, 1].slice(0, count).map((i) => ({ x: box.x, y: box.y + i * (h + g), w: box.w, h, fit: 'cover' as const }));
    }
    case 'four': {
      const w = (box.w - g) / 2;
      const h = (box.h - g) / 2;
      const cells = [
        { x: box.x, y: box.y, w, h },
        { x: box.x + w + g, y: box.y, w, h },
        { x: box.x, y: box.y + h + g, w, h },
        { x: box.x + w + g, y: box.y + h + g, w, h },
      ];
      if (count === 3) cells[2] = { x: box.x, y: box.y + h + g, w: box.w, h };
      return cells.slice(0, count).map((c) => ({ ...c, fit: 'cover' as const }));
    }
    case 'one_text':
      return [{ x: box.x, y: box.y, w: box.w, h: box.h * 0.7, fit: 'contain' }];
    case 'auto': {
      const a = Array.from({ length: count }, (_, i) => aspects[i] ?? DEFAULT_ASPECT);
      return justifiedRects(box, a, g).map((r) => ({ ...r, fit: 'cover' as const }));
    }
  }
}

/** Alle Aufteilungen von n Fotos in 1–3 Reihen mit je 1–3 Fotos (Reihenfolge bleibt). */
function rowSplits(n: number): number[][] {
  const out: number[][] = [];
  const walk = (left: number, acc: number[]) => {
    if (left === 0) {
      out.push(acc);
      return;
    }
    if (acc.length === 3) return;
    for (let k = 1; k <= Math.min(3, left); k++) walk(left - k, [...acc, k]);
  };
  walk(n, []);
  return out;
}

/**
 * Fotos in Reihen oder Spalten setzen (wie Google Fotos): jede Reihe füllt die Breite bzw. jede Spalte die
 * Höhe, die andere Kante folgt aus den Seitenverhältnissen, nichts wird beschnitten. Ist der Block zu gross,
 * wird er verkleinert und zentriert. Gewählt wird die Aufteilung, die die meiste Fläche füllt, ohne dass ein
 * Foto neben den anderen winzig wird; bei Gleichstand gewinnt die erste (Reihen vor Spalten, wenige vor vielen).
 */
export function justifiedRects(box: Rect, aspects: number[], gutter: number, below: number[] = []): Rect[] {
  if (aspects.length === 0) return [];
  const rows = bestRows(box, aspects, gutter, below);
  // Mit Text unter den Fotos nur Reihen (der Text gehört unter das Foto, nicht in eine Spalte)
  if (below.some((b) => b > 0)) return rows.rects;
  // Spalten = Reihen auf der gespiegelten Seite
  const flipped = bestRows({ x: box.y, y: box.x, w: box.h, h: box.w }, aspects.map((a) => 1 / a), gutter);
  const cols = { fill: flipped.fill, rects: flipped.rects.map((r) => ({ x: r.y, y: r.x, w: r.h, h: r.w })) };
  return cols.fill > rows.fill + 0.02 ? cols.rects : rows.rects;
}

/** `below[i]`: Platz, der unter Foto i frei bleiben muss (Text); eine Reihe reserviert das Maximum ihrer Fotos. */
function bestRows(box: Rect, aspects: number[], gutter: number, below: number[] = []): { rects: Rect[]; fill: number } {
  const n = aspects.length;
  let best: { rects: Rect[]; fill: number } | null = null;
  for (const split of rowSplits(n)) {
    let i = 0;
    const rows = split.map((m) => {
      const a = aspects.slice(i, i + m);
      const extra = Math.max(0, ...below.slice(i, i + m));
      i += m;
      const sum = a.reduce((x, y) => x + y, 0);
      return { a, h: (box.w - gutter * (m - 1)) / sum, extra };
    });
    const gaps = gutter * (rows.length - 1) + rows.reduce((x, r) => x + r.extra, 0);
    const natural = rows.reduce((x, r) => x + r.h, 0);
    const scale = natural + gaps > box.h ? Math.max(0.05, (box.h - gaps) / natural) : 1;
    const totalH = natural * scale + gaps;
    let y = box.y + (box.h - totalH) / 2;
    const rects: Rect[] = [];
    let area = 0;
    for (const r of rows) {
      const h = r.h * scale;
      const widths = r.a.map((x) => x * h);
      const rowW = widths.reduce((x, w) => x + w, 0) + gutter * (r.a.length - 1);
      let x = box.x + (box.w - rowW) / 2;
      for (const w of widths) {
        rects.push({ x, y, w, h });
        area += w * h;
        x += w + gutter;
      }
      y += h + r.extra + gutter;
    }
    // Sehr ungleiche Grössen bestrafen (ein Briefmarken-Foto neben einem grossen)
    const sizes = rects.map((r) => r.w * r.h);
    const fill = area / (box.w * box.h) - (Math.min(...sizes) / Math.max(...sizes) < 0.2 ? 0.25 : 0);
    if (!best || fill > best.fill + 1e-6) best = { rects, fill };
  }
  return best!;
}

/** Textfeld unter dem Bild (nur «Bild mit Text»). */
export function textRect(spec: FormatSpec, template: PageTemplate): Rect | null {
  if (template !== 'one_text') return null;
  const box = inner(spec);
  const top = box.y + box.h * 0.7 + spec.gutter * 1.5;
  return { x: box.x, y: top, w: box.w, h: box.y + box.h - top };
}

/** Umschlag: Bild oben (zwei Drittel, füllend), Titelband unten. */
export function coverRects(spec: FormatSpec): { photo: Rect; band: Rect } {
  const full = pageSize(spec);
  const photoH = Math.round(full.h * 0.64);
  return { photo: { x: 0, y: 0, w: full.w, h: photoH }, band: { x: 0, y: photoH, w: full.w, h: full.h - photoH } };
}

/** Zählt Fotos im Buch (ein Foto kann nur einmal vorkommen). */
export function countMedia(pages: BookPage[]): number {
  const ids = new Set<string>();
  for (const p of pages) {
    if (p.type === 'cover' && p.mediaId) ids.add(p.mediaId);
    if (p.type === 'photos') for (const it of p.items) ids.add(it.mediaId);
  }
  return ids.size;
}
