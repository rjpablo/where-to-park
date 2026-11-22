import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  ANDROID_PACKAGE,
  ANDROID_SHA256_CERT_FINGERPRINTS,
  APPLE_TEAM_ID,
  WEB_HOST,
  WEB_HOSTS,
  androidAssetLinks,
  androidIntentFilters,
  appleAppSiteAssociation,
  assertWebHosts,
  httpsLinkOpensApp,
  iosAssociatedDomains,
} from './appLinks.ts';

const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('an https page on the site opens the app; Google website return does not', () => {
  assert.equal(httpsLinkOpensApp(`https://${WEB_HOST}/`), true);
  assert.equal(httpsLinkOpensApp(`https://${WEB_HOST}`), true);
  assert.equal(httpsLinkOpensApp(`https://${WEB_HOST}/location/abc`), true);
  assert.equal(
    httpsLinkOpensApp(`https://${WEB_HOST}/search?lat=16.41&lng=120.59&place=Baguio`),
    true
  );
  assert.equal(httpsLinkOpensApp(`https://${WEB_HOST}/operator/reports/collections`), true);
  assert.equal(httpsLinkOpensApp(`https://${WEB_HOST}/oauth-callback?code=abc`), false);
  assert.equal(httpsLinkOpensApp(`https://${WEB_HOST}/oauth-callback/extra`), false);
  assert.equal(httpsLinkOpensApp(`http://${WEB_HOST}/search`), false);
  assert.equal(httpsLinkOpensApp(`https://${WEB_HOST}.evil.com/search`), false);
  assert.equal(httpsLinkOpensApp('wheretopark://location/abc'), false);
  assert.equal(httpsLinkOpensApp('not a url'), false);
});

test('the host list is web-host.json, and a second host is claimed with it', () => {
  const listed = JSON.parse(readFileSync(join(root, 'web-host.json'), 'utf8')).hosts;
  assert.deepEqual(WEB_HOSTS, listed);
  assert.equal(WEB_HOST, listed[0]);
  assert.equal(readFileSync(join(root, 'app.json'), 'utf8').includes(WEB_HOST), false);
  const hosts = ['parking.example', WEB_HOST];
  assert.equal(httpsLinkOpensApp('https://parking.example/location/abc', hosts), true);
  assert.equal(httpsLinkOpensApp(`https://${WEB_HOST}/search`, hosts), true);
  assert.deepEqual(iosAssociatedDomains(hosts), [
    'applinks:parking.example',
    `applinks:${WEB_HOST}`,
  ]);
  const data = androidIntentFilters(hosts)[0].data;
  assert.equal(
    data.filter((item) => item.host === 'parking.example').length,
    data.filter((item) => item.host === WEB_HOST).length
  );
  assert.throws(() => assertWebHosts([]), /web-host.json/);
  assert.throws(() => assertWebHosts(['https://parking.example']), /names only/);
});

test('the site file and the Android claim list the EAS and Play signing certificates', () => {
  const statement = androidAssetLinks()[0];
  assert.deepEqual(statement.relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(statement.target.namespace, 'android_app');
  assert.equal(statement.target.package_name, ANDROID_PACKAGE);
  for (const fingerprint of ANDROID_SHA256_CERT_FINGERPRINTS) {
    assert.match(fingerprint, /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  }
  assert.deepEqual(statement.target.sha256_cert_fingerprints, [
    // EAS keystore (upload key)
    '49:3E:FE:0F:CD:7C:72:3A:F4:D8:B9:B2:00:DC:48:1B:E0:CB:87:3A:63:85:EE:28:C4:77:E8:EC:42:45:B2:25',
    // Google Play App Signing key (Classical)
    '66:71:4A:EB:D0:C4:59:5F:F8:05:80:E2:0D:A8:20:37:50:BC:AD:19:56:7C:33:B6:4E:C9:75:33:C1:62:16:A7',
  ]);
  const hosted = JSON.parse(readFileSync(join(root, 'public/.well-known/assetlinks.json'), 'utf8'));
  assert.deepEqual(hosted, androidAssetLinks());
});

test('app config claims the site on Android and iOS', () => {
  const appJson = require('../../app.json');
  const config = require('../../app.config.js')({ config: appJson.expo });
  assert.deepEqual(config.ios.associatedDomains, iosAssociatedDomains());
  assert.deepEqual(config.android.intentFilters, androidIntentFilters());
  assert.equal(config.android.package, ANDROID_PACKAGE);
  assert.equal(config.ios.bundleIdentifier, ANDROID_PACKAGE);
  assert.equal(appJson.expo.ios.associatedDomains, undefined);
  assert.equal(appJson.expo.android.intentFilters, undefined);
  const data = androidIntentFilters()[0].data;
  assert.equal(
    data.some((item) => 'pathPrefix' in item && item.pathPrefix === '/oauth-callback'),
    false
  );
});

test('the Apple file is published only with a real team id', () => {
  const aasa = join(root, 'public/.well-known/apple-app-site-association');
  assert.throws(() => appleAppSiteAssociation(''), /Apple Team ID/);
  assert.throws(() => appleAppSiteAssociation('not-a-team'), /Apple Team ID/);
  const built = appleAppSiteAssociation('XQAX5LF48P');
  assert.equal(built.applinks.details[0].appIDs[0], 'XQAX5LF48P.com.thebadcompany.wheretopark');
  assert.equal(built.applinks.details[0].components[0].exclude, true);
  if (APPLE_TEAM_ID == null) {
    assert.equal(existsSync(aasa), false);
  } else {
    assert.deepEqual(
      JSON.parse(readFileSync(aasa, 'utf8')),
      appleAppSiteAssociation(APPLE_TEAM_ID)
    );
  }
});
