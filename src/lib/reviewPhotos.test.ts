import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  photosLeft,
  REVIEW_PHOTO_MAX,
  reviewPhotoError,
  reviewPhotoFilename,
  sortReviewPhotos,
} from './reviewPhotos.ts';

test('default cap is 5 photos per review', () => {
  assert.equal(REVIEW_PHOTO_MAX, 5);
  assert.equal(photosLeft(0, 0), 5);
  assert.equal(photosLeft(2, 2), 1);
  assert.equal(photosLeft(4, 3), 0);
  assert.equal(photosLeft(1, 0, 3), 2);
});

test('photos keep upload order', () => {
  const rows = [
    { id: 'b', storage_path: 'r/2.jpg', sort_order: 1 },
    { id: 'a', storage_path: 'r/1.jpg', sort_order: 0 },
    { id: 'c', storage_path: 'r/0.jpg', sort_order: 1 },
  ];
  assert.deepEqual(
    sortReviewPhotos(rows).map((r) => r.id),
    ['a', 'c', 'b']
  );
  assert.deepEqual(sortReviewPhotos(null), []);
});

test('file names are unique and storage-safe', () => {
  assert.equal(reviewPhotoFilename(2, 1700000000000, 'ab/c$d'), '1700000000000-2-abcd.jpg');
  assert.equal(reviewPhotoFilename(0, 1, '///'), '1-0-x.jpg');
});

test('error notices', () => {
  assert.equal(reviewPhotoError('too_many_photos'), 'A review can have up to 5 photos');
  assert.match(reviewPhotoError('Permission denied'), /own review/);
  assert.match(reviewPhotoError(undefined), /Could not upload/);
});
