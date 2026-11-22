import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSitemapXml,
  distanceKm,
  groupListingAreas,
  injectHeadTag,
  mergeAreas,
  normalLabel,
  parseEwkbPoint,
  siteVerificationMeta,
  sitemapEntries,
  xmlEscape,
  type SitemapArea,
} from './sitemap.ts';
import { parseSearchLink, parseSearchLinkFilters, searchCanonicalUrl } from './searchLink.ts';

const ORIGIN = 'https://where-to-park.expo.app';
const TODAY = '2026-11-22';
const canonical = (a: { lat: number; lng: number; place: string }) => searchCanonicalUrl(ORIGIN, a);

const area = (
  label: string,
  lat: number,
  lng: number,
  source: SitemapArea['source'] = 'popular'
) => ({
  label,
  lat,
  lng,
  lastmod: '2026-11-01',
  source,
});

test('reads the point from PostGIS EWKB hex (SRID 4326)', () => {
  // A staging Baguio listing as the REST API returns it.
  const pt = parseEwkbPoint('0101000020E6100000D9CEF753E3255E400B24287E8C693040');
  assert.ok(pt);
  assert.ok(Math.abs(pt.lng - 120.592) < 0.001 && Math.abs(pt.lat - 16.4123) < 0.001);
  assert.equal(parseEwkbPoint('zz'), null);
  assert.equal(parseEwkbPoint(null), null);
  assert.equal(parseEwkbPoint('0102000020E6100000'), null);
});

test('groups listings by city, centred on them, dated by the newest update', () => {
  const areas = groupListingAreas(
    [
      { lat: 16.41, lng: 120.59, city: 'Baguio', updatedAt: '2026-11-01T10:00:00Z' },
      { lat: 16.43, lng: 120.61, city: 'Baguio', updatedAt: '2026-11-19T03:03:46Z' },
      { lat: 16.04, lng: 120.6, city: 'Binalonan', updatedAt: null },
      { lat: 1, lng: 1, city: null, updatedAt: null },
      { lat: 1, lng: 1, city: '  ', updatedAt: null },
    ],
    TODAY
  );
  assert.deepEqual(
    areas.map((a) => [a.label, +a.lat.toFixed(2), +a.lng.toFixed(2), a.lastmod]),
    [
      ['Baguio', 16.42, 120.6, '2026-11-19'],
      ['Binalonan', 16.04, 120.6, TODAY],
    ]
  );
});

test('keeps every popular place and drops listing areas they already cover', () => {
  const merged = mergeAreas(
    [
      area('NAIA Terminal 2', 14.51005, 121.01277),
      area('NAIA Terminal 3', 14.51923, 121.01375), // about 1 km away: kept
      area('Baguio', 16.4125, 120.5975),
      area('Baguio', 16.5, 120.6), // repeated name
    ],
    [
      { ...area('Baguio City', 16.42, 120.6, 'listings'), lastmod: '2026-11-19' }, // same city
      area('Some barangay', 14.512, 121.013, 'listings'), // within 2 km of a terminal
      area('Binalonan', 16.0445, 120.5918, 'listings'),
    ]
  );
  assert.deepEqual(
    merged.map((a) => a.label),
    ['NAIA Terminal 2', 'NAIA Terminal 3', 'Baguio', 'Binalonan']
  );
  const baguio = merged.find((a) => a.label === 'Baguio');
  assert.equal(baguio?.lat, 16.4125);
  assert.equal(baguio?.lastmod, '2026-11-19');
});

test('escapes XML, and & in URLs becomes &amp;', () => {
  assert.equal(xmlEscape(`a&b<c>"d"'e`), 'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e');
  const xml = buildSitemapXml(
    sitemapEntries(
      ORIGIN,
      [area('Rizal Park (Luneta), Manila', 14.58298, 120.97927)],
      canonical,
      TODAY
    )
  );
  assert.match(
    xml,
    /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/
  );
  assert.ok(xml.includes(`<loc>${ORIGIN}/</loc>`));
  assert.ok(
    xml.includes(
      '<loc>https://where-to-park.expo.app/search?lat=14.58298&amp;lng=120.97927&amp;place=Rizal%20Park%20(Luneta)%2C%20Manila</loc>'
    )
  );
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml));
  assert.equal((xml.match(/<url>/g) ?? []).length, 2);
});

