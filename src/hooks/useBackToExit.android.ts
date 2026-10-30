import { useEffect, useRef } from 'react';
import { BackHandler, ToastAndroid } from 'react-native';
import { router } from 'expo-router';
import { createBackToExit } from '../lib/backToExit';

/**
 * Android: on a root screen (no back history) the first hardware back press shows
 * "Press back again to close the app"; a second press within 2s closes it.
 * Screens with history keep normal back navigation.
 */
export function useBackToExit() {
  const press = useRef(createBackToExit());

  useEffect(() => {
    // Works whichever listener runs first: React Navigation's handler consumes the
    // press when it can go back, and this one returns false in that case too.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const result = press.current(router.canGoBack(), Date.now());
      if (result === 'navigate') return false; // let the navigator go back
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
