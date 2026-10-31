import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export type PushMessage = { to: string; title: string; body: string };

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

export async function sendExpoPush(messages: PushMessage[]) {
  const valid = messages.filter((m) => m.to);
  if (!valid.length) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(valid),
  }).catch(() => undefined);
}

export async function deliverReturnedPush(data: any, title: string, body: string) {
  const tokens: string[] = data?.push_tokens || [];
  await sendExpoPush(tokens.map((to) => ({ to, title, body })));
}
