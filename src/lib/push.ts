import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export async function registerPushToken() {
  if (Platform.OS === 'web') return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return;
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    if (!token) return;
    await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    return token;
  } catch {
    return undefined;
  }
}
