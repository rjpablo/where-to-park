# 🟧 Shared search links, App Links and search SEO

Added for rj t212u. Code: `src/lib/searchLink.ts` (build and parse, SEO text),
`src/utils/shareLink.ts` (share sheet / clipboard), `src/screens/SearchScreen.tsx`
(Share button, applying a link, `<Head>` tags), `public/index.html` (served defaults).
App Links themselves were set up by rj in `aa27c85` / `3b732db` (see eas-build.md,
"Replacing the web address").

## Link format

```
https://where-to-park.expo.app/search?lat=14.55473&lng=121.02445&place=Makati%20City&r=2.5&v=car&rate=hourly&free=1&full=0&sort=price
```

| Param | Meaning | Values | Bad or missing |
|---|---|---|---|
| `lat`, `lng` | Search centre, 5 decimals (~1 m) | -90..90, -180..180 | No search from the link: Find Parking as usual |
| `place` | Name shown in the search box and the page title | text, URL-encoded | Looked up from the coordinates |
| `r` | Distance slider, km | > 0, clamped to 0.5–50, then to the visible-map max and the admin search limit | Visible-map max, as for any new search |
| `v` | Vehicle | `car` `suv` `van` `motorcycle` `truck`, or `all` | Screen's own (account default) |
| `rate` | Rate type | `hourly` `daily` `flat_then_hourly` `monthly`, or `all` | Screen's own |
| `free` | Free parking only | `1` / `0` (`true` / `false`) | Screen's own |
| `full` | Show Full | `1` / `0` | Screen's own |
| `sort` | Sort | `distance` `price` `rating` `eta` `availability` | Screen's own |

Why query params on `/search` and not a path slug (`/parking/makati-city`):
`/search?lat&lng&place` was already the route's own address (the web address bar,
`app/index.tsx` forwarding, and rj's App Links path list all use it), so old links
keep working and nothing new has to be routed or claimed. A slug would need a
place-name lookup to get coordinates back, which is ambiguous ("San Jose") and
slower; the coordinates in the link make the search exact.

The share always writes every filter, including `all` and `0`, so the receiver
gets exactly the sender's search rather than their own defaults. The link's
vehicle beats the receiver's default vehicle. The link's distance holds until the
receiver taps Search this area. On the web, the address bar is kept in step with
the screen (centre, place, distance, filters, sort), so the address bar is the
same link Share sends, and a reload keeps the search. (`router.setParams` with
`undefined` does not remove a param in expo-router 6, so the params are kept
current instead of removed.)

`wheretopark://search?lat=…&lng=…` (the app scheme) is handled by the same
route, as is `/?lat=…&lng=…` (the home route forwards every param to `/search`).

## Opening on Android (App Links)

Already in place before this feature (rj, `aa27c85`, `3b732db`):

- `app.config.js` writes `android.intentFilters` with `autoVerify: true` for
  every host in `web-host.json` and the paths in `src/lib/webLinks.js`
  (`/`, `/search`, `/location`, …; not `/oauth-callback`).
- `public/.well-known/assetlinks.json` is deployed with the site and served as
  `Content-Type: application/json` (checked with curl on Nov 22, 2026). `src/lib/appLinks.test.ts`
  checks it matches `src/lib/appLinks.ts`.

The file lists two certificates (both public fingerprints, not secrets):

| Certificate | SHA-256 | Verifies |
|---|---|---|
| EAS keystore (upload key) | `49:3E:FE:0F:CD:7C:72:3A:F4:D8:B9:B2:00:DC:48:1B:E0:CB:87:3A:63:85:EE:28:C4:77:E8:EC:42:45:B2:25` | APKs built and installed straight from EAS (preview / internal). Matches the 1.0.17 AAB's signature. |
| Google Play App Signing key (Classical) | `66:71:4A:EB:D0:C4:59:5F:F8:05:80:E2:0D:A8:20:37:50:BC:AD:19:56:7C:33:B6:4E:C9:75:33:C1:62:16:A7` | Apps installed from Google Play (Play re-signs with this key). From Play Console > Setup > App signing, "App signing key certificate". |

🟧 The Play key was added on Nov 22, 2026 (rj t220u). The post-quantum key on that page is not used for App Links. If either key ever changes, update `ANDROID_SHA256_CERT_FINGERPRINTS` in `src/lib/appLinks.ts` and `public/.well-known/assetlinks.json` together (the test checks they match), then redeploy the website; no app build is needed for that.

A phone opens https links in the app only with a build made after `aa27c85`
(the intent filters are native config), i.e. **the next Android build**.
1.0.18 (`1b73405`) was cut before `aa27c85`, so it does not claim the links. Android checks
the file at install time; to recheck on a test phone:
`adb shell pm verify-app-links --re-verify com.thebadcompany.wheretopark` then
`adb shell pm get-app-links com.thebadcompany.wheretopark` (expect `verified`).
Google's checker:
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://where-to-park.expo.app&relation=delegate_permission/common.handle_all_urls`.

## Search page SEO

`app.json` has no `web.output`, so the site is a single-page app
(`web.output: "single"`): EAS Hosting serves the same `index.html` for every
path, and the per-search tags are set in the browser by `expo-router/head`:

- `<title>Parking near Makati City | Where To Park</title>` (no place:
  `Find Parking Near You | Where To Park`)
- `<meta name="description">` of at most 160 characters naming the place
- `<link rel="canonical">` = `/search?lat&lng&place` (no filters)
- `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`
  (`/icon-512.png`), `twitter:card` (summary), `twitter:title`,
  `twitter:description`, `twitter:image`

`public/index.html` carries site-wide defaults of the same tags in the served
HTML, marked `data-rh="true"` so the page's own tags replace them (no
duplicates). Google renders JavaScript and sees the place tags. Link previews
(WhatsApp, Messenger, Facebook, X, Slack) do not run JavaScript, so a shared
link previews with the site-wide title and description, not the place.

Options for place names in the served HTML, not done (ask first):

1. `web.output: "server"` plus an Expo Router server middleware or API route on
   EAS Hosting that rewrites the `<title>`/meta of `index.html` for `/search`
   from the query. Needs the whole app to export in server mode and a check that
   every screen is safe there (MapLibre, `window` use).
2. `web.output: "static"` gives each route its own HTML, but still not per-query
   tags, so it does not help `/search?place=…` by itself.
3. A small edge function / proxy in front of the site that injects the tags for
   link-preview bots only.

If the host changes (`web-host.json`), also update the `og:image` URLs in
`public/index.html`; `src/lib/searchLink.test.ts` fails until they match.
