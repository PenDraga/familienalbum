import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import type { AuthService } from './auth.service.js';
import { iso, toFamilyDto, toInviteDto, toMembershipFlags, toUserDto } from './dto.js';

/** Lesbarer Code ohne verwechselbare Zeichen (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateInviteCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return out;
}

export interface CreateInviteInput {
  expiresInHours: number;
  maxUses: number;
  canUpload: boolean;
  canDownload: boolean;
  canComment: boolean;
}

export interface RegistrationInput {
  email: string;
  password: string;
  displayName: string;
}

export class InviteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  async create(familyId: string, createdById: string, input: CreateInviteInput) {
    const invite = await this.prisma.invite.create({
      data: {
        familyId,
        createdById,
        code: generateInviteCode(),
        expiresAt: new Date(Date.now() + input.expiresInHours * 3600 * 1000),
        maxUses: input.maxUses,
        canUpload: input.canUpload,
        canDownload: input.canDownload,
        canComment: input.canComment,
      },
    });
    return toInviteDto(invite);
  }

  /** Aktive (nicht abgelaufene, nicht aufgebrauchte) Einladungen einer Familie. */
  async listActive(familyId: string) {
    const invites = await this.prisma.invite.findMany({
      where: { familyId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return invites.filter((i) => i.uses < i.maxUses).map(toInviteDto);
  }

  async revoke(familyId: string, inviteId: string) {
    const invite = await this.prisma.invite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.familyId !== familyId) throw Errors.notFound('Einladung nicht gefunden.', 'INVITE_NOT_FOUND');
    await this.prisma.invite.delete({ where: { id: inviteId } });
  }

  async preview(code: string) {
    const invite = await this.prisma.invite.findUnique({ where: { code }, include: { family: true } });
    if (!invite) throw Errors.notFound('Einladung nicht gefunden.', 'INVITE_NOT_FOUND');
    return {
      familyName: invite.family.name,
      expiresAt: iso(invite.expiresAt),
      isValid: invite.expiresAt.getTime() > Date.now() && invite.uses < invite.maxUses,
      canUpload: invite.canUpload,
      canDownload: invite.canDownload,
      canComment: invite.canComment,
    };
  }

  /**
   * Einladung annehmen.
   * - `userId` gesetzt: bestehender, angemeldeter Benutzer wird Mitglied.
   * - sonst `registration`: neues Konto wird angelegt, Mitgliedschaft erzeugt und Tokens ausgegeben.
   */
  async accept(code: string, actor: { userId: string } | { registration: RegistrationInput }, userAgent?: string) {
    const invite = await this.prisma.invite.findUnique({ where: { code }, include: { family: true } });
    if (!invite) throw Errors.notFound('Einladung nicht gefunden.', 'INVITE_NOT_FOUND');
    if (invite.expiresAt.getTime() <= Date.now()) throw Errors.gone('Diese Einladung ist abgelaufen.', 'INVITE_EXPIRED');
    if (invite.uses >= invite.maxUses) throw Errors.gone('Diese Einladung wurde bereits verwendet.', 'INVITE_USED_UP');

    const result = await this.prisma.$transaction(async (tx) => {
      let userId: string;
      let newUser: Awaited<ReturnType<typeof tx.user.create>> | null = null;

      if ('userId' in actor) {
        userId = actor.userId;
        const existing = await tx.familyMember.findUnique({
          where: { userId_familyId: { userId, familyId: invite.familyId } },
        });
        if (existing) throw Errors.conflict('Du bist bereits Mitglied dieses Albums.', 'ALREADY_MEMBER');
      } else {
        const taken = await tx.user.findUnique({ where: { email: actor.registration.email }, select: { id: true } });
        if (taken) {
          throw Errors.conflict(
            'Diese E-Mail-Adresse ist bereits registriert. Bitte anmelden und die Einladung dann annehmen.',
            'EMAIL_TAKEN',
          );
        }
        newUser = await tx.user.create({
          data: {
            email: actor.registration.email,
            displayName: actor.registration.displayName,
            passwordHash: await hashPassword(actor.registration.password),
          },
        });
        userId = newUser.id;
      }

      // Nutzung atomar zählen; schlägt fehl, wenn parallel die letzte Nutzung verbraucht wurde.
      const consumed = await tx.invite.updateMany({
        where: { id: invite.id, uses: { lt: invite.maxUses } },
        data: { uses: { increment: 1 } },
      });
      if (consumed.count === 0) throw Errors.gone('Diese Einladung wurde bereits verwendet.', 'INVITE_USED_UP');

      const membership = await tx.familyMember.create({
        data: {
          userId,
          familyId: invite.familyId,
          isFamilyAdmin: false,
          canUpload: invite.canUpload,
          canDownload: invite.canDownload,
          canComment: invite.canComment,
        },
      });

      return { membership, newUser };
    });

    const response: {
      family: ReturnType<typeof toFamilyDto>;
      membership: ReturnType<typeof toMembershipFlags>;
      user?: ReturnType<typeof toUserDto>;
      tokens?: Awaited<ReturnType<AuthService['issueTokens']>>;
    } = {
      family: toFamilyDto(invite.family),
      membership: toMembershipFlags(result.membership),
    };

    if (result.newUser) {
      response.user = toUserDto(result.newUser);
      response.tokens = await this.auth.issueTokens(result.newUser, userAgent);
    }
    return response;
  }
}
