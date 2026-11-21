import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANDROID_PACKAGE,
  ANDROID_SHA256_CERT_FINGERPRINTS,
  APPLE_TEAM_ID,
  WEB_HOST,
  androidAssetLinks,
  androidIntentFilters,
  appleAppSiteAssociation,
  httpsLinkOpensApp,
  iosAssociatedDomains,
} from './appLinks.ts';

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

test('the site file and the Android claim use the preview certificate', () => {
  const statement = androidAssetLinks()[0];
  assert.deepEqual(statement.relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(statement.target.namespace, 'android_app');
  assert.equal(statement.target.package_name, ANDROID_PACKAGE);
  for (const fingerprint of ANDROID_SHA256_CERT_FINGERPRINTS) {
    assert.match(fingerprint, /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  }
  const hosted = JSON.parse(readFileSync(join(root, 'public/.well-known/assetlinks.json'), 'utf8'));
  assert.deepEqual(hosted, androidAssetLinks());
});

test('app config claims the site on Android and iOS', () => {
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
  assert.deepEqual(app.ios.associatedDomains, iosAssociatedDomains());
  assert.deepEqual(app.android.intentFilters, androidIntentFilters());
  assert.equal(app.android.package, ANDROID_PACKAGE);
  assert.equal(app.ios.bundleIdentifier, ANDROID_PACKAGE);
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
