/**
 * Fotobuch-Layout (ADR-0004): reine Berechnung ohne Dateizugriff.
 * - `proposeBook` macht aus Fotos (nach Aufnahmedatum) einen Seitenvorschlag: Umschlag, Kapitel pro Monat,
 *   Fotoseiten mit wenigen Vorlagen. Deterministisch: gleiche Eingabe → gleiches Buch.
 * - `photoRects`/`textRect` liefern die Rechtecke (mm, inkl. Beschnitt) für den Renderer.
 */

export type BookFormat = 'SQUARE_21' | 'A4_LANDSCAPE' | 'SQUARE_30';
export type BookTextMode = 'NONE' | 'CAPTIONS' | 'COMMENTS';
export type PageTemplate = 'one' | 'two' | 'two_stacked' | 'four' | 'one_text';

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

export interface PageItem {
  mediaId: string;
  caption: string | null;
  comments: BookComment[];
}

export type BookPage =
  | { type: 'cover'; mediaId: string | null; title: string; subtitle: string }
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
  lang: Lang;
}

/** Fotoseiten-Vorschlag. Fotos werden nach Aufnahmedatum sortiert, pro Monat ein Kapitel, pro Tag gruppiert. */
export function proposeBook(photos: BookPhoto[], opts: ProposeOptions): BookPage[] {
  const sorted = [...photos].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime() || a.mediaId.localeCompare(b.mediaId));
  const pages: BookPage[] = [];
  const cover = pickCover(sorted);
  pages.push({ type: 'cover', mediaId: cover?.mediaId ?? null, title: opts.title, subtitle: opts.subtitle });

  const byMonth = groupBy(sorted, (p) => monthKeyUtc(p.takenAt));
  for (const [month, inMonth] of byMonth) {
    const n = inMonth.length;
    const subtitle = opts.lang === 'en' ? `${n} ${n === 1 ? 'photo' : 'photos'}` : `${n} ${n === 1 ? 'Foto' : 'Fotos'}`;
    pages.push({ type: 'chapter', title: monthLabel(month, opts.lang), subtitle });
    for (const [, inDay] of groupBy(inMonth, (p) => dayKeyUtc(p.takenAt))) {
      pages.push(...layoutDay(inDay, opts.textMode));
    }
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

function toItem(p: BookPhoto, textMode: BookTextMode): PageItem {
  if (textMode === 'NONE') return { mediaId: p.mediaId, caption: null, comments: [] };
  return {
    mediaId: p.mediaId,
    caption: p.caption?.trim() || null,
    comments: textMode === 'COMMENTS' ? p.comments.slice(0, MAX_COMMENTS).map((c) => ({ author: c.author, body: c.body.trim() })) : [],
  };
}

function hasText(item: PageItem): boolean {
  return !!item.caption || item.comments.length > 0;
}

/**
 * Vorlagen pro Tag: Fotos mit Text bekommen «Bild mit Text»; Hochformate werden gepaart; jedes dritte
 * Querformat bekommt die ganze Seite, die anderen werden übereinander gestellt; sonst Vierer-Raster.
 */
function layoutDay(photos: BookPhoto[], textMode: BookTextMode): BookPage[] {
  const queue = photos.map((p) => ({ item: toItem(p, textMode), portrait: isPortrait(p) }));
  const pages: BookPage[] = [];
  let landscapeTurn = 0;

  const takeIndex = (i: number) => queue.splice(i, 1)[0]!;
  const findNext = (pred: (q: (typeof queue)[number]) => boolean) => queue.findIndex((q) => pred(q) && !hasText(q.item));

  while (queue.length > 0) {
    const first = takeIndex(0);
    if (hasText(first.item)) {
      pages.push({ type: 'photos', template: 'one_text', items: [first.item] });
      continue;
    }
    if (first.portrait) {
      const j = findNext((q) => q.portrait);
      if (j >= 0) {
        pages.push({ type: 'photos', template: 'two', items: [first.item, takeIndex(j).item] });
        continue;
      }
    } else {
      const full = landscapeTurn++ % 3 === 0;
      if (!full) {
        const j = findNext((q) => !q.portrait);
        if (j >= 0) {
          pages.push({ type: 'photos', template: 'two_stacked', items: [first.item, takeIndex(j).item] });
          continue;
        }
      } else {
        pages.push({ type: 'photos', template: 'one', items: [first.item] });
        continue;
      }
    }
    // Rest: drei weitere ohne Text → Vierer-Raster, sonst allein
    const others: PageItem[] = [];
    for (let k = 0; k < 3; k++) {
      const j = findNext(() => true);
      if (j < 0) break;
      others.push(takeIndex(j).item);
    }
    if (others.length === 3) pages.push({ type: 'photos', template: 'four', items: [first.item, ...others] });
    else {
      pages.push({ type: 'photos', template: 'one', items: [first.item] });
      // zu wenig für ein Raster: die herausgenommenen wieder nach vorn
      queue.unshift(...others.map((item) => ({ item, portrait: false })));
    }
  }
  return pages;
}

// ---------- Rechtecke ----------

export function pageSize(spec: FormatSpec): { w: number; h: number } {
  return { w: spec.w + 2 * spec.bleed, h: spec.h + 2 * spec.bleed };
}

function inner(spec: FormatSpec): Rect {
  const off = spec.bleed + spec.margin;
  return { x: off, y: off, w: spec.w - 2 * spec.margin, h: spec.h - 2 * spec.margin };
}

/** Bildrechtecke für eine Fotoseite; `fit` sagt dem Renderer, ob das Bild füllt (beschnitten) oder passt. */
export function photoRects(spec: FormatSpec, template: PageTemplate, count: number): Array<Rect & { fit: 'cover' | 'contain' }> {
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
  }
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
