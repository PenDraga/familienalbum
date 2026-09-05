import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { Errors } from './errors.js';

export interface AccessTokenClaims {
  sub: string; // userId
  email: string;
  isAdmin: boolean;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly accessTtl: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ email: claims.email, isAdmin: claims.isAdmin })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('familienalbum')
      .setAudience('familienalbum-app')
      .setExpirationTime(this.accessTtl)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'familienalbum',
        audience: 'familienalbum-app',
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        throw Errors.unauthorized('Ungültiges Token.', 'TOKEN_INVALID');
      }
      return { sub: payload.sub, email: payload.email, isAdmin: payload.isAdmin === true };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        throw Errors.unauthorized('Das Token ist abgelaufen.', 'TOKEN_EXPIRED');
      }
      throw Errors.unauthorized('Ungültiges Token.', 'TOKEN_INVALID');
    }
  }

  /** Erzeugt einen zufälligen Refresh-Token (Klartext geht an den Client, nur der Hash in die DB). */
  static generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: TokenService.hashRefreshToken(token) };
  }

  static hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
