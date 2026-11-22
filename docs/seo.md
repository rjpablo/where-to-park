# 🟧 Search engines and link previews (web)

How Google finds the public search pages on `https://where-to-park.expo.app`, and how shared links preview on Facebook, Messenger, X and chat apps. rj t222u–t225u. The search page tags themselves are in [deep-links.md](deep-links.md#search-page-seo).

The site is a single-page app (no `web.output: "server"`). The served HTML is the same for every URL, so crawlers that do not run JavaScript see only the site-wide defaults in `public/index.html`. Google runs the JavaScript and sees each search page's own title, description and canonical.

## What is served

| URL | Source | Content type |
|---|---|---|
| `/robots.txt` | `public/robots.txt` (copied by `expo export`) | `text/plain` |
| `/sitemap.xml` | Written into `dist/` at deploy time by `scripts/seo/build-seo.mjs` | `application/xml` |
| `/og-image.png` | `public/og-image.png`, 1200×630 PNG | `image/png` |

### robots.txt

Allows everything, then keeps signed-in and private screens out: `/operator`, `/staff`, `/admin`, `/notifications`, `/sessions`, `/chat`, `/reserve`, `/profile`, `/accounts`, `/vehicles`, `/shortcuts`, `/auth`, `/oauth-callback`. `/`, `/search`, listing pages and `/privacy` stay crawlable. The last line is `Sitemap: https://where-to-park.expo.app/sitemap.xml`.

### sitemap.xml

`npm run seo:build` (run by the web deploy right after `expo export`) writes `dist/sitemap.xml` with:

- the home page `https://where-to-park.expo.app/`;
- one search link per **popular place** in `seo/popular-places.json` (always all of them);
- one search link per **city or municipality with published listings** that a popular place does not already cover (same name, or within 2 km).

Each search link is `https://where-to-park.expo.app/search?lat=<5 dp>&lng=<5 dp>&place=<encoded name>`, with no filters. It is built by `searchCanonicalUrl`, the same function the search page uses for `<link rel="canonical">`, so the sitemap URL and the page canonical are the same string. In the XML each `&` is written `&amp;`. Every URL has a `<lastmod>`: the deploy date for the home page and popular places, and the newest listing update for a listing area (a popular place covering listings takes that date when it is newer).

Listing areas come from staging with the anon key (the same public read the app uses): `locations` that are published and not deleted. Each listing is named by Photon reverse geocoding (the app's geocoder) at city level, and the area is centred on that town (Photon forward search, within 25 km) when every listing of the area is within 3 km of it, the search page's default distance, so the page shows them; otherwise on its listings. If the database or Photon cannot be reached, the script uses the last good list (`SEO_CACHE`, default `/tmp/where-to-park-seo-areas.json`), otherwise popular places only. The deploy never fails because of this step. `SEO_OFFLINE=1` skips the network; `SEO_DIST` writes somewhere other than `dist/`.

Today (2026-11-22) staging has listings in Baguio (covered by the popular Baguio entry) and Binalonan, Pangasinan (added, centred on its listing at 16.10293, 120.60551, which is 6.6 km from the town centre), so the sitemap has 46 URLs.

### Popular places

`seo/popular-places.json` is the reviewed list (label, lat, lng, how it was checked). The label is the place in the page title, 'Parking near <label> | Where To Park'. Each point was found with Nominatim (OpenStreetMap) and checked by reverse geocoding at street level (zoom 18) that it falls inside the named city or municipality. To change the list, edit the file (5 decimals), check the point the same way, run `npm run test:unit`, and redeploy the web app.

| Place | Lat | Lng | Verified via |
|---|---|---|---|
| Makati CBD | 14.55100 | 121.02881 | Nominatim/OSM way/462035253 (Ayala Avenue); reverse lands in Makati |
| Bonifacio Global City (BGC), Taguig | 14.55081 | 121.05097 | Nominatim/OSM node/14023498207 (Bonifacio Global City); reverse lands in Taguig |
| Ortigas Center, Pasig | 14.58433 | 121.06152 | Nominatim/OSM way/67328018 (Ortigas Center Pedestrian Link Bridge); reverse lands in Pasig |
| Quezon City | 14.65145 | 121.04929 | Nominatim/OSM relation/12322420 (Quezon Memorial Circle); reverse lands in Quezon City |
| Araneta City, Cubao | 14.62051 | 121.05428 | Nominatim/OSM relation/12992097 (Araneta City); reverse lands in Quezon City |
| Eastwood City, Quezon City | 14.60961 | 121.07997 | Nominatim/OSM way/27350736 (Eastwood City); reverse lands in Quezon City |
| UP Diliman, Quezon City | 14.65038 | 121.06764 | Nominatim/OSM relation/20670730 (University of the Philippines Diliman); reverse lands in Quezon City |
| Manila | 14.58930 | 120.98164 | Nominatim/OSM relation/452620 (Manila City Hall); reverse lands in Manila |
| Intramuros, Manila | 14.59096 | 120.97465 | Nominatim/OSM relation/103707 (Intramuros); reverse lands in Manila |
| Binondo, Manila | 14.59992 | 120.97403 | Nominatim/OSM relation/141867 (Binondo); reverse lands in Manila |
| Rizal Park (Luneta), Manila | 14.58298 | 120.97927 | Nominatim/OSM way/24159887 (Parque Rizal); reverse lands in Manila |
| SM Mall of Asia, Pasay | 14.53518 | 120.98160 | Nominatim/OSM relation/21624091 (SM Mall of Asia); reverse lands in Pasay |
| Pasay | 14.54388 | 120.99448 | Nominatim/OSM node/7841782517 (Pasay City Hall); reverse lands in Pasay |
| NAIA Terminal 1 | 14.50537 | 121.00647 | Nominatim/OSM way/303140568 (NAIA Terminal 1); reverse lands in Parañaque |
| NAIA Terminal 2 | 14.51005 | 121.01277 | Nominatim/OSM node/3238982941 (NAIA Terminal 2); reverse lands in Pasay |
| NAIA Terminal 3 | 14.51923 | 121.01375 | Nominatim/OSM way/303142869 (NAIA Terminal 3); reverse lands in Pasay |
| Entertainment City, Parañaque | 14.51431 | 120.97971 | Nominatim/OSM relation/7935161 (Okada Manila); reverse lands in Parañaque |
| Alabang, Muntinlupa | 14.42367 | 121.02972 | Nominatim/OSM relation/19103182 (Alabang Town Center); reverse lands in Muntinlupa |
| Greenhills, San Juan | 14.60174 | 121.04992 | Nominatim/OSM way/30086770 (Greenhills Shopping Center); reverse lands in San Juan |
| Mandaluyong | 14.57770 | 121.03366 | Nominatim/OSM way/112549085 (Mandaluyong City Hall); reverse lands in Mandaluyong |
| Marikina | 14.63303 | 121.09895 | Nominatim/OSM way/7972240 (Marikina City Hall); reverse lands in Marikina |
| Antipolo | 14.58769 | 121.17666 | Nominatim/OSM way/94093055 (Antipolo Cathedral); reverse lands in Antipolo |
| Baguio | 16.41250 | 120.59751 | Nominatim/OSM way/1190964348 (Session Road); reverse lands in Baguio |
| Tagaytay | 14.11529 | 120.96198 | Nominatim/OSM way/890829772 (Tagaytay Rotonda); reverse lands in Tagaytay |
| Clark Freeport Zone, Pampanga | 15.18107 | 120.52743 | Nominatim/OSM node/10704760914 (BIR RDO 21C - Clark Freeport Zone); reverse lands in Mabalacat |
| Angeles City | 15.16554 | 120.60802 | Nominatim/OSM way/96584426 (Angeles City Hall); reverse lands in Angeles |
| Subic Bay Freeport Zone | 14.82032 | 120.28211 | Nominatim/OSM way/317449618 (Subic Bay Freeport Zone); reverse lands in Olongapo |
| Batangas City | 13.75574 | 121.05803 | Nominatim/OSM way/131893368 (Bahay Pamahalaan Lungsod ng Batangas); reverse lands in Batangas City |
| Lipa | 13.95723 | 121.16462 | Nominatim/OSM way/55557212 (Lipa City Hall); reverse lands in Lipa |
| Vigan | 17.56779 | 120.38764 | Nominatim/OSM way/88477833 (Calle Crisologo); reverse lands in Vigan |
| Naga City, Camarines Sur | 13.62607 | 123.19868 | Nominatim/OSM way/23669724 (Naga City Hall); reverse lands in Naga |
| Cebu City | 10.29287 | 123.90167 | Nominatim/OSM way/855225484 (Cebu City Hall); reverse lands in Cebu City |
| Cebu IT Park | 10.33080 | 123.90683 | Nominatim/OSM relation/16298925 (Cebu I.T. Park); reverse lands in Cebu City |
| Ayala Center Cebu | 10.31810 | 123.90516 | Nominatim/OSM way/1290804007 (Ayala Center Cebu); reverse lands in Cebu City |
| Mactan-Cebu International Airport | 10.31034 | 123.97931 | Nominatim/OSM relation/4040104 (Mactan–Cebu International Airport); reverse lands in Lapu-Lapu |
| Iloilo City | 10.69336 | 122.57323 | Nominatim/OSM way/174033035 (Iloilo City Hall); reverse lands in Iloilo City |
| Bacolod | 10.65886 | 122.96643 | Nominatim/OSM relation/11020833 (New Bacolod City Hall); reverse lands in Bacolod |
| Dumaguete | 9.30314 | 123.31087 | Nominatim/OSM way/710506714 (Rizal Boulevard); reverse lands in Dumaguete |
| Tacloban | 11.24365 | 125.00795 | Nominatim/OSM way/104374502 (Tacloban City Hall); reverse lands in Tacloban |
| Puerto Princesa | 9.78347 | 118.73202 | Nominatim/OSM way/293426739 (Puerto Princesa City Hall); reverse lands in Puerto Princesa |
| Davao City | 7.06445 | 125.60772 | Nominatim/OSM relation/3581578 (City Hall of Davao); reverse lands in Davao City |
| Cagayan de Oro | 8.47640 | 124.64119 | Nominatim/OSM node/6255545471 (City Health Insurance Office); reverse lands in Cagayan de Oro |
| General Santos | 6.11307 | 125.17173 | Nominatim/OSM way/267411093 (General Santos City Hall); reverse lands in General Santos |
| Zamboanga City | 6.90391 | 122.07648 | Nominatim/OSM way/270522967 (Zamboanga City Hall); reverse lands in Zamboanga City |

### Link previews (Open Graph)

`public/og-image.png` is one branded image for the whole site: the white brand pin on the brand blue, 'Where To Park', 'Find parking near you' and the web address. It is made by code: `npm run og:image` (`scripts/og/make-og-image.py`, Pillow and the Poppins font) from `assets/brand/pin-transparent-cropped.png`. Re-run it after a brand or host change.

The served HTML (`public/index.html`) has `og:image`, `og:image:secure_url`, `og:image:type` (`image/png`), `og:image:width` (1200), `og:image:height` (630), `og:image:alt`, `twitter:card` (`summary_large_image`), `twitter:image` and `twitter:image:alt`. The search page sets the same tags in the browser with a place-specific alt. Facebook and chat apps read only the served HTML, so their preview shows the site-wide title, description and image for every link. Place-specific previews would need server rendering (not built).

## Google Search Console (rj)

🟧 Verification code added Nov 22, 2026 (rj t230u): the served HTML now carries `<meta name="google-site-verification" content="KUqQ5q9N1mrY8-o_JSgbcD7InY0UwZpdNvLPZVwnmDM" />`. Remaining for rj: press **Verify** in Search Console, then submit `sitemap.xml` (steps 5 and 6).

The verification tag is added to the served HTML at deploy time from `web-host.json`:

```json
{ "hosts": ["where-to-park.expo.app"], "googleSiteVerification": "KUqQ5q9N1mrY8-o_JSgbcD7InY0UwZpdNvLPZVwnmDM" }
```

1. Open https://search.google.com/search-console and **Add property**.
2. Choose **URL prefix** and enter `https://where-to-park.expo.app`. A **Domain** property does not work, because it needs a DNS record on `expo.app`, which Expo owns.
3. Choose **HTML tag** as the verification method. Google shows `<meta name="google-site-verification" content="…" />`. Send the `content` value only (it is public, not a secret).
4. It goes in `googleSiteVerification` in `web-host.json`; then redeploy the website. Only letters, numbers, `_` and `-` are accepted; anything else stops the SEO step with an error and the deploy continues without the tag.
5. Back in Search Console, press **Verify**. Leave the tag in place afterwards; Google rechecks it.
6. Open **Sitemaps**, enter `sitemap.xml` and press **Submit**. Use **URL inspection** on one sitemap link to request indexing sooner.

## Changing the web address

After a host change (see [eas-build.md](eas-build.md#replacing-the-web-address)), also update the `Sitemap:` line in `public/robots.txt` and the `https://where-to-park.expo.app` URLs in `public/index.html` (a unit test fails until they match `web-host.json`), re-run `npm run og:image`, and add the new host as a URL-prefix property in Search Console.
