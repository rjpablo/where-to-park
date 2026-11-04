import React from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { notificationRoute } from '../lib/notificationRoute';
import { setupPushNotifications } from '../lib/push';
import { refreshSidebarCounts } from '../stores/sidebarStore';

/** The last push tap already handled (survives restarts). */
const HANDLED_KEY = 'wtp-push-last-handled';

/**
 * Push handling (rj t173u): a push received while the app is open refreshes the unread
 * counts; tapping a push (app open, in the background, or cold start) opens its screen.
 * 🟧 rj: a normal launch opens Find Parking. The OS keeps the last tap ("last notification
 * response") across launches, so it is cleared once handled and its id is remembered;
 * otherwise every cold start re-opened that old push's screen (e.g. Notifications).
 */
export function PushNotificationsBridge() {
  const router = useRouter();
  const handled = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    setupPushNotifications();

    const open = async (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const key = response.notification.request.identifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      Notifications.clearLastNotificationResponse();
      if ((await AsyncStorage.getItem(HANDLED_KEY).catch(() => null)) === key) return;
      await AsyncStorage.setItem(HANDLED_KEY, key).catch(() => undefined);
      const data = response.notification.request.content.data as Record<string, unknown>;
      router.push(notificationRoute(data) as never);
      refreshSidebarCounts();
    };

    // Cold start from a tap (only a tap not handled before).
    try {
      open(Notifications.getLastNotificationResponse()).catch(() => undefined);
    } catch {
      // not available on this platform
    }
    const tapSub = Notifications.addNotificationResponseReceivedListener((r) => {
      open(r).catch(() => undefined);
    });
    const recvSub = Notifications.addNotificationReceivedListener(() => refreshSidebarCounts());
    return () => {
      tapSub.remove();
      recvSub.remove();
    };
  }, [router]);

  return null;
}
