import type { RecapKind } from '@prisma/client';

/** Kandidat für den Rückblick – bewusst schlank, damit die Auswahl ohne Datenbank testbar ist. */
export interface RecapCandidate {
  id: string;
  type: 'PHOTO' | 'VIDEO';
  takenAt: Date;
  durationSec: number | null;
  commentCount: number;
}

export interface RecapPlan {
  /** Zielgrösse der Auswahl */
  target: number;
  /** Sekunden pro Foto */
  photoSeconds: number;
  /** Sekunden pro Video-Ausschnitt */
  clipSeconds: number;
  /** höchstens so viele Videos */
  maxVideos: number;
  /** Schlüssel, der die Verteilung steuert: ein Eintrag pro Tag / Woche / Monat */
  bucket: (d: Date) => string;
}

export function planFor(kind: RecapKind): RecapPlan {
  switch (kind) {
    case 'MONTH':
      return { target: 32, photoSeconds: 2.8, clipSeconds: 2.5, maxVideos: 6, bucket: dayKey };
    case 'YEAR':
      return { target: 60, photoSeconds: 2.2, clipSeconds: 2.0, maxVideos: 10, bucket: weekKey };
    case 'SECONDS':
      // Ein Moment pro Tag, jeweils eine Sekunde – wie der Sekunden-Film in FamilyAlbum
      return { target: 366, photoSeconds: 1.0, clipSeconds: 1.0, maxVideos: 366, bucket: dayKey };
    default:
      throw new Error(`Unbekannte Rückblick-Art: ${String(kind)}`);
  }
}

/**
 * Wählt Medien gleichmässig über den Zeitraum verteilt: pro Tag/Woche ein Topf, daraus reihum das
 * bestbewertete (Kommentare zählen doppelt, Videos leicht bevorzugt). Beim Sekunden-Film genau ein
 * Medium pro Tag. Ergebnis chronologisch.
 */
export function selectRecapMedia(candidates: RecapCandidate[], kind: RecapKind): RecapCandidate[] {
  const plan = planFor(kind);
  const buckets = new Map<string, RecapCandidate[]>();
  for (const c of [...candidates].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())) {
    const key = plan.bucket(c.takenAt);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(c);
  }
  for (const list of buckets.values()) list.sort((a, b) => score(b) - score(a));

  const chosen: RecapCandidate[] = [];
  let videos = 0;
  const perBucket = kind === 'SECONDS' ? 1 : Number.POSITIVE_INFINITY;
  const taken = new Map<string, number>();
  let progress = true;
  while (chosen.length < plan.target && progress) {
    progress = false;
    for (const [key, list] of buckets) {
      if (chosen.length >= plan.target) break;
      if ((taken.get(key) ?? 0) >= perBucket) continue;
      const next = list.find((c) => !chosen.includes(c) && (c.type === 'PHOTO' || videos < plan.maxVideos));
      if (!next) continue;
      chosen.push(next);
      if (next.type === 'VIDEO') videos++;
      taken.set(key, (taken.get(key) ?? 0) + 1);
      progress = true;
    }
  }
  return chosen.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
}

function score(c: RecapCandidate) {
  return 1 + c.commentCount * 2 + (c.type === 'VIDEO' ? 0.5 : 0);
}

export function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function weekKey(d: Date) {
  // ISO-Woche reicht als Verteilungsschlüssel (Jahr-Woche)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Zeitraum aus `JJJJ-MM` (Monat / Sekunden-Film) oder `JJJJ` (Jahr). */
export function periodBounds(kind: RecapKind, period: string): { start: Date; end: Date; title: string } | null {
  if (kind === 'YEAR') {
    if (!/^\d{4}$/.test(period)) return null;
    const y = Number(period);
    return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)), title: String(y) };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  if (mo < 1 || mo > 12) return null;
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const title = start.toLocaleDateString('de-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start, end: new Date(Date.UTC(y, mo, 1)), title: kind === 'SECONDS' ? `Sekunden-Film ${title}` : title };
}
