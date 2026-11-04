import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionImages, FROM_REVIEW_LABEL, sortCollection } from './photoCollection.ts';

const rows = [
  {
    id: 'r1',
    source: 'review',
    storage_path: 'rev/1.jpg',
    source_rank: 1,
    cover_rank: 1,
    sort_order: 0,
    created_at: '2026-10-31T01:00:00Z',
  },
  {
    id: 'o2',
    source: 'listing',
    storage_path: 'loc/2.jpg',
    source_rank: 0,
    cover_rank: 1,
    sort_order: 1,
  },
  {
    id: 'o1',
    source: 'listing',
    storage_path: 'loc/1.jpg',
    source_rank: 0,
    cover_rank: 0,
    sort_order: 5,
  },
  {
    id: 'r0',
    source: 'review',
    storage_path: 'rev/0.jpg',
    source_rank: 1,
    cover_rank: 1,
    sort_order: 0,
    created_at: '2026-10-30T01:00:00Z',
  },
];
const url = (source: string, path: string) => `https://x/${source}/${path}`;

test('operator photos first (cover first), then review photos oldest first', () => {
  assert.deepEqual(
    sortCollection(rows).map((r) => r.id),
    ['o1', 'o2', 'r0', 'r1']
  );
});

test('review photos are marked; URLs per source; rows without a URL dropped', () => {
  const imgs = collectionImages(rows, url);
  assert.deepEqual(
    imgs.map((i) => [i.key, i.label ?? null, i.fromReview]),
    [
      ['op-o1', null, false],
      ['op-o2', null, false],
      ['rv-r0', FROM_REVIEW_LABEL, true],
      ['rv-r1', FROM_REVIEW_LABEL, true],
    ]
  );
  assert.equal(imgs[2].uri, 'https://x/review/rev/0.jpg');
  assert.equal(collectionImages(rows, (s) => (s === 'review' ? null : 'u')).length, 2);
  assert.deepEqual(collectionImages(null, url), []);
});
