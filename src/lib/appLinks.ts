/**
 * https hosts in web-host.json open the installed app.
 * Android reads public/.well-known/assetlinks.json. iOS reads
 * public/.well-known/apple-app-site-association once APPLE_TEAM_ID is set.
 * Google's website return stays in the browser: the code was issued for that
 * tab, and the app would fail the exchange.
 *
 * This file is Node-only (app config and unit tests). The phone claim is the
 * native config app.config.js writes from the same host list.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const links = require('./webLinks.js') as {
  WEB_HOST: string;
  WEB_HOSTS: string[];
  APP_LINK_PATH_PREFIXES: readonly string[];
  assertWebHosts: (hosts: unknown) => string[];
  httpsLinkOpensApp: (url: string, hosts?: string[]) => boolean;
  iosAssociatedDomains: (hosts?: string[]) => string[];
  androidIntentFilters: (hosts?: string[]) => {
    action: string;
    autoVerify: boolean;
    data: { scheme: string; host: string; path?: string; pathPrefix?: string }[];
    category: string[];
  }[];
};

export const WEB_HOST: string = links.WEB_HOST;
export const WEB_HOSTS: readonly string[] = links.WEB_HOSTS;
export const APP_LINK_PATH_PREFIXES = links.APP_LINK_PATH_PREFIXES;

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

export function assertWebHosts(hosts: unknown): string[] {
  return links.assertWebHosts(hosts);
}

export function httpsLinkOpensApp(url: string, hosts?: string[]): boolean {
  return links.httpsLinkOpensApp(url, hosts);
}

export function iosAssociatedDomains(hosts?: string[]): string[] {
  return links.iosAssociatedDomains(hosts);
}

export function androidIntentFilters(hosts?: string[]) {
  return links.androidIntentFilters(hosts);
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
