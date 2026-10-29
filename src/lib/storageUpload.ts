import { bytesForStorageUpload } from './base64';
import { getSupabaseUrl, isLocalSupabaseUrl } from './env';
import { supabase } from './supabase';

export const PHOTO_UPLOAD_ERROR =
  'Could not upload the photo. Your listing was saved — you can retry the photo.';
export const PHOTO_READ_ERROR = 'Could not read the photo. Try another image.';

export function sanitizeStorageFilename(name: string, fallback = 'photo.jpg'): string {
  const trimmed = (name || fallback).trim() || fallback;
  return trimmed.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function locationPhotoPublicUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  const path = storagePath.replace(/^location-photos\//, '').replace(/^\//, '');
  const base = getSupabaseUrl();
  if (!base || !path) return null;
  return `${base}/storage/v1/object/public/location-photos/${path}`;
}

async function uploadToBucket(
  bucket: 'chat-images' | 'location-photos',
  path: string,
  base64: string,
  contentType: string
): Promise<{ error: Error | null }> {
  let body: ArrayBuffer;
  try {
    body = bytesForStorageUpload(base64);
  } catch {
    return { error: new Error(PHOTO_READ_ERROR) };
  }
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType: contentType || 'image/jpeg',
    upsert: true,
  });
  return { error: error ? new Error(error.message) : null };
}

export async function uploadChatImage(args: {
  threadId: string;
  filename: string;
  base64: string;
  contentType: string;
}): Promise<{ error?: string }> {
  const filename = sanitizeStorageFilename(args.filename);
  const path = `${args.threadId}/${filename}`;
  const uploaded = await uploadToBucket('chat-images', path, args.base64, args.contentType);
  if (!uploaded.error) {
    const { data, error } = await supabase.rpc('register_chat_image', {
      p_thread_id: args.threadId,
      p_filename: filename,
      p_content_type: args.contentType,
    });
    if (error || data?.error) return { error: error?.message || String(data?.error) };
    return {};
  }

  const { data, error } = await supabase.rpc('put_chat_image', {
    p_thread_id: args.threadId,
    p_filename: filename,
    p_bytes_base64: args.base64,
    p_content_type: args.contentType,
  });
  if (error || data?.error) {
    return {
      error:
        error?.message ||
        String(data?.error) ||
        (isLocalSupabaseUrl()
          ? 'Local Storage is not available on the proxy'
          : 'Could not send the photo. Try another image.'),
    };
  }
  return {};
}

export async function uploadLocationPhoto(args: {
  locationId: string;
  filename: string;
  base64?: string | null;
  contentType?: string;
  isCover?: boolean;
  caption?: string | null;
}): Promise<{ error?: string; storagePath?: string }> {
  const filename = sanitizeStorageFilename(args.filename, 'facility.jpg');
  const path = `${args.locationId}/${filename}`;

  if (!args.base64 || args.base64.length <= 8) {
    return { error: PHOTO_READ_ERROR };
  }

  const uploaded = await uploadToBucket(
    'location-photos',
    path,
    args.base64,
    args.contentType || 'image/jpeg'
  );
  if (uploaded.error) {
    return { error: PHOTO_UPLOAD_ERROR };
  }

  const { data, error } = await supabase.rpc('put_location_photo', {
    p_location_id: args.locationId,
    p_filename: filename,
    p_is_cover: args.isCover !== false,
    p_caption: args.caption ?? null,
  });
  if (error || data?.error) return { error: PHOTO_UPLOAD_ERROR };
  return { storagePath: data?.storage_path || path };
}
