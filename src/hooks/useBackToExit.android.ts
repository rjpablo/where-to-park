import { useEffect, useRef } from 'react';
import { BackHandler, ToastAndroid } from 'react-native';
import { router, useGlobalSearchParams, useSegments } from 'expo-router';
import { createBackToExit } from '../lib/backToExit';
import { backFallback, type RouteParams } from '../lib/backFallback';

/**
 * Android hardware back:
 * - with history: normal back navigation;
 * - without history (app opened on a child page): one level up to the page's parent
 *   (same table as the header Back, src/lib/backFallback.ts), level by level to Search;
 * - on Search: the first press shows "Press back again to close the app"; a second
 *   press within 2s closes it.
 */
export function useBackToExit() {
  const press = useRef(createBackToExit());
  // Current route, read at press time (route name = segments joined, e.g. 'operator/hub/[id]').
  const segments = useSegments();
  const params = useGlobalSearchParams();
  const current = useRef<{ name: string; params: RouteParams }>({ name: '', params: {} });
  current.current = { name: segments.join('/'), params: params as RouteParams };

  useEffect(() => {
    // Works whichever listener runs first: React Navigation's handler consumes the
    // press when it can go back, and this one returns false in that case too.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const canGoBack = router.canGoBack();
      const parent = canGoBack ? null : backFallback(current.current.name, current.current.params);
      const result = press.current(canGoBack, Date.now(), parent);
      if (result === 'navigate') return false; // let the navigator go back
      if (result === 'up' && parent) {
        router.replace(parent as never);
        return true;
      }
      if (result === 'exit') {
        BackHandler.exitApp();
        return true;
      }
      ToastAndroid.show('Press back again to close the app', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, []);
}
