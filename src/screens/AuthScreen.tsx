import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../components/Button';
import { useAuthStore } from '../stores/authStore';
import { isLocalSupabaseUrl } from '../lib/env';
import { theme } from '../lib/theme';
import { useBottomInset } from '../hooks/useBottomInset';

export function AuthScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const { requestOtp, verifyOtp, completeProfile, signInWithGoogle, signOut, loading } =
    useAuthStore();
  const user = useAuthStore((s) => s.user);
  // Accounts page: 'Add account' / signing a saved account in again (phone prefilled).
  // complete=1: back from Google as a new account, finish onboarding (name prefilled).
  const params = useLocalSearchParams<{ phone?: string; add?: string; complete?: string }>();
  const [step, setStep] = React.useState<'phone' | 'code' | 'profile'>(
    params.complete ? 'profile' : 'phone'
  );
  const [googleBusy, setGoogleBusy] = React.useState(false);
  const presetPhone = typeof params.phone === 'string' ? params.phone : '';
  const [phone, setPhone] = React.useState(presetPhone || '+639183333333');
  const [code, setCode] = React.useState('');
  const [displayName, setDisplayName] = React.useState(
    params.complete && user?.display_name && user.display_name !== 'New user'
      ? user.display_name
      : ''
  );
  // The profile can arrive after the screen (web redirect): prefill once it does.
  React.useEffect(() => {
    if (params.complete && !displayName && user?.display_name && user.display_name !== 'New user') {
      setDisplayName(user.display_name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.display_name]);
  const [error, setError] = React.useState<string | null>(null);

  const send = async () => {
    setError(null);
    try {
      await requestOtp(phone.trim());
      setStep('code');
    } catch (err: any) {
      setError(err.message || 'Could not send code');
    }
  };

  const verify = async () => {
    setError(null);
    try {
      const result = await verifyOtp(phone.trim(), code.trim());
      if (result.isNew) {
        setStep('profile');
        return;
      }
      router.replace('/search');
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    }
  };

  const google = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      const res = await signInWithGoogle('signin');
      if (res.status !== 'done') return; // web: navigating to Google; or cancelled
      if (res.isNew) {
        setStep('profile');
        const name = useAuthStore.getState().user?.display_name;
        if (name && name !== 'New user') setDisplayName(name);
        return;
      }
      router.replace('/search');
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
    } finally {
      setGoogleBusy(false);
    }
  };

  const finishProfile = async () => {
    setError(null);
    try {
      // rj: no Driver/Operator choice here. Everyone starts as a driver ('List your parking
      // space' in the sidebar switches to operator); an account that is already an operator
      // (finishing onboarding again) keeps its type.
      await completeProfile(
        displayName.trim(),
        useAuthStore.getState().user?.account_type === 'operator' ? 'operator' : 'driver'
      );
      router.replace('/search');
    } catch (err: any) {
      setError(err.message || 'Could not save profile');
    }
  };

  return (
    <View style={[styles.container, bottomInset]} testID="auth-ready">
      <Text style={styles.title}>Where To Park</Text>
      <Text style={styles.subtitle}>
        {params.complete
          ? 'Almost done: confirm your name'
          : params.add
            ? 'Add an account: sign in with its phone or Google'
            : 'Sign in with your phone or Google'}
      </Text>
      {params.add ? (
        <Text style={styles.subtitle} testID="auth-add-note">
          Your other accounts stay signed in on this device.
        </Text>
      ) : null}

      {step === 'phone' && (
        <View>
          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            testID="auth-phone"
          />
          <Button title="Send code" onPress={send} loading={loading} testID="auth-send-otp" />
          <Text style={styles.or}>or</Text>
          <Button
            title="Continue with Google"
            variant="outline"
            onPress={google}
            loading={googleBusy}
            testID="auth-google"
          />
        </View>
      )}

      {step === 'code' && (
        <View>
          <Text style={styles.label}>6-digit code</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="123456"
            testID="auth-otp"
          />
          {__DEV__ && isLocalSupabaseUrl() ? (
            <Text style={styles.hint} testID="auth-otp-hint">
              Local test OTP is 123456
            </Text>
          ) : null}
          <Button title="Verify" onPress={verify} loading={loading} testID="auth-verify" />
        </View>
      )}

      {step === 'profile' && (
        <View testID="auth-profile-form">
          <Text style={styles.label}>Display name</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            testID="auth-display-name"
          />
          <Button
            title="Save profile"
            onPress={finishProfile}
            loading={loading}
            testID="auth-save-profile"
          />
        </View>
      )}

      {error ? (
        <Text style={styles.error} testID="auth-error">
          {error}
        </Text>
      ) : null}

      {/* Guests only (rj t151u): it never signed anyone out, so while signed in (Google or
          phone onboarding, Add account) it just left the session as it was. */}
      {!user && step !== 'profile' ? (
        <Button
          title="Browse as guest"
          variant="outline"
          onPress={() => router.replace('/search')}
          style={{ marginTop: theme.spacing.lg }}
          testID="auth-guest"
        />
      ) : null}
      {step === 'profile' ? (
        <Text
          style={styles.signOutLink}
          onPress={async () => {
            await signOut();
            router.replace('/accounts');
          }}
          testID="auth-onboarding-sign-out"
        >
          Sign out
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  signOutLink: {
    textAlign: 'center',
    color: theme.colors.text.secondary,
    textDecorationLine: 'underline',
    marginTop: theme.spacing.lg,
  },
  or: {
    textAlign: 'center',
    color: theme.colors.text.secondary,
    marginVertical: theme.spacing.sm,
  },
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
  },
  title: {
    ...theme.typography.h1,
    color: theme.colors.primary,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  label: { ...theme.typography.bodySmall, fontWeight: '600', marginBottom: theme.spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    fontSize: 16,
  },
  hint: {
    ...theme.typography.caption,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.md,
  },
  row: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.md },
});
