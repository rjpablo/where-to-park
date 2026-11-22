/**
 * Pure helpers for public/sitemap.xml (built after the web export by
 * scripts/seo/build-seo.mjs). Self-contained for the Node unit tests: the page
 * address comes in as a function, so the sitemap uses the page's own canonical
 * builder (searchLink.ts searchCanonicalUrl) and the two always match.
 */

export type LatLng = { lat: number; lng: number };

/** An area with one search URL in the sitemap. */
export type SitemapArea = LatLng & {
  /** Place label, shown in the page title: 'Parking near <label> | Where To Park'. */
  label: string;
  /** YYYY-MM-DD */
  lastmod: string;
  source: 'popular' | 'listings';
};

export type ListingPoint = LatLng & {
  /** City or municipality from the reverse geocoder, null when unknown. */
  city: string | null;
  updatedAt: string | null;
};

/** Point from PostGIS EWKB hex, as the REST API returns a geography column. */
export function parseEwkbPoint(hex: unknown): LatLng | null {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  if (bytes.length < 21) return null;
  const view = new DataView(bytes.buffer);
  const little = bytes[0] === 1;
  const type = view.getUint32(1, little);
  if ((type & 0xff) !== 1) return null; // Point
  let offset = 5;
  if (type & 0x20000000) offset += 4; // SRID
  if (bytes.length < offset + 16) return null;
  const lng = view.getFloat64(offset, little);
  const lat = view.getFloat64(offset + 8, little);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

export function isoDate(value: string | Date | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString().slice(0, 10);
}

function normalLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(city of|city|municipality of)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * One area per city or municipality that has listings: the listings' centre
 * and the newest listing update. Listings with no city are left out.
 */
export function groupListingAreas(points: ListingPoint[], today: string): SitemapArea[] {
  const groups = new Map<string, { label: string; pts: ListingPoint[] }>();
  for (const p of points) {
    const label = p.city?.trim();
    if (!label) continue;
    const key = normalLabel(label);
    if (!key) continue;
    const g = groups.get(key) ?? { label, pts: [] };
    g.pts.push(p);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ label, pts }) => ({
      label,
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
      lastmod:
        pts
          .map((p) => isoDate(p.updatedAt, today))
          .sort()
          .at(-1) ?? today,
      source: 'listings' as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Every curated popular place (only an exact repeat of a name is dropped), then
 * the listing areas not already covered: same name, or a centre within `minKm`
 * of a popular place or an earlier listing area.
 */
export function mergeAreas(
  popular: SitemapArea[],
  listings: SitemapArea[],
  minKm = 2
): SitemapArea[] {
  const out: SitemapArea[] = [];
  for (const area of popular) {
    if (out.some((a) => normalLabel(a.label) === normalLabel(area.label))) continue;
    out.push({ ...area });
  }
  for (const area of listings) {
    const dup = out.find(
      (a) => normalLabel(a.label) === normalLabel(area.label) || distanceKm(a, area) < minKm
    );
    if (dup) {
      // The covering place keeps its coordinates and takes the newer date.
      if (area.lastmod > dup.lastmod) dup.lastmod = area.lastmod;
      continue;
    }
    out.push({ ...area });
  }
  return out;
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type SitemapEntry = { loc: string; lastmod: string };

export function sitemapEntries(
  origin: string,
  areas: SitemapArea[],
  canonical: (area: LatLng & { place: string }) => string,
  homeLastmod: string
): SitemapEntry[] {
  const base = origin.replace(/\/+$/, '');
  const seen = new Set<string>();
  const out: SitemapEntry[] = [{ loc: `${base}/`, lastmod: homeLastmod }];
  seen.add(out[0].loc);
  for (const area of areas) {
    const loc = canonical({ lat: area.lat, lng: area.lng, place: area.label });
    if (seen.has(loc)) continue;
    seen.add(loc);
    out.push({ loc, lastmod: area.lastmod });
  }
  return out;
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${xmlEscape(e.loc)}</loc>\n    <lastmod>${xmlEscape(e.lastmod)}</lastmod>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The Search Console meta tag, or '' when no code is set. Only token characters are allowed. */
export function siteVerificationMeta(code: unknown): string {
  if (typeof code !== 'string') return '';
  const value = code.trim();
  if (!value) return '';
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(value)) {
    throw new Error(
      'googleSiteVerification must be the content value of the Search Console meta tag'
    );
  }
  return `<meta name="google-site-verification" content="${value}" />`;
}

/** Adds the meta tag right after <head> (once). */
export function injectHeadTag(html: string, tag: string): string {
  if (!tag || html.includes(tag)) return html;
  return html.replace(/<head([^>]*)>/i, (m) => `${m}\n    ${tag}`);
}
