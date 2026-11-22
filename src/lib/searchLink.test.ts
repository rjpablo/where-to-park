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
  buildSearchShareUrl,
  parseSearchLinkFilters,
  searchLinkFiltersKey,
  searchCanonicalUrl,
  searchSeo,
  LINK_VEHICLE_TYPES,
  LINK_RATE_TYPES,
  LINK_SORTS,
} from './searchLink.ts';
import { VEHICLE_TYPES, SORT_OPTIONS } from './searchFilters.ts';
import { RATE_TYPES } from './rates.ts';
import { MIN_DISTANCE_KM, MAX_DISTANCE_KM } from './distance.ts';

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

const ORIGIN = 'https://where-to-park.expo.app';

const makati = {
  lat: 14.554729,
  lng: 121.024445,
  place: 'Makati City',
  distanceKm: 2.5,
  vehicleType: 'suv',
  rateType: 'hourly',
  freeOnly: true,
  showFull: false,
  sortBy: 'price',
};

test('builds the document title and description from the place', () => {
  assert.equal(searchDocumentTitle(null), 'Find Parking Near You | Where To Park');
  assert.equal(searchDocumentTitle('  '), 'Find Parking Near You | Where To Park');
  assert.equal(searchDocumentTitle('Makati City'), 'Parking near Makati City | Where To Park');
  assert.match(searchDocumentDescription(null), /^Find parking near you\./);
  assert.equal(
    searchDocumentDescription('Makati City'),
    'Find parking near Makati City. Compare open spots, hourly and daily rates, free parking, and distance on a live map.'
  );
  for (const place of [null, 'Makati City', 'A'.repeat(90)]) {
    assert.ok(searchDocumentDescription(place).length <= 160, `description for ${place}`);
  }
  assert.match(searchDocumentDescription('A'.repeat(90)), /^Find parking near A+\. See open spots/);
});

test('builds canonical, Open Graph image and title for a search', () => {
  const seo = searchSeo(ORIGIN, { lat: 14.554729, lng: 121.024445, place: 'Makati City' });
  assert.equal(seo.title, 'Parking near Makati City | Where To Park');
  assert.equal(
    seo.canonical,
    'https://where-to-park.expo.app/search?lat=14.55473&lng=121.02445&place=Makati%20City'
  );
  assert.equal(seo.image, 'https://where-to-park.expo.app/og-image.png');
  assert.equal(seo.imageWidth, 1200);
  assert.equal(seo.imageHeight, 630);
  assert.equal(
    seo.imageAlt,
    'Where To Park: Find parking near you. Get the app on Google Play (QR code to the app listing).'
  );
  assert.equal(searchCanonicalUrl(`${ORIGIN}/`, null), `${ORIGIN}/search`);
  assert.equal(searchSeo(ORIGIN, null).title, 'Find Parking Near You | Where To Park');
});

test('a share link carries the centre, name, radius, filters and sort', () => {
  const url = buildSearchShareUrl(ORIGIN, makati);
  assert.equal(
    url,
    'https://where-to-park.expo.app/search?lat=14.55473&lng=121.02445&place=Makati%20City&r=2.5&v=suv&rate=hourly&free=1&full=0&sort=price'
  );
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/search');
  const q = Object.fromEntries(parsed.searchParams);
  assert.deepEqual(parseSearchLink(q), { lat: 14.55473, lng: 121.02445, place: 'Makati City' });
  assert.deepEqual(parseSearchLinkFilters(q), {
    distanceKm: 2.5,
    vehicleType: 'suv',
    rateType: 'hourly',
    freeOnly: true,
    showFull: false,
    sortBy: 'price',
  });
});

test('a share link round-trips "All" filters and encodes names', () => {
  const url = buildSearchShareUrl(ORIGIN, {
    ...makati,
    place: 'Café & Bar #1 / 5th Ave?',
    vehicleType: null,
    rateType: null,
    freeOnly: false,
    showFull: true,
    sortBy: 'distance',
  });
  assert.doesNotMatch(url.split('?')[1], /[ #&?/]Bar|#1|5th Ave\?/);
  const q = Object.fromEntries(new URL(url).searchParams);
  assert.equal(parseSearchLink(q)?.place, 'Café & Bar #1 / 5th Ave?');
  const f = parseSearchLinkFilters(q);
  assert.equal(f.vehicleType, null);
  assert.equal(f.rateType, null);
  assert.equal(f.freeOnly, false);
  assert.equal(f.showFull, true);
  assert.equal(f.sortBy, 'distance');
});

test('a share link without a name omits place', () => {
  const url = buildSearchShareUrl(`${ORIGIN}/`, { ...makati, place: '  ' });
  assert.ok(url.startsWith(`${ORIGIN}/search?lat=`));
  assert.ok(!url.includes('place='));
});

test('invalid filter params are dropped, not guessed', () => {
  assert.deepEqual(
    parseSearchLinkFilters({
      r: 'abc',
      v: 'spaceship',
      rate: 'yearly',
      free: 'maybe',
      full: '',
      sort: 'cheapest',
    }),
    {}
  );
  assert.deepEqual(parseSearchLinkFilters({}), {});
  assert.deepEqual(parseSearchLinkFilters({ r: '-3' }), {});
  assert.deepEqual(parseSearchLinkFilters({ r: '0' }), {});
  assert.equal(parseSearchLinkFilters({ r: '9999' }).distanceKm, MAX_DISTANCE_KM);
  assert.equal(parseSearchLinkFilters({ r: '0.01' }).distanceKm, MIN_DISTANCE_KM);
  assert.equal(parseSearchLinkFilters({ free: 'true', full: 'false' }).freeOnly, true);
  assert.equal(parseSearchLinkFilters({ v: ['car', 'van'] }).vehicleType, 'car');
});

test('a link with bad coordinates is not a search, whatever its filters', () => {
  assert.equal(parseSearchLink({ lat: '91', lng: '121', place: 'X' }), null);
  assert.equal(forwardSearchParams({ lat: 'x', lng: '1', v: 'car' }), null);
});

test('the home route forwards the filter params too', () => {
  assert.deepEqual(
    forwardSearchParams({
      lat: '14.5',
      lng: '121',
      place: 'Makati',
      r: '3',
      v: 'car',
      junk: 'x',
    } as never),
    { lat: '14.50000', lng: '121.00000', place: 'Makati', r: '3', v: 'car' }
  );
});

test('filter keys tell links apart', () => {
  assert.equal(searchLinkFiltersKey({}), searchLinkFiltersKey({}));
  assert.notEqual(searchLinkFiltersKey({ vehicleType: null }), searchLinkFiltersKey({}));
  assert.notEqual(
    searchLinkFiltersKey({ vehicleType: 'car' }),
    searchLinkFiltersKey({ vehicleType: 'van' })
  );
});

test('link value lists match the app lists', () => {
  assert.deepEqual([...LINK_VEHICLE_TYPES], [...VEHICLE_TYPES]);
  assert.deepEqual([...LINK_RATE_TYPES], [...RATE_TYPES]);
  assert.deepEqual([...LINK_SORTS].sort(), [...SORT_OPTIONS].sort());
});

test('the served HTML defaults use the public host from web-host.json', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  const { hosts } = JSON.parse(
    readFileSync(new URL('../../web-host.json', import.meta.url), 'utf8')
  ) as { hosts: string[] };
  const images = [...html.matchAll(/content="(https:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).host);
  assert.ok(images.length >= 2);
  for (const host of images) assert.equal(host, hosts[0]);
  assert.match(html, /<meta data-rh="true" name="description" content="[^"]{50,160}"/);
});
