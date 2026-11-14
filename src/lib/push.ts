import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

/**
 * Push notifications (rj t173u). Delivery is server-side: a notifications row ->
 * trigger -> send-push Edge Function -> Expo -> FCM V1 (docs/push-notifications.md).
 * The app only registers / removes this device's Expo push token and handles taps.
 */

/** Must match ANDROID_CHANNEL_ID in supabase/functions/send-push/lib.ts. */
export const ANDROID_CHANNEL_ID = 'default';

const supported = Platform.OS !== 'web';
let currentToken: string | null = null;
let setUp = false;

/** Foreground display + Android channel. Safe to call more than once. */
export async function setupPushNotifications() {
  if (!supported || setUp) return;
  setUp = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    // Android 13+: the channel must exist before the permission prompt can show.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2563eb',
    }).catch(() => undefined);
  }
}

/**
 * Asked once someone is signed in (not on first launch / guest browsing): only signed-in
 * users get notifications. Never re-prompts after "Don't allow".
 */
export async function registerPushToken() {
  if (!supported) return;
  try {
    await setupPushNotifications();
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted' && current.canAskAgain !== false) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    if (!token) return;
    // The token is unique per device; registering moves it to whoever is signed in now.
    await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    currentToken = token;
    return token;
  } catch {
    return undefined;
  }
}

/**
 * Sign-out / switch account / guest: stop pushing this device to the current account.
 * Call while the old session is still active (the RPC deletes only the caller's tokens).
 */
export async function unregisterPushToken() {
  if (!supported) return;
  try {
    let token = currentToken;
    if (!token) {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;
      token = (await Notifications.getExpoPushTokenAsync()).data;
    }
    if (token) await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // Best effort: a stale token is cleaned up when the next account registers it.
  } finally {
    currentToken = null;
  }
}
