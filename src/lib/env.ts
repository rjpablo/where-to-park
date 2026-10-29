import Constants from 'expo-constants';

export function getSupabaseUrl(): string {
  return (
    Constants.expoConfig?.extra?.supabaseUrl ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    ''
  ).replace(/\/$/, '');
}

export function isLocalSupabaseUrl(url: string = getSupabaseUrl()): boolean {
  return /localhost|127\.0\.0\.1/i.test(url);
}
