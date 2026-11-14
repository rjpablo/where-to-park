# AdMob (banner ads)

Where To Park shows Google AdMob **banner ads** on Android. Interstitials are planned for
later. Ads never show on the web app and never show to admins.

## IDs

| What | Value | Where it is used |
|---|---|---|
| AdMob account | `rjpablo.dev@gmail.com` | AdMob console sign-in |
| Android App ID | `ca-app-pub-3932328959688671~3884874189` | `app.json` → plugin `react-native-google-mobile-ads` → `androidAppId` |
| Android banner ad unit (real) | `ca-app-pub-3932328959688671/2188649130` | `src/lib/ads.ts` → `PROD_BANNER_UNIT_ID` |
| Google test banner unit | `ca-app-pub-3940256099942544/9214589741` | `src/lib/ads.ts` → `TEST_BANNER_UNIT_ID` |
| iOS App ID | `ca-app-pub-3940256099942544~1458002511` (Google's sample) | `app.json` `iosAppId`. iOS isn't shipped; this only keeps the plugin config valid. Replace it with a real iOS app ID before any iOS release. |

These IDs are not secrets and are fine to commit.

## Which banner unit a build uses

`bannerUnitId()` in `src/lib/ads.ts`:

1. **Development builds (`__DEV__`, Metro / dev client):** always Google's test banner, so
   tapping it never counts as invalid traffic.
2. **Release builds (EAS `preview` APK and `production` AAB):** `EXPO_PUBLIC_ADMOB_BANNER_ID`
   if that env var is set for the build (e.g. in an `eas.json` profile's `env`), otherwise
   the real unit `PROD_BANNER_UNIT_ID`.

To change the real unit, edit `PROD_BANNER_UNIT_ID` (one line), or set
`EXPO_PUBLIC_ADMOB_BANNER_ID` per profile. To force test ads in a release build (for
example a preview APK you tap a lot), set
`EXPO_PUBLIC_ADMOB_BANNER_ID=ca-app-pub-3940256099942544/9214589741` in that profile.

**Don't tap real ads on your own phone.** Add your phone as a test device in AdMob
(Settings → Test devices) before testing release builds, or AdMob may flag the account
for invalid clicks.

## How it is built

- Library: `react-native-google-mobile-ads` 16.5.0 with its Expo config plugin (`app.json`).
  It is a native module, so ads only appear after a **new Android build**.
- `src/lib/adsInit.native.ts` starts the SDK once (`mobileAds().initialize()`) from
  `app/_layout.tsx`. `src/lib/adsInit.ts` is the web no-op.
- `src/components/AdBanner.native.tsx`: one reusable anchored adaptive banner
  (`BannerAdSize.ANCHORED_ADAPTIVE_BANNER`, `requestNonPersonalizedAdsOnly: false`). It
  takes no space until an ad loads, then pads itself above the Android navigation bar. A
  failed load collapses it with no gap. `src/components/AdBanner.tsx` is the web stub
  (renders nothing; the native SDK is never imported on web).
- Admins: `shouldShowAds()` in `src/lib/ads.ts` hides the banner when the signed-in
  profile has `is_admin` (the same flag that shows the sidebar's admin items). Guests,
  drivers, operators, managers and staff see ads.
- `src/hooks/useBannerSlot.ts` lets a screen drop its own navigation-bar padding while the
  banner (which already pads for it) is showing.
- No EU/UK consent form (UMP) yet; the app is not targeting the EU/UK. Add it before
  launching there.

## Where banners show

All pinned to the bottom of the screen:

1. Find Parking (below the map and results sheet).
2. Location details (below the Reserve / Open Chat bar, so it is never mistaken for one of
   those buttons; see note below).
3. Notifications list.
4. Driver Sessions list.
5. Staff Availability, both Sessions and Reservations tabs (below the list; the + button
   sits above the banner).

No ads on sign-in / sign-up, chat threads, forms (check-in, edit session, reservation,
listing setup), payment and fee screens, settings or profile.

## Play Console (rj to do)

These must be updated before the build with ads is sent for review:

1. **App content → Ads:** answer **Yes, my app contains ads**.
2. **App content → Advertising ID:** declare that the app uses the advertising ID, purpose
   **Advertising or marketing** (and Analytics if asked). The app manifest includes the
   `com.google.android.gms.permission.AD_ID` permission (set in `app.json`).
3. **App content → Data safety:** add the data the Google Mobile Ads SDK collects:
   **Device or other IDs** (advertising ID), **App activity / App interactions**,
   **Diagnostics**, and **Approximate location** (from IP), shared with Google for
   **Advertising or marketing** and **Analytics**; collected data is encrypted in transit.
   See Google's guide: https://developers.google.com/admob/android/privacy/play-data-disclosure
4. **Target audience:** if any age group under 13 is selected, families ad policies apply;
   keep the audience 18+/13+ unless that changes.
5. The **Privacy Policy** should mention that the app shows ads from Google AdMob, which
   may use the advertising ID.

## app-ads.txt

AdMob asks for an `app-ads.txt` file on the developer website listed in the Play Store
listing. Once the store listing has a website (e.g. `https://example.com`), publish
`https://example.com/app-ads.txt` with the line AdMob shows under
**Apps → Where To Park → app-ads.txt**, which will look like:

```
google.com, pub-3932328959688671, DIRECT, f08c47fec0942fa0
```

Ads still serve without it, but AdMob may limit them until it is verified. If the website
is the Expo web app, the file would go in `public/app-ads.txt` (served from the site root);
ask before adding it.
