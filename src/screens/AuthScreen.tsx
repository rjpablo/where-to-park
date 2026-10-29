import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { Button } from '../components/Button';
import { useAuthStore } from '../stores/authStore';
import { theme } from '../lib/theme';

export function AuthScreen() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isSignUp, setIsSignUp] = React.useState(false);
  const { signIn, signInWithGoogle, loading } = useAuthStore();

  const handleEmailAuth = async () => {
    try {
      await signIn(email, password);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      await signInWithGoogle();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Where To Park</Text>
      <Text style={styles.subtitle}>Find parking in Baguio City</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Button
          title={isSignUp ? 'Sign Up' : 'Sign In'}
          onPress={handleEmailAuth}
          loading={loading}
        />

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <Button title="Continue with Google" onPress={handleGoogleAuth} variant="outline" />

        <Button
          title="Browse as Guest"
          onPress={() => {
            /* Navigate to main app */
          }}
          variant="outline"
          style={{ marginTop: theme.spacing.md }}
        />
      </View>

      <Text style={styles.switchText} onPress={() => setIsSignUp(!isSignUp)}>
        {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
      </Text>
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
    marginBottom: theme.spacing.xxl,
  },
  form: {
    width: '100%',
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    fontSize: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: theme.spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  dividerText: {
    marginHorizontal: theme.spacing.md,
    color: theme.colors.text.secondary,
  },
  switchText: {
    marginTop: theme.spacing.lg,
    textAlign: 'center',
    color: theme.colors.primary,
    ...theme.typography.body,
  },
});
