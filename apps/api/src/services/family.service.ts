import type { PrismaClient } from '@prisma/client';
import { Errors } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { iso, isoOrNull, toFamilyDto, toMemberDto, toMembershipFlags } from './dto.js';

export interface MembershipFlagsInput {
  isFamilyAdmin?: boolean;
  canUpload?: boolean;
  canDownload?: boolean;
  canComment?: boolean;
}

export class FamilyService {
  constructor(private readonly prisma: PrismaClient) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.familyMember.findMany({
      where: { userId },
      include: { family: { include: { _count: { select: { members: true } } } } },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => ({
      ...toFamilyDto(m.family),
      membership: { ...toMembershipFlags(m), joinedAt: iso(m.joinedAt), lastSeenAt: isoOrNull(m.lastSeenAt) },
      memberCount: m.family._count.members,
    }));
  }

  async getForMember(familyId: string, userId: string) {
    const m = await this.prisma.familyMember.findUnique({
      where: { userId_familyId: { userId, familyId } },
      include: { family: { include: { _count: { select: { members: true } } } } },
    });
    if (!m) throw Errors.notFound('Familie nicht gefunden.', 'FAMILY_NOT_FOUND');
    return {
      ...toFamilyDto(m.family),
      membership: { ...toMembershipFlags(m), joinedAt: iso(m.joinedAt), lastSeenAt: isoOrNull(m.lastSeenAt) },
      memberCount: m.family._count.members,
    };
  }

  async create(input: { name: string; initialAdminUserId?: string }) {
    if (input.initialAdminUserId) {
      const u = await this.prisma.user.findUnique({ where: { id: input.initialAdminUserId }, select: { id: true } });
      if (!u) throw Errors.notFound('Benutzer für initialAdminUserId nicht gefunden.', 'USER_NOT_FOUND');
    }
    const family = await this.prisma.family.create({
      data: {
        name: input.name,
        members: input.initialAdminUserId
          ? {
              create: {
                userId: input.initialAdminUserId,
                isFamilyAdmin: true,
                canUpload: true,
                canDownload: true,
                canComment: true,
              },
            }
          : undefined,
      },
    });
    return toFamilyDto(family);
  }

  async rename(familyId: string, name: string) {
    const family = await this.prisma.family.update({ where: { id: familyId }, data: { name } });
    return toFamilyDto(family);
  }

  async delete(familyId: string) {
    const exists = await this.prisma.family.findUnique({ where: { id: familyId }, select: { id: true } });
    if (!exists) throw Errors.notFound('Familie nicht gefunden.', 'FAMILY_NOT_FOUND');
    // Cascade löscht Mitgliedschaften, Einladungen, Medien-Datensätze. Dateien räumt der Worker (M2) auf.
    await this.prisma.family.delete({ where: { id: familyId } });
  }

  async listMembers(familyId: string) {
    const members = await this.prisma.familyMember.findMany({
      where: { familyId },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: [{ isFamilyAdmin: 'desc' }, { joinedAt: 'asc' }],
    });
    return members.map(toMemberDto);
  }

  /**
   * Familien-Admin legt ein neues Konto an und macht es sofort zum Mitglied (Alternative zur Einladung).
   * Bestehende Konten dürfen so NICHT hinzugefügt werden (409) – dafür gibt es die Einladung bzw. den globalen Admin.
   */
  async createMemberAccount(
    familyId: string,
    input: { email: string; password: string; displayName: string } & Required<MembershipFlagsInput>,
  ) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) {
      throw Errors.conflict('Diese E-Mail-Adresse hat bereits ein Konto. Lade die Person per Einladungscode ein.', 'EMAIL_TAKEN');
    }
    const member = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, displayName: input.displayName, passwordHash: await hashPassword(input.password) },
      });
      return tx.familyMember.create({
        data: {
          familyId,
          userId: user.id,
          isFamilyAdmin: input.isFamilyAdmin,
          canUpload: input.canUpload,
          canDownload: input.canDownload,
          canComment: input.canComment,
        },
        include: { user: { select: { id: true, displayName: true } } },
      });
    });
    return toMemberDto(member);
  }

  /** Alle Familien mit Zählern (globaler Admin). */
  async listAll() {
    const families = await this.prisma.family.findMany({
      include: { _count: { select: { members: true, media: { where: { deletedAt: null } } } } },
      orderBy: { name: 'asc' },
    });
    return families.map((f) => ({ ...toFamilyDto(f), memberCount: f._count.members, mediaCount: f._count.media }));
  }

  async addMember(familyId: string, userId: string, flags: Required<MembershipFlagsInput>) {
    const [family, user, existing] = await Promise.all([
      this.prisma.family.findUnique({ where: { id: familyId }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      this.prisma.familyMember.findUnique({ where: { userId_familyId: { userId, familyId } } }),
    ]);
    if (!family) throw Errors.notFound('Familie nicht gefunden.', 'FAMILY_NOT_FOUND');
    if (!user) throw Errors.notFound('Benutzer nicht gefunden.', 'USER_NOT_FOUND');
    if (existing) throw Errors.conflict('Benutzer ist bereits Mitglied dieser Familie.', 'ALREADY_MEMBER');

    const member = await this.prisma.familyMember.create({
      data: { familyId, userId, ...flags },
      include: { user: { select: { id: true, displayName: true } } },
    });
    return toMemberDto(member);
  }

  async updateMember(familyId: string, userId: string, flags: MembershipFlagsInput) {
    const member = await this.prisma.familyMember.findUnique({ where: { userId_familyId: { userId, familyId } } });
    if (!member) throw Errors.notFound('Mitglied nicht gefunden.', 'MEMBER_NOT_FOUND');

    if (flags.isFamilyAdmin === false && member.isFamilyAdmin) {
      await this.assertNotLastAdmin(familyId, userId);
    }

    const updated = await this.prisma.familyMember.update({
      where: { userId_familyId: { userId, familyId } },
      data: flags,
      include: { user: { select: { id: true, displayName: true } } },
    });
    return toMemberDto(updated);
  }

  async removeMember(familyId: string, userId: string) {
    const member = await this.prisma.familyMember.findUnique({ where: { userId_familyId: { userId, familyId } } });
    if (!member) throw Errors.notFound('Mitglied nicht gefunden.', 'MEMBER_NOT_FOUND');
    if (member.isFamilyAdmin) await this.assertNotLastAdmin(familyId, userId);
    await this.prisma.familyMember.delete({ where: { userId_familyId: { userId, familyId } } });
  }

  private async assertNotLastAdmin(familyId: string, userId: string) {
    const otherAdmins = await this.prisma.familyMember.count({
      where: { familyId, isFamilyAdmin: true, NOT: { userId } },
    });
    if (otherAdmins === 0) {
      throw Errors.conflict('Die Familie braucht mindestens einen Familien-Administrator.', 'LAST_FAMILY_ADMIN');
    }
  }
}
