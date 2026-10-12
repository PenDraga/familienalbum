import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { TokenService } from '../lib/tokens.js';
import type { Mailer } from './mail.service.js';

export interface PasswordResetOptions {
  /** Öffentliche Basis-URL der Web-App, z.B. https://album.example.ch – daraus wird der Link gebaut. */
  publicUrl: string;
  ttlMinutes: number;
  appName?: string;
}

/**
 * Passwort vergessen: Link per E-Mail, einmalig nutzbar, zeitlich begrenzt.
 * Die Antwort auf die Anforderung ist immer gleich – egal ob die Adresse bekannt ist (keine User-Enumeration).
 */
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: Mailer,
    private readonly options: PasswordResetOptions,
    private readonly log: { info(o: object, msg: string): void; warn(o: object, msg: string): void } = { info() {}, warn() {} },
  ) {}

  get enabled() {
    return this.mailer.enabled && this.options.publicUrl.length > 0;
  }

  /** Erzeugt Token und verschickt die Mail. Für unbekannte/gesperrte Adressen passiert still nichts. */
  async request(email: string): Promise<void> {
    if (!this.enabled) throw Errors.serviceUnavailable('Passwort-Reset ist auf diesem Server nicht eingerichtet.', 'PASSWORD_RESET_DISABLED');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDisabled) {
      this.log.info({ email }, 'password reset requested for unknown or disabled user');
      return;
    }

    // Ältere offene Tokens des Benutzers verfallen – nur der neueste Link gilt
    await this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.options.ttlMinutes * 60_000);
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: TokenService.hashRefreshToken(token), expiresAt } });

    const link = `${this.options.publicUrl.replace(/\/$/, '')}/reset?token=${token}`;
    const appName = this.options.appName ?? 'Familienalbum';
    await this.mailer.send({
      to: user.email,
      subject: `${appName}: Passwort zurücksetzen`,
      text: [
        `Hallo ${user.displayName}`,
        '',
        `Jemand hat für dein ${appName}-Konto ein neues Passwort angefordert. Mit diesem Link kannst du es setzen:`,
        link,
        '',
        `Der Link ist ${this.options.ttlMinutes} Minuten gültig und funktioniert nur einmal.`,
        'Falls du das nicht warst, kannst du diese Nachricht ignorieren – dein Passwort bleibt unverändert.',
      ].join('\n'),
      html: [
        `<p>Hallo ${escapeHtml(user.displayName)}</p>`,
        `<p>Jemand hat für dein ${appName}-Konto ein neues Passwort angefordert. Mit diesem Link kannst du es setzen:</p>`,
        `<p><a href="${link}">Neues Passwort setzen</a></p>`,
        `<p>Der Link ist ${this.options.ttlMinutes} Minuten gültig und funktioniert nur einmal.<br>`,
        'Falls du das nicht warst, kannst du diese Nachricht ignorieren – dein Passwort bleibt unverändert.</p>',
      ].join('\n'),
    });
    this.log.info({ userId: user.id }, 'password reset mail sent');
  }

  /** Token prüfen, Passwort setzen, Token verbrauchen, alle Sitzungen beenden. */
  async confirm(token: string, newPassword: string): Promise<{ email: string }> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: TokenService.hashRefreshToken(token) },
      include: { user: true },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw Errors.badRequest('Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.', 'RESET_TOKEN_INVALID');
    }
    if (stored.user.isDisabled) throw Errors.forbidden('Dieses Konto ist gesperrt.', 'USER_DISABLED');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: stored.userId }, data: { passwordHash: await hashPassword(newPassword) } }),
      this.prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: now } }),
      this.prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    this.log.info({ userId: stored.userId }, 'password reset completed');
    return { email: stored.user.email };
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
