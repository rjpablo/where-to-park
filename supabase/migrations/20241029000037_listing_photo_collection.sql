-- 🟧 A listing's photo collection = the operator's listing photos + photos attached to
-- its reviews. Derived (no copies): a review photo leaves the collection as soon as the
-- photo row or its review is deleted (or the review is hidden). security_invoker makes
-- the underlying tables' RLS apply to the caller (needs Postgres 15+).

CREATE OR REPLACE VIEW listing_photo_collection
WITH (security_invoker = true) AS
  SELECT
    lp.id,
    lp.location_id,
    'listing'::text AS source,
    'location-photos'::text AS bucket,
    lp.storage_path,
    NULL::uuid AS review_id,
    0 AS source_rank,
    CASE WHEN COALESCE(lp.is_cover, false) THEN 0 ELSE 1 END AS cover_rank,
    lp.sort_order,
    lp.created_at
  FROM location_photos lp
  UNION ALL
  SELECT
    rp.id,
    r.location_id,
    'review'::text AS source,
    'review-photos'::text AS bucket,
    rp.storage_path,
    rp.review_id,
    1 AS source_rank,
    1 AS cover_rank,
    rp.sort_order,
    rp.created_at
  FROM review_photos rp
  JOIN reviews r ON r.id = rp.review_id
  WHERE NOT COALESCE(r.hidden, false);

COMMENT ON VIEW listing_photo_collection IS
  'Listing photos + review photos (derived). Order: source_rank, cover_rank, sort_order, created_at.';

GRANT SELECT ON listing_photo_collection TO anon, authenticated;
