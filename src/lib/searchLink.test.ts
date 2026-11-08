import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSearchCoord,
  forwardSearchParams,
  parseSearchLink,
  sameSearchCenter,
  searchDocumentDescription,
  searchDocumentTitle,
  searchLinkParams,
} from './searchLink.ts';

test('parses coordinates and a place name', () => {
  assert.deepEqual(
    parseSearchLink({ lat: '16.411234', lng: '120.593456', place: ' Burnham Park ' }),
    {
      lat: 16.411234,
      lng: 120.593456,
      place: 'Burnham Park',
    }
  );
  assert.deepEqual(parseSearchLink({ lat: ['16.4', '1'], lng: ['120.6'], place: ['', 'x'] }), {
    lat: 16.4,
    lng: 120.6,
    place: null,
  });
});

test('rejects missing and invalid coordinates', () => {
  assert.equal(parseSearchLink({}), null);
  assert.equal(parseSearchLink({ lat: '16', place: 'Baguio' }), null);
  assert.equal(parseSearchLink({ lat: 'nope', lng: '120' }), null);
  assert.equal(parseSearchLink({ lat: '91', lng: '120' }), null);
  assert.equal(parseSearchLink({ lat: '16', lng: '181' }), null);
  assert.equal(forwardSearchParams({ place: 'Baguio' }), null);
});

test('formats a shareable search link', () => {
  assert.deepEqual(searchLinkParams({ lat: 16.411234, lng: 120.593456, place: 'Burnham Park' }), {
    lat: '16.41123',
    lng: '120.59346',
    place: 'Burnham Park',
  });
  assert.deepEqual(searchLinkParams({ lat: 16.4, lng: 120.5, place: '  ' }), {
    lat: '16.40000',
    lng: '120.50000',
  });
  assert.deepEqual(forwardSearchParams({ lat: '16.4', lng: '120.6', place: 'Baguio' }), {
    lat: '16.40000',
    lng: '120.60000',
    place: 'Baguio',
  });
});

test('treats coordinates within the URL precision as the same centre', () => {
  assert.equal(formatSearchCoord(16.411234), '16.41123');
  assert.equal(
    sameSearchCenter({ lat: 16.411234, lng: 120.593454 }, { lat: 16.41123, lng: 120.59345 }),
    true
  );
  assert.equal(sameSearchCenter({ lat: 16.41, lng: 120.59 }, { lat: 16.42, lng: 120.59 }), false);
});

test('builds the document title and description', () => {
  assert.equal(searchDocumentTitle(null), 'Find Parking - Where To Park');
  assert.equal(searchDocumentTitle('  '), 'Find Parking - Where To Park');
  assert.equal(searchDocumentTitle('Burnham Park'), 'Where to park in Burnham Park');
  assert.equal(
    searchDocumentDescription(null),
    'Find parking near you. See open spots, rates, and distance.'
  );
  assert.equal(
    searchDocumentDescription('Burnham Park'),
    'Find parking near Burnham Park. See open spots, rates, and distance.'
  );
});
