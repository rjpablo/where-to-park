/** Where a listing stands in admin review, for badges in My listings. */
export type ReviewState = 'verified' | 'rejected' | 'pending';

export type Reviewable = {
  verification_status: 'unverified' | 'verified';
  rejected_at?: string | null;
};

export function reviewState(loc: Reviewable): ReviewState {
  if (loc.verification_status === 'verified') return 'verified';
  return loc.rejected_at ? 'rejected' : 'pending';
}

export const REVIEW_LABELS: Record<ReviewState, string> = {
  verified: 'Verified',
  rejected: 'Rejected',
  pending: 'Unverified',
};

/** Trimmed reject reason, or null when blank. Max 500 chars. */
export function normalizeRejectReason(reason: string): string | null {
  const trimmed = reason.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 500) : null;
}
