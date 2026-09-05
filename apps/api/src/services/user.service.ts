import type { PrismaClient } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { toFamilyDto, toMembershipFlags, toUserDto, iso, isoOrNull } from './dto.js';

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { family: true }, orderBy: { joinedAt: 'asc' } } },
    });
    if (!user) throw Errors.notFound('Benutzer nicht gefunden.', 'USER_NOT_FOUND');
    return {
      ...toUserDto(user),
      families: user.memberships.map((m) => ({
        ...toFamilyDto(m.family),
        membership: { ...toMembershipFlags(m), joinedAt: iso(m.joinedAt), lastSeenAt: isoOrNull(m.lastSeenAt) },
      })),
    };
  }

  /** Benutzer mit seinen Familien (globaler Admin). */
  async getWithMemberships(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { family: true }, orderBy: { joinedAt: 'asc' } }, _count: { select: { devices: true } } },
    });
    if (!user) throw Errors.notFound('Benutzer nicht gefunden.', 'USER_NOT_FOUND');
    return {
      ...toUserDto(user),
      deviceCount: user._count.devices,
      families: user.memberships.map((m) => ({
        ...toFamilyDto(m.family),
        membership: { ...toMembershipFlags(m), joinedAt: iso(m.joinedAt), lastSeenAt: isoOrNull(m.lastSeenAt) },
      })),
    };
  }

  /** Eigenes Profil: Anzeigename und/oder Passwort (mit Bestätigung des aktuellen). */
  async updateMe(userId: string, patch: { displayName?: string; currentPassword?: string; newPassword?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('Benutzer nicht gefunden.', 'USER_NOT_FOUND');
    if (patch.newPassword) {
      if (!patch.currentPassword || !(await verifyPassword(user.passwordHash, patch.currentPassword))) {
        throw Errors.forbidden('Das aktuelle Passwort ist falsch.', 'WRONG_PASSWORD');
      }
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: patch.displayName,
        passwordHash: patch.newPassword ? await hashPassword(patch.newPassword) : undefined,
      },
    });
    if (patch.newPassword) {
      // Andere Sitzungen beenden – die aktuelle behält ihr Access-Token bis zum Ablauf
      await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return toUserDto(updated);
  }

  async list(opts: { q?: string; limit: number; offset: number }) {
    const where = opts.q
      ? {
          OR: [
            { email: { contains: opts.q, mode: 'insensitive' as const } },
            { displayName: { contains: opts.q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'asc' }, take: opts.limit, skip: opts.offset }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(toUserDto), total };
  }

  async create(input: { email: string; password: string; displayName: string; isAdmin: boolean }) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw Errors.conflict('Diese E-Mail-Adresse ist bereits registriert.', 'EMAIL_TAKEN');

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        isAdmin: input.isAdmin,
        passwordHash: await hashPassword(input.password),
      },
    });
    return toUserDto(user);
  }

  async update(
    userId: string,
    patch: { displayName?: string; isAdmin?: boolean; isDisabled?: boolean; password?: string },
    actingUserId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('Benutzer nicht gefunden.', 'USER_NOT_FOUND');

    if (userId === actingUserId) {
      if (patch.isAdmin === false) throw Errors.conflict('Du kannst dir nicht selbst die Admin-Rechte entziehen.', 'SELF_DEMOTE');
      if (patch.isDisabled === true) throw Errors.conflict('Du kannst dich nicht selbst sperren.', 'SELF_DISABLE');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: patch.displayName,
        isAdmin: patch.isAdmin,
        isDisabled: patch.isDisabled,
        passwordHash: patch.password ? await hashPassword(patch.password) : undefined,
      },
    });

    // Sperre oder Passwortwechsel beendet alle bestehenden Sitzungen.
    if (patch.isDisabled === true || patch.password) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return toUserDto(updated);
  }

  async stats() {
    const [users, disabledUsers, families, media, storage] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isDisabled: true } }),
      this.prisma.family.count(),
      this.prisma.media.count({ where: { deletedAt: null } }),
      this.prisma.media.aggregate({ where: { deletedAt: null }, _sum: { sizeBytes: true } }),
    ]);
    return { users, disabledUsers, families, media, storageBytes: storage._sum.sizeBytes ?? 0 };
  }
}
