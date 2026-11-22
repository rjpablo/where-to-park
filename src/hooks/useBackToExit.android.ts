import { useEffect, useRef } from 'react';
import { BackHandler, ToastAndroid } from 'react-native';
import { router, useGlobalSearchParams, useSegments } from 'expo-router';
import { createBackToExit } from '../lib/backToExit';
import { backFallback, type RouteParams } from '../lib/backFallback';
import { useSearchStore } from '../stores/searchStore';

/**
 * Android hardware back:
 * - with history: normal back navigation;
 * - without history (app opened on a child page): one level up to the page's parent
 *   (same table as the header Back, src/lib/backFallback.ts), level by level to Search;
 * - on Search with the results sheet maximized and nowhere to go: minimize the sheet;
 * - on Search otherwise: the first press shows "Press back again to close the app";
 *   a second press within 2s closes it. That includes a sheet that is already minimized.
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
      const routeName = current.current.name;
      const parent = canGoBack ? null : backFallback(routeName, current.current.params);
      const sheetMaximized =
        routeName === 'search' && useSearchStore.getState().sheetPosition === 'maximized';
      const result = press.current(canGoBack, Date.now(), parent, sheetMaximized);
      if (result === 'navigate') return false; // let the navigator go back
      if (result === 'minimize') {
        useSearchStore.getState().setSheetPosition('minimized');
        return true;
      }
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
