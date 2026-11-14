import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { useAuthStore } from '../src/stores/authStore';
import { authDestination } from '../src/lib/authReturn';
import { isNativeOAuthPending, readOAuthIntent } from '../src/lib/googleAuth';
import { theme } from '../src/lib/theme';

/**
 * Google redirects back here: https://…/oauth-callback on the web, wheretopark://oauth-callback
 * on Android. Web (and a native cold start) finish the sign-in here; when the native auth
 * session is still open it finishes it, and this screen just waits.
 */
export default function OAuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const completeOAuth = useAuthStore((s) => s.completeOAuth);
  const [error, setError] = React.useState<string | null>(null);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (Platform.OS !== 'web' && isNativeOAuthPending()) return; // the sign-in screen finishes it
    const url =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.href
        : `wheretopark://oauth-callback?${new URLSearchParams(
            Object.entries(params).map(([k, v]) => [k, String(Array.isArray(v) ? v[0] : v)])
          ).toString()}`;
    (async () => {
      try {
        const intent = await readOAuthIntent();
        const done = await completeOAuth(url);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          // Drop the one-time code from the address bar / history.
          window.history.replaceState(null, '', '/oauth-callback');
        }
        if (intent === 'link') router.replace('/profile?googleLinked=1' as never);
        else if (done?.isNew) router.replace('/auth?complete=1' as never);
        else router.replace(authDestination(null) as never);
      } catch (e: any) {
        setError(e?.message || 'Google sign-in failed');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container} testID="oauth-callback">
      {error ? (
        <>
          <Text style={styles.error} testID="oauth-error">
            {error}
          </Text>
          <Button
            title="Back to sign in"
            onPress={() => router.replace('/auth')}
            testID="oauth-back"
          />
        </>
      ) : (
        <>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.text}>Signing in with Google…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.background,
  },
  text: { color: theme.colors.text.secondary },
  error: { color: theme.colors.danger, textAlign: 'center' },
});
