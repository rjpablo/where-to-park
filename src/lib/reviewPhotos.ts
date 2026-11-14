/** Review photos: limits, ordering, file names. */

/** Default cap per review; the server enforces the same default (review_photo_limit()). */
export const REVIEW_PHOTO_MAX = 5;

/** How many more photos can be added, given those saved and those picked but not sent. */
export function photosLeft(saved: number, staged: number, max = REVIEW_PHOTO_MAX): number {
  return Math.max(0, max - Math.max(0, saved) - Math.max(0, staged));
}

export type ReviewPhotoRow = { id: string; storage_path: string; sort_order?: number | null };

/** A review's photos in upload order (sort_order, then path). */
export function sortReviewPhotos<T extends ReviewPhotoRow>(rows: T[] | null | undefined): T[] {
  return [...(rows ?? [])].sort(
    (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.storage_path.localeCompare(b.storage_path)
  );
}

/** Unique file name per upload so re-uploads never overwrite another photo. */
export function reviewPhotoFilename(index: number, now: number, rand: string): string {
  const safe = rand.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'x';
  return `${now}-${index}-${safe}.jpg`;
}

/** Notice for register_review_photo errors. */
export function reviewPhotoError(code: string | null | undefined, max = REVIEW_PHOTO_MAX): string {
  if (code === 'too_many_photos') return `A review can have up to ${max} photos`;
  if (code === 'Permission denied') return 'You can only add photos to your own review';
  return 'Could not upload the photo. Try again.';
}
