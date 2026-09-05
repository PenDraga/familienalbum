import type { Family, FamilyMember, Invite, User } from '@prisma/client';

export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toUserDto(u: User) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    isDisabled: u.isDisabled,
    createdAt: iso(u.createdAt),
  };
}

export function toUserBrief(u: Pick<User, 'id' | 'displayName'>) {
  return { id: u.id, displayName: u.displayName };
}

export function toFamilyDto(f: Family) {
  return { id: f.id, name: f.name, createdAt: iso(f.createdAt) };
}

export function toMembershipFlags(m: FamilyMember) {
  return {
    isFamilyAdmin: m.isFamilyAdmin,
    canUpload: m.canUpload,
    canDownload: m.canDownload,
    canComment: m.canComment,
  };
}

export function toMemberDto(m: FamilyMember & { user: Pick<User, 'id' | 'displayName'> }) {
  return {
    userId: m.userId,
    familyId: m.familyId,
    user: toUserBrief(m.user),
    ...toMembershipFlags(m),
    joinedAt: iso(m.joinedAt),
    lastSeenAt: isoOrNull(m.lastSeenAt),
  };
}

export function toInviteDto(i: Invite) {
  return {
    id: i.id,
    familyId: i.familyId,
    code: i.code,
    createdById: i.createdById,
    createdAt: iso(i.createdAt),
    expiresAt: iso(i.expiresAt),
    maxUses: i.maxUses,
    uses: i.uses,
    canUpload: i.canUpload,
    canDownload: i.canDownload,
    canComment: i.canComment,
  };
}
