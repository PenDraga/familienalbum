/**
 * Englische Fehlertexte nach Fehlercode. Deutsch bleibt die Vorlage in den Services; der Fehler-Handler ersetzt
 * `detail`, wenn die Anfrage `Accept-Language: en…` schickt. Codes ohne Eintrag bleiben deutsch.
 */
export const MESSAGES_EN: Record<string, string> = {
  ADMIN_REQUIRED: 'Only global administrators can do that.',
  ALREADY_MEMBER: 'This user is already a member of this album.',
  AVATAR_EMPTY: 'No image received.',
  AVATAR_MISSING: 'No profile picture.',
  AVATAR_UNREADABLE: 'The image could not be read (upload a JPEG, PNG or WebP).',
  COMMENT_NOT_FOUND: 'Comment not found.',
  DUPLICATE_MEDIA: 'This file is already in the album.',
  EMAIL_TAKEN: 'This e-mail address already has an account. Sign in and then accept the invitation.',
  EXPORT_SCOPE_INVALID: 'The period must be "alle" or a month such as 2026-09.',
  FAMILY_ID_MISSING: 'Album ID is missing.',
  FAMILY_NOT_FOUND: 'Album not found.',
  FILE_MISSING: 'The file is not available (yet).',
  HASH_MISMATCH: 'The file arrived damaged (hash mismatch). Please upload it again.',
  INVALID_CREDENTIALS: 'E-mail or password is incorrect.',
  INVALID_CURSOR: 'Invalid cursor.',
  INVITE_EXPIRED: 'This invitation has expired.',
  INVITE_NOT_FOUND: 'Invitation not found.',
  INVITE_USED_UP: 'This invitation has already been used.',
  LAST_ADMIN: 'The last global administrator cannot be deleted.',
  LAST_FAMILY_ADMIN: 'The album needs at least one album admin.',
  LOGOUT_TARGET_MISSING: 'Provide refreshToken or all:true.',
  MEDIA_NOT_FOUND: 'Item not found.',
  MEDIA_NOT_READY: 'This item is still being processed.',
  MEMBER_NOT_FOUND: 'Member not found.',
  MISSING_TOKEN: 'Sign-in required.',
  NOT_A_MEMBER: 'You are not a member of this album.',
  NOT_A_VIDEO: 'Only videos have a preview.',
  NOT_COMMENT_OWNER: 'Only the author or an admin can change comments.',
  NOT_OWNER: 'Only the uploader or an album admin can do that.',
  PERMISSION_ISFAMILYADMIN: 'Only album admins can do that.',
  PERMISSION_CANUPLOAD: 'You are not allowed to upload to this album.',
  PERMISSION_CANDOWNLOAD: 'You are not allowed to download originals from this album.',
  PERMISSION_CANCOMMENT: 'You are not allowed to comment in this album.',
  RECAP_EMPTY: 'There are no photos or videos in this period.',
  RECAP_NOT_FOUND: 'Recap not found.',
  RECAP_NOT_READY: 'The video is not finished yet.',
  RECAP_PERIOD_INVALID: 'Period: month as YYYY-MM, year as YYYY.',
  REFRESH_EXPIRED: 'The session has expired. Please sign in again.',
  REFRESH_INVALID: 'Invalid session. Please sign in again.',
  REFRESH_REUSED: 'This session was already used. Please sign in again.',
  REGISTRATION_REQUIRED: 'Without signing in, email, password and displayName are required.',
  ROUTE_NOT_FOUND: 'This route does not exist.',
  SELF_DELETE: 'You cannot delete your own account.',
  SELF_DEMOTE: 'You cannot remove your own admin rights.',
  SELF_DISABLE: 'You cannot lock your own account.',
  SIGNATURE_INVALID: 'The link is invalid or has expired.',
  TOKEN_EXPIRED: 'The token has expired.',
  TOKEN_INVALID: 'Invalid token.',
  UPLOAD_EXPIRED: 'The upload session has expired. Please start again.',
  UPLOAD_NOT_FOUND: 'Upload session not found.',
  USER_DISABLED: 'This account is locked.',
  USER_NOT_FOUND: 'User not found.',
  VALIDATION_ERROR: 'The request contains invalid data.',
  WRONG_PASSWORD: 'The current password is incorrect.',
  INTERNAL_ERROR: 'Something went wrong on the server. Please try again later.',
};

/** Sprache aus `Accept-Language` (nur de/en; Standard de). */
export function requestLanguage(header: string | string[] | undefined): 'de' | 'en' {
  const value = (Array.isArray(header) ? header[0] : header) ?? '';
  for (const part of value.split(',')) {
    const tag = part.trim().split(';')[0]?.toLowerCase() ?? '';
    if (tag.startsWith('en')) return 'en';
    if (tag.startsWith('de')) return 'de';
  }
  return 'de';
}
