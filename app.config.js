// app.json holds the static config; Expo passes it in as `config`. This adds the
// EXPO_PUBLIC_* values (from eas.json build profiles or the shell) to `extra`.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
  },
});
