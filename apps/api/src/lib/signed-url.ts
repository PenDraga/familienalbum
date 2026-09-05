import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signierte URLs für Medien-Dateien (Thumbnails, Preview, Original).
 * Damit können <img>/Video-Player ohne Authorization-Header laden (Flutter Web, Windows).
 * Die Signatur bindet Pfad + Ablaufzeit; ausgestellt wird sie nur an berechtigte Mitglieder.
 */
export class UrlSigner {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  sign(path: string, ttlSeconds = this.ttlSeconds): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${path}?exp=${exp}&sig=${this.compute(path, String(exp))}`;
  }

  verify(path: string, exp: unknown, sig: unknown): boolean {
    if (typeof exp !== 'string' || typeof sig !== 'string' || !/^\d+$/.test(exp)) return false;
    if (Number(exp) <= Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.compute(path, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private compute(path: string, exp: string) {
    return createHmac('sha256', this.secret).update(`${path}\n${exp}`).digest('base64url');
  }
}
