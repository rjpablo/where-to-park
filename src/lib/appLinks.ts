/**
 * https://where-to-park.expo.app opens the installed app.
 * Android reads public/.well-known/assetlinks.json. iOS reads
 * public/.well-known/apple-app-site-association once APPLE_TEAM_ID is set.
 * Google's website return stays in the browser: the code was issued for that
 * tab, and the app would fail the exchange.
 */

export const WEB_HOST = 'where-to-park.expo.app';
export const ANDROID_PACKAGE = 'com.thebadcompany.wheretopark';
export const IOS_BUNDLE_ID = 'com.thebadcompany.wheretopark';

/**
 * SHA-256 of the preview keystore (docs/eas-build.md). A Play-installed build
 * also needs the Play app-signing certificate in this list.
 */
export const ANDROID_SHA256_CERT_FINGERPRINTS = [
  '49:3E:FE:0F:CD:7C:72:3A:F4:D8:B9:B2:00:DC:48:1B:E0:CB:87:3A:63:85:EE:28:C4:77:E8:EC:42:45:B2:25',
];

/** Null until an Apple Developer Team ID exists. iOS is not released. */
export const APPLE_TEAM_ID: string | null = null;

/** First path segment the app claims. `/` is claimed on its own. `/oauth-callback` is not. */
export const APP_LINK_PATH_PREFIXES = [
  '/search',
  '/location',
  '/auth',
  '/privacy',
  '/contact',
  '/profile',
  '/accounts',
  '/vehicles',
  '/shortcuts',
  '/notifications',
  '/sessions',
  '/reserve',
  '/chat',
  '/operator',
  '/staff',
  '/admin',
] as const;

const OAUTH_CALLBACK_PATH = '/oauth-callback';

export function httpsLinkOpensApp(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== WEB_HOST) return false;
  const path = parsed.pathname || '/';
  if (path === OAUTH_CALLBACK_PATH || path.startsWith(`${OAUTH_CALLBACK_PATH}/`)) return false;
  if (path === '/') return true;
  return APP_LINK_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function androidAssetLinks() {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [...ANDROID_SHA256_CERT_FINGERPRINTS],
      },
    },
  ];
}

export function iosAssociatedDomains(): string[] {
  return [`applinks:${WEB_HOST}`];
}

export function androidIntentFilters() {
  return [
    {
      action: 'VIEW',
      autoVerify: true,
      data: [
        { scheme: 'https', host: WEB_HOST, path: '/' },
        ...APP_LINK_PATH_PREFIXES.map((pathPrefix) => ({
          scheme: 'https',
          host: WEB_HOST,
          pathPrefix,
        })),
      ],
      category: ['BROWSABLE', 'DEFAULT'],
    },
  ];
}

/** Older `paths` plus the iOS 13 `components` form. `*` in paths does not cross a slash. */
export function appleAppSiteAssociation(teamId: string) {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error('Apple Team ID must be 10 letters or digits');
  }
  const appID = `${teamId}.${IOS_BUNDLE_ID}`;
  return {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appIDs: [appID],
          components: [
            {
              '/': '/oauth-callback',
              exclude: true,
              comment: 'Google sign-in on the website finishes in the browser',
            },
            {
              '/': '/oauth-callback/*',
              exclude: true,
              comment: 'Google sign-in on the website finishes in the browser',
            },
            {
              '/': '/*',
              comment: 'Any other page on the site opens the app',
            },
          ],
        },
        {
          appID,
          paths: [
            'NOT /oauth-callback',
            'NOT /oauth-callback/*',
            '/',
            '*',
            '/*',
            '/*/*',
            '/*/*/*',
            '/*/*/*/*',
          ],
        },
      ],
    },
  };
}
