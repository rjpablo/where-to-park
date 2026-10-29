import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../components/Button';
import { useAuthStore } from '../stores/authStore';
import { theme } from '../lib/theme';

export function AuthScreen() {
  const router = useRouter();
  const { requestOtp, verifyOtp, completeProfile, loading } = useAuthStore();
  const [step, setStep] = React.useState<'phone' | 'code' | 'profile'>('phone');
  const [phone, setPhone] = React.useState('+639183333333');
  const [code, setCode] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [accountType, setAccountType] = React.useState<'driver' | 'operator'>('driver');
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

  const finishProfile = async () => {
    setError(null);
    try {
      await completeProfile(displayName.trim(), accountType);
      router.replace('/search');
    } catch (err: any) {
      setError(err.message || 'Could not save profile');
    }
  };

  return (
    <View style={styles.container} testID="auth-ready">
      <Text style={styles.title}>Where To Park</Text>
      <Text style={styles.subtitle}>Sign in with your phone</Text>

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
          {__DEV__ ? (
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
          <Text style={styles.label}>Account type</Text>
          <View style={styles.row}>
            <Button
              title="Driver"
              variant={accountType === 'driver' ? 'primary' : 'outline'}
              size="small"
              onPress={() => setAccountType('driver')}
              testID="auth-type-driver"
            />
            <Button
              title="Operator"
              variant={accountType === 'operator' ? 'primary' : 'outline'}
              size="small"
              onPress={() => setAccountType('operator')}
              testID="auth-type-operator"
            />
          </View>
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

      <Button
        title="Browse as guest"
        variant="outline"
        onPress={() => router.replace('/search')}
        style={{ marginTop: theme.spacing.lg }}
        testID="auth-guest"
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