test('a sitemap URL is exactly the canonical the page sets when it opens', () => {
  const [, entry] = sitemapEntries(
    ORIGIN,
    [area('Makati CBD', 14.551, 121.02881)],
    canonical,
    TODAY
  );
  const q = Object.fromEntries(new URL(entry.loc).searchParams);
  assert.deepEqual(Object.keys(q), ['lat', 'lng', 'place']);
  assert.deepEqual(parseSearchLinkFilters(q), {});
  const link = parseSearchLink(q);
  assert.ok(link);
  // The page's canonical is built from the parsed link, as SearchScreen does.
  assert.equal(searchCanonicalUrl(ORIGIN, link), entry.loc);
});

test('the curated popular places are valid, in the Philippines, and distinct', () => {
  const file = JSON.parse(
    readFileSync(new URL('../../seo/popular-places.json', import.meta.url), 'utf8')
  );
  assert.match(file.reviewed, /^\d{4}-\d{2}-\d{2}$/);
  const places = file.places as { label: string; lat: number; lng: number; verified: string }[];
  assert.ok(places.length >= 30 && places.length <= 60, `${places.length} places`);
  const labels = new Set<string>();
  for (const p of places) {
    assert.ok(p.label.trim() && !labels.has(p.label), p.label);
    labels.add(p.label);
    // Philippine bounding box.
    assert.ok(p.lat > 4.5 && p.lat < 21.2 && p.lng > 116.9 && p.lng < 127, p.label);
    assert.equal(+p.lat.toFixed(5), p.lat, p.label);
    assert.ok(p.verified, `${p.label} has its geocoder check`);
  }
  // No two places on the same spot.
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      assert.ok(distanceKm(places[i], places[j]) > 0.3, `${places[i].label} / ${places[j].label}`);
    }
  }
});

test('the Search Console tag is built only from a real code and added once', () => {
  assert.equal(siteVerificationMeta(''), '');
  assert.equal(siteVerificationMeta(undefined), '');
  const tag = siteVerificationMeta(' abcDEF123_-xyz456 ');
  assert.equal(tag, '<meta name="google-site-verification" content="abcDEF123_-xyz456" />');
  assert.throws(() => siteVerificationMeta('<meta name="google-site-verification" content="x">'));
  const html = '<html><head>\n<title>x</title></head></html>';
  const once = injectHeadTag(html, tag);
  assert.equal(once, `<html><head>\n    ${tag}\n<title>x</title></head></html>`);
  assert.equal(injectHeadTag(once, tag), once);
  assert.equal(injectHeadTag(html, ''), html);
});

test('robots.txt points to the sitemap and keeps private screens out', () => {
  const robots = readFileSync(new URL('../../public/robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/where-to-park\.expo\.app\/sitemap\.xml$/m);
  for (const path of [
    '/operator',
    '/admin',
    '/staff',
    '/chat',
    '/sessions',
    '/profile',
    '/oauth-callback',
  ]) {
    assert.match(robots, new RegExp(`^Disallow: ${path}$`, 'm'));
  }
  for (const path of ['/search', '/location', '/privacy']) {
    assert.doesNotMatch(robots, new RegExp(`^Disallow: ${path}`, 'm'));
  }
});

test('the served HTML has the large share image tags', () => {
  const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  for (const tag of [
    'property="og:image" content="https://where-to-park.expo.app/og-image.png"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'property="og:image:type" content="image/png"',
    'name="twitter:card" content="summary_large_image"',
    'name="twitter:image" content="https://where-to-park.expo.app/og-image.png"',
  ]) {
    assert.ok(html.includes(tag), tag);
  }
  const png = readFileSync(new URL('../../public/og-image.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 300 * 1024);
});

test('place names match without "City", accents or punctuation', () => {
  assert.equal(normalLabel('Baguio City'), normalLabel('baguio'));
  assert.equal(normalLabel('City of Parañaque'), normalLabel('Paranaque'));
  assert.notEqual(normalLabel('Pasay'), normalLabel('Pasig'));
});
