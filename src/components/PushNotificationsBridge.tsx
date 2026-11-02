import React from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { notificationRoute } from '../lib/notificationRoute';
import { setupPushNotifications } from '../lib/push';
import { refreshSidebarCounts } from '../stores/sidebarStore';

/**
 * Push handling (rj t173u): a push received while the app is open refreshes the unread
 * counts; tapping a push (app open, in the background, or cold start) opens its screen.
 */
export function PushNotificationsBridge() {
  const router = useRouter();
  const handled = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    setupPushNotifications();

    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const key = response.notification.request.identifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      const data = response.notification.request.content.data as Record<string, unknown>;
      router.push(notificationRoute(data) as never);
      refreshSidebarCounts();
    };

    // Cold start from a tap.
    Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => undefined);
    const tapSub = Notifications.addNotificationResponseReceivedListener(open);
    const recvSub = Notifications.addNotificationReceivedListener(() => refreshSidebarCounts());
    return () => {
      tapSub.remove();
      recvSub.remove();
    };
  }, [router]);

  return null;
}
