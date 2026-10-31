import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRejectReason, REVIEW_LABELS, reviewState } from './listingReview.ts';

test('review state: verified wins, rejected only while unverified', () => {
  assert.equal(reviewState({ verification_status: 'verified' }), 'verified');
  assert.equal(
    reviewState({ verification_status: 'verified', rejected_at: '2026-10-30T00:00:00Z' }),
    'verified'
  );
  assert.equal(
    reviewState({ verification_status: 'unverified', rejected_at: '2026-10-30T00:00:00Z' }),
    'rejected'
  );
  assert.equal(reviewState({ verification_status: 'unverified', rejected_at: null }), 'pending');
  assert.equal(REVIEW_LABELS.rejected, 'Rejected');
});

test('reject reason is trimmed, collapsed and optional', () => {
  assert.equal(normalizeRejectReason('   '), null);
  assert.equal(normalizeRejectReason('  Pin is   off \n the lot '), 'Pin is off the lot');
  assert.equal(normalizeRejectReason('x'.repeat(600))?.length, 500);
});
