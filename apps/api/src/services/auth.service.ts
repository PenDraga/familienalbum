import type { PrismaClient, User } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { TokenService } from '../lib/tokens.js';
import { iso, toUserDto } from './dto.js';

export interface TokenPairDto {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

/** "15m" | "1h" | "30s" | "2d" | "900" (Sekunden) → Sekunden */
export function ttlToSeconds(ttl: string): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(ttl.trim());
  if (!m) throw new Error(`Ungültige TTL: ${ttl}`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return n;
  }
}

export class AuthService {
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {
    this.accessTtlSeconds = ttlToSeconds(config.accessTokenTtl);
  }

  async login(email: string, password: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Gleiche Fehlermeldung für "unbekannt" und "falsches Passwort" (kein User-Enumeration).
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw Errors.unauthorized('E-Mail oder Passwort ist falsch.', 'INVALID_CREDENTIALS');
    }
    if (user.isDisabled) throw Errors.forbidden('Dieses Konto ist gesperrt.', 'USER_DISABLED');

    return { user: toUserDto(user), tokens: await this.issueTokens(user, userAgent) };
  }

  async issueTokens(user: Pick<User, 'id' | 'email' | 'isAdmin'>, userAgent?: string): Promise<TokenPairDto> {
    const accessToken = await this.tokens.signAccessToken({ sub: user.id, email: user.email, isAdmin: user.isAdmin });
    const { token, hash } = TokenService.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * 86400 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt, userAgent: userAgent?.slice(0, 255) ?? null },
    });

    return {
      accessToken,
      accessTokenExpiresIn: this.accessTtlSeconds,
      refreshToken: token,
      refreshTokenExpiresAt: iso(expiresAt),
    };
  }

  /** Refresh-Token-Rotation: altes Token wird widerrufen, neues Paar ausgegeben. */
  async refresh(refreshToken: string, userAgent?: string) {
    const hash = TokenService.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });

    if (!stored) throw Errors.unauthorized('Ungültiges Refresh-Token.', 'REFRESH_INVALID');

    if (stored.revokedAt) {
      // Wiederverwendung eines bereits rotierten Tokens → vermutlich gestohlen: alle Sitzungen beenden.
      await this.logoutAll(stored.userId);
      throw Errors.unauthorized('Refresh-Token wurde bereits verwendet. Bitte neu anmelden.', 'REFRESH_REUSED');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw Errors.unauthorized('Refresh-Token ist abgelaufen.', 'REFRESH_EXPIRED');
    }
    if (stored.user.isDisabled) throw Errors.forbidden('Dieses Konto ist gesperrt.', 'USER_DISABLED');

    const [, tokens] = await Promise.all([
      this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
      this.issueTokens(stored.user, userAgent),
    ]);

    return { user: toUserDto(stored.user), tokens };
  }

  async logout(refreshToken: string) {
    const hash = TokenService.hashRefreshToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
