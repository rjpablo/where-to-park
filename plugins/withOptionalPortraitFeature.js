const { withAndroidManifest } = require('expo/config-plugins');

const FEATURE_NAME = 'android.hardware.screen.portrait';

/**
 * Keeps portrait lock (android:screenOrientation="portrait") but marks the
 * implied hardware feature as optional so Play Store still offers the app on
 * fixed-landscape devices (cars, some ChromeOS/desktop setups).
 */
function withOptionalPortraitFeature(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!Array.isArray(manifest['uses-feature'])) {
      manifest['uses-feature'] = [];
    }

    const existing = manifest['uses-feature'].find(
      (item) => item?.$?.['android:name'] === FEATURE_NAME
    );

    if (existing) {
      existing.$['android:required'] = 'false';
    } else {
      manifest['uses-feature'].push({
        $: {
          'android:name': FEATURE_NAME,
          'android:required': 'false',
        },
      });
    }

    return config;
  });
}

module.exports = withOptionalPortraitFeature;
