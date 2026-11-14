/**
 * Profile photos (rj t179u). profiles.avatar_url is either an uploaded photo's Storage
 * path ('avatars/<user id>/<file>.jpg', public bucket) or an https URL (the Google
 * picture). No avatar -> the generic person icon.
 */
export const AVATAR_BUCKET = 'avatars';
/** Uploaded photos are cropped to a square and saved at this size (JPEG). */
export const AVATAR_SIZE = 512;

export function avatarPublicUrl(
  raw: string | null | undefined,
  supabaseUrl: string
): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  if (/^https:\/\//i.test(v)) return v;
  const path = v.replace(/^\/+/, '');
  if (!path.startsWith(`${AVATAR_BUCKET}/`) || path.includes('..')) return null;
  const base = supabaseUrl.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/storage/v1/object/public/${path}`;
}

/** Storage path inside the bucket for a new upload (a new name each time, so caches update). */
export function avatarStoragePath(userId: string, now: number, rand: string): string {
  const safeRand = rand.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'x';
  return `${userId}/${now}-${safeRand}.jpg`;
}

/** The uploaded file (inside the bucket) avatar_url points at, if it is one. */
export function avatarObjectName(raw: string | null | undefined): string | null {
  const v = (raw || '').trim();
  return v.startsWith(`${AVATAR_BUCKET}/`) ? v.slice(AVATAR_BUCKET.length + 1) : null;
}

/** Centered square crop of a w x h image. */
export function squareCrop(
  width: number,
  height: number
): {
  originX: number;
  originY: number;
  width: number;
  height: number;
} {
  const side = Math.max(1, Math.floor(Math.min(width, height)));
  return {
    originX: Math.max(0, Math.floor((width - side) / 2)),
    originY: Math.max(0, Math.floor((height - side) / 2)),
    width: side,
    height: side,
  };
}

/** Old files to delete after a change: everything in my folder except the current one. */
export function staleAvatarFiles(
  userId: string,
  listedNames: string[],
  keepObjectName: string | null
): string[] {
  return listedNames
    .filter((n) => n && n !== '.emptyFolderPlaceholder')
    .map((n) => `${userId}/${n}`)
    .filter((p) => p !== keepObjectName);
}
