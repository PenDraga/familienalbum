// Unit-Tests ohne Datenbank: Auswahl und Zeiträume für Rückblick-Videos.
import { describe, expect, it } from 'vitest';
import { periodBounds, selectRecapMedia, weekKey, type RecapCandidate } from '../src/services/recap-select.js';

function cand(day: number, opts: Partial<RecapCandidate> = {}, month = 8): RecapCandidate {
  return { id: `${month}-${day}-${opts.type ?? 'P'}-${opts.commentCount ?? 0}`, type: 'PHOTO', takenAt: new Date(Date.UTC(2026, month, day, 12)), durationSec: null, commentCount: 0, ...opts };
}

describe('selectRecapMedia', () => {
  it('Monat: verteilt gleichmässig über die Tage, bevorzugt Kommentiertes, begrenzt Videos', () => {
    const cands: RecapCandidate[] = [];
    for (let d = 1; d <= 30; d++) {
      for (let k = 0; k < 5; k++) cands.push(cand(d, { id: `d${d}-${k}`, commentCount: k === 2 ? 3 : 0 }));
      cands.push(cand(d, { id: `v${d}`, type: 'VIDEO', durationSec: 12 }));
    }
    const chosen = selectRecapMedia(cands, 'MONTH');
    expect(chosen.length).toBe(32);
    // jeder Tag ist mindestens einmal vertreten (30 Tage, 32 Plätze)
    const days = new Set(chosen.map((c) => c.takenAt.getUTCDate()));
    expect(days.size).toBe(30);
    // pro Tag zuerst das Kommentierte oder das Video (höchste Punkte)
    expect(chosen.filter((c) => c.type === 'VIDEO').length).toBeLessThanOrEqual(6);
    expect(chosen.filter((c) => c.commentCount > 0 || c.type === 'VIDEO').length).toBe(32);
    // chronologisch
    for (let i = 1; i < chosen.length; i++) expect(chosen[i]!.takenAt.getTime()).toBeGreaterThanOrEqual(chosen[i - 1]!.takenAt.getTime());
  });

  it('Sekunden-Film: genau ein Medium pro Tag', () => {
    const cands = [cand(1), cand(1, { commentCount: 2, id: 'best' }), cand(2), cand(9), cand(9, { type: 'VIDEO', id: 'vid' })];
    const chosen = selectRecapMedia(cands, 'SECONDS');
    expect(chosen.map((c) => c.id)).toEqual(['best', '8-2-P-0', 'vid']);
  });

  it('Jahr: verteilt nach Wochen und nimmt alles, wenn wenig da ist', () => {
    const cands = [cand(3, {}, 0), cand(20, {}, 3), cand(15, {}, 7), cand(28, {}, 11)];
    expect(selectRecapMedia(cands, 'YEAR').length).toBe(4);
    expect(weekKey(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-W01');
    expect(weekKey(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-W53');
  });
});

describe('periodBounds', () => {
  it('Monat und Jahr mit deutschem Titel', () => {
    const m = periodBounds('MONTH', '2026-09')!;
    expect([m.start.toISOString(), m.end.toISOString(), m.title]).toEqual(['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'September 2026']);
    const y = periodBounds('YEAR', '2026')!;
    expect([y.start.toISOString(), y.end.toISOString(), y.title]).toEqual(['2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', '2026']);
    expect(periodBounds('SECONDS', '2026-02')!.title).toBe('Sekunden-Film Februar 2026');
  });

  it('lehnt Unsinn ab', () => {
    expect(periodBounds('MONTH', '2026-13')).toBeNull();
    expect(periodBounds('MONTH', '2026')).toBeNull();
    expect(periodBounds('YEAR', '2026-01')).toBeNull();
  });
});
