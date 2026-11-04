import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomPadding } from '../lib/bottomInset';

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * `{ paddingBottom }` for a screen's scroll content (contentContainerStyle) or its
 * bottom-pinned row: `base` plus the navigation bar inset (Android edge-to-edge), so the
 * content can scroll behind the transparent nav bar and its end rests just above it.
 * Each screen applies this once; nothing else adds the inset.
 */
export function useBottomInset(base = 0): { paddingBottom: number } {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const paddingBottom = bottomPadding(base, insets.bottom, keyboardVisible);
  return useMemo(() => ({ paddingBottom }), [paddingBottom]);
}
