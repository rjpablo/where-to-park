import { bytesForStorageUpload } from './base64';
import { AVATAR_BUCKET, avatarObjectName, avatarStoragePath, staleAvatarFiles } from './avatar';
import { supabase } from './supabase';

/** Delete my old photo files (all but `keep`). Best effort. */
async function cleanUp(userId: string, keep: string | null) {
  try {
    const { data } = await supabase.storage.from(AVATAR_BUCKET).list(userId, { limit: 100 });
    const stale = staleAvatarFiles(
      userId,
      (data || []).map((f) => f.name),
      keep
    );
    if (stale.length) await supabase.storage.from(AVATAR_BUCKET).remove(stale);
  } catch {
    // Leftovers are harmless and removed on the next change.
  }
}

/** Upload a processed photo, make it my avatar, delete the previous file. */
export async function uploadMyAvatar(
  userId: string,
  image: { base64: string; contentType: string }
): Promise<{ avatarUrl?: string; error?: string }> {
  const path = avatarStoragePath(userId, Date.now(), Math.random().toString(36).slice(2));
  let body: ArrayBuffer;
  try {
    body = bytesForStorageUpload(image.base64);
  } catch {
    return { error: 'Could not read the photo. Try another image.' };
  }
  const { error: upErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, body, { contentType: image.contentType || 'image/jpeg', upsert: false });
  if (upErr) return { error: `Could not upload the photo: ${upErr.message}` };
  const { data, error } = await supabase.rpc('set_my_avatar', { p_path: path });
  if (error || data?.error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    return { error: error?.message || String(data?.error) };
  }
  const avatarUrl = String(data.avatar_url);
  await cleanUp(userId, avatarObjectName(avatarUrl));
  return { avatarUrl };
}

/** Remove photo: generic icon again; uploaded files are deleted. */
export async function removeMyAvatar(userId: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.rpc('clear_my_avatar');
  if (error || data?.error) return { error: error?.message || String(data?.error) };
  await cleanUp(userId, null);
  return {};
}
