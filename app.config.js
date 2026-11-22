// app.json holds the static config; Expo passes it in as `config`. This adds the
// EXPO_PUBLIC_* values (from eas.json build profiles or the shell) to `extra`,
// and the https hosts from web-host.json to the iOS and Android link claims.
const { iosAssociatedDomains, androidIntentFilters } = require('./src/lib/webLinks.js');

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    associatedDomains: iosAssociatedDomains(),
  },
  android: {
    ...config.android,
    intentFilters: androidIntentFilters(),
  },
  extra: {
    ...config.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
  },
});
