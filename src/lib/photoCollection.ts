/** A listing's photo collection: operator photos first, then photos from its reviews. */

export type CollectionRow = {
  id: string;
  source: 'listing' | 'review' | string;
  bucket?: string | null;
  storage_path: string;
  review_id?: string | null;
  source_rank?: number | null;
  cover_rank?: number | null;
  sort_order?: number | null;
  created_at?: string | null;
};

export type CollectionImage = {
  key: string;
  uri: string;
  label?: string | null;
  fromReview: boolean;
};

export const FROM_REVIEW_LABEL = 'From a review';

/** Same order as the view's documented order (in case rows arrive unordered). */
export function sortCollection<T extends CollectionRow>(rows: T[] | null | undefined): T[] {
  const n = (v: number | null | undefined) => v ?? 0;
  return [...(rows ?? [])].sort(
    (a, b) =>
      n(a.source_rank) - n(b.source_rank) ||
      n(a.cover_rank) - n(b.cover_rank) ||
      n(a.sort_order) - n(b.sort_order) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  );
}

/**
 * Carousel images for the collection. `urlFor(source, path)` builds the public URL for
 * the right bucket; rows without a URL are dropped. Review photos carry 'From a review'.
 */
export function collectionImages(
  rows: CollectionRow[] | null | undefined,
  urlFor: (source: string, path: string) => string | null
): CollectionImage[] {
  return sortCollection(rows)
    .map((r) => {
      const fromReview = r.source === 'review';
      return {
        key: `${fromReview ? 'rv' : 'op'}-${r.id}`,
        uri: urlFor(r.source, r.storage_path) || '',
        label: fromReview ? FROM_REVIEW_LABEL : null,
        fromReview,
      };
    })
    .filter((img) => !!img.uri);
}
