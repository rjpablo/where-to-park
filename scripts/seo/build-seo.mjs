// After `expo export -p web`: writes dist/sitemap.xml and adds the Search Console
// meta tag to dist/*.html. Run with Node's TypeScript stripping:
//   node --experimental-strip-types scripts/seo/build-seo.mjs
// Env: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (the database the
// website uses; public read of published listings), SEO_CACHE (listing-area cache,
// default /tmp/where-to-park-seo-areas.json), SEO_OFFLINE=1 to skip the network.
// Failures never stop a deploy: popular places always go in, and listing areas
// fall back to the last good list.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSitemapXml,
  distanceKm,
  normalLabel,
  groupListingAreas,
  injectHeadTag,
  isoDate,
  mergeAreas,
  parseEwkbPoint,
  siteVerificationMeta,
  sitemapEntries,
} from '../../src/lib/sitemap.ts';
import { searchCanonicalUrl } from '../../src/lib/searchLink.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = process.env.SEO_DIST || join(root, 'dist');
const config = JSON.parse(readFileSync(join(root, 'web-host.json'), 'utf8'));
const origin = `https://${config.hosts[0]}`;
const today = new Date().toISOString().slice(0, 10);
const cachePath = process.env.SEO_CACHE || '/tmp/where-to-park-seo-areas.json';
const UA = { 'User-Agent': 'where-to-park-sitemap/1.0 (+https://where-to-park.expo.app)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const popularFile = JSON.parse(readFileSync(join(root, 'seo/popular-places.json'), 'utf8'));
const popular = popularFile.places.map((p) => ({
  label: p.label,
  lat: p.lat,
  lng: p.lng,
  lastmod: popularFile.reviewed,
  source: 'popular',
}));

async function json(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
  return res.json();
}

/** City or municipality of a point (Photon reverse; Photon is what the app uses). */
async function cityOf(pt) {
  const r = await json(`https://photon.komoot.io/reverse?lat=${pt.lat}&lon=${pt.lng}`);
  const p = r.features?.[0]?.properties ?? {};
  if (p.countrycode && p.countrycode !== 'PH') return null;
  return p.city || p.county || null;
}

/** The town or city centre near the listings, else null (the listings' centre is used). */
async function townCentre(label, near) {
  const q = new URLSearchParams({ q: label, limit: '5', lat: String(near.lat), lon: String(near.lng) });
  const tags = ['place:city', 'place:town', 'place:municipality'].map((t) => `&osm_tag=${t}`).join('');
  const r = await json(`https://photon.komoot.io/api/?${q}${tags}`);
  for (const f of r.features ?? []) {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (f.properties?.countrycode !== 'PH' || typeof lat !== 'number') continue;
    if (distanceKm({ lat, lng }, near) <= 25) return { lat, lng };
  }
  return null;
}

/** The search page's default distance (km) for a link without `r`. */
const SEARCH_KM = 3;

async function listingAreas() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase URL / anon key not set');
  const rows = await json(
    `${url}/rest/v1/locations?select=geog,updated_at&published=eq.true&deleted_at=is.null&limit=5000`,
    { apikey: key, Authorization: `Bearer ${key}` }
  );
  const points = [];
  for (const row of rows) {
    const pt = parseEwkbPoint(row.geog);
    if (!pt) continue;
    await sleep(300);
    points.push({ ...pt, city: await cityOf(pt), updatedAt: row.updated_at });
  }
  const areas = groupListingAreas(points, today);
  for (const area of areas) {
    await sleep(300);
    const centre = await townCentre(area.label, area).catch(() => null);
    // Use the town centre only when the page opened there (3 km default search
    // distance) still shows every listing of the area; otherwise keep their centre.
    const mine = points.filter((p) => normalLabel(p.city ?? '') === normalLabel(area.label));
    if (centre && mine.every((p) => distanceKm(centre, p) <= SEARCH_KM)) Object.assign(area, centre);
  }
  return areas;
}

let fromListings = [];
let note = '';
if (process.env.SEO_OFFLINE === '1') {
  note = 'offline: popular places only';
} else {
  try {
    fromListings = await listingAreas();
    writeFileSync(cachePath, JSON.stringify(fromListings, null, 1));
    note = `${fromListings.length} listing areas from the database`;
  } catch (e) {
    if (existsSync(cachePath)) {
      fromListings = JSON.parse(readFileSync(cachePath, 'utf8'));
      note = `listing query failed (${e.message}); used the last good list (${fromListings.length})`;
    } else {
      note = `listing query failed (${e.message}); popular places only`;
    }
  }
}

const areas = mergeAreas(popular, fromListings);
const entries = sitemapEntries(
  origin,
  areas,
  (a) => searchCanonicalUrl(origin, a),
  isoDate(today, today)
);
writeFileSync(join(dist, 'sitemap.xml'), buildSitemapXml(entries));

const tag = siteVerificationMeta(config.googleSiteVerification);
let tagged = 0;
if (tag) {
  for (const f of readdirSync(dist).filter((n) => n.endsWith('.html'))) {
    const p = join(dist, f);
    const html = readFileSync(p, 'utf8');
    const next = injectHeadTag(html, tag);
    if (next !== html) {
      writeFileSync(p, next);
      tagged += 1;
    }
  }
}
console.log(
  `sitemap.xml: ${entries.length} URLs (home, ${popular.length} popular, ` +
    `${areas.length - popular.length} more listing area(s); ${note}); ` +
    `search console tag: ${tag ? `${tagged} file(s)` : 'not set'}`
);
for (const a of areas) console.log(`  ${a.source.padEnd(8)} ${a.label} ${a.lat.toFixed(5)},${a.lng.toFixed(5)}`);
