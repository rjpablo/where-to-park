import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { useAuthStore } from '../src/stores/authStore';
import { theme } from '../src/lib/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut, initialize } = useAuthStore();

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  if (!user) {
    return (
      <View style={styles.container} testID="profile-guest">
        <Text style={styles.title}>Not signed in</Text>
        <Button title="Sign in with phone" onPress={() => router.push('/auth')} />
        <Button title="Keep browsing" variant="outline" onPress={() => router.replace('/search')} />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="profile-ready">
      <Text style={styles.title}>{user.display_name}</Text>
      <Text style={styles.meta} testID="profile-account-type">
        Account type: {user.account_type || 'driver'}
      </Text>
      {user.phone ? <Text style={styles.meta}>Phone: {user.phone}</Text> : null}
      {user.is_admin ? <Text style={styles.meta}>Admin</Text> : null}
      <Button
        title="Sign out"
        variant="outline"
        onPress={async () => {
          await signOut();
          router.replace('/search');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    gap: theme.spacing.md,
  },
  title: { ...theme.typography.h2 },
  meta: { ...theme.typography.body, color: theme.colors.text.secondary },
});
