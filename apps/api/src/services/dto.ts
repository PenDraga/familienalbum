import type { Family, FamilyMember, Invite, User } from '@prisma/client';
import { API_PREFIX } from '../config/constants.js';
import type { UrlSigner } from '../lib/signed-url.js';

export const iso = (d: Date) => d.toISOString();

/** Signiert Avatar-Links; wird in app.ts gesetzt (die DTOs selbst haben keinen Zugriff auf den Server). */
let avatarSigner: UrlSigner | null = null;
export function configureDto(opts: { signer: UrlSigner }) {
  avatarSigner = opts.signer;
}

/** Eine Woche gültig – Avatare hängen in Listen und Kommentaren, der Client cached sie über `v`. */
const AVATAR_LINK_TTL_SECONDS = 7 * 24 * 3600;

export function avatarUrl(u: { id: string; avatarUpdatedAt?: Date | null }): string | null {
  if (!u.avatarUpdatedAt || !avatarSigner) return null;
  const signed = avatarSigner.sign(`${API_PREFIX}/users/${u.id}/avatar`, AVATAR_LINK_TTL_SECONDS);
  return `${signed}&v=${u.avatarUpdatedAt.getTime()}`;
}
export const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toUserDto(u: User) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    isDisabled: u.isDisabled,
    createdAt: iso(u.createdAt),
    avatarUrl: avatarUrl(u),
  };
}

export type UserBriefSource = Pick<User, 'id' | 'displayName'> & { avatarUpdatedAt?: Date | null };

export function toUserBrief(u: UserBriefSource) {
  return { id: u.id, displayName: u.displayName, avatarUrl: avatarUrl(u) };
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

export function toMemberDto(m: FamilyMember & { user: UserBriefSource }) {
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
