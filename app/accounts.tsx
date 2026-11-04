import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { theme } from '../src/lib/theme';
import { useAuthStore } from '../src/stores/authStore';
import { useBottomInset } from '../src/hooks/useBottomInset';
import { Avatar } from '../src/components/Avatar';
import { accountLabel, accountSubLabel, type SavedAccount } from '../src/lib/accounts';

/** Accounts on this device: switch, add, sign out others, continue as guest. */
export default function AccountsScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const accounts = useAuthStore((s) => s.accounts);
  const loadAccounts = useAuthStore((s) => s.loadAccounts);
  const switchAccount = useAuthStore((s) => s.switchAccount);
  const signOutAccount = useAuthStore((s) => s.signOutAccount);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const initialize = useAuthStore((s) => s.initialize);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    initialize();
    loadAccounts();
  }, [initialize, loadAccounts]);

  const open = async (a: SavedAccount) => {
    if (busy || a.userId === user?.id) return;
    setNotice(null);
    if (a.status === 'signed_out') {
      router.push(
        (a.email
          ? `/auth?email=${encodeURIComponent(a.email)}`
          : `/auth?phone=${encodeURIComponent(a.phone || '')}`) as never
      );
      return;
    }
    setBusy(a.userId);
    const res = await switchAccount(a.userId);
    setBusy(null);
    if (res.error === 'signed_out') {
      setNotice(`${accountLabel(a)} is signed out. Tap it to sign in again.`);
      return;
    }
    if (res.error) {
      setNotice('Could not switch. Check your connection and try again.');
      return;
    }
    router.replace('/search');
  };

  const others = accounts.filter((a) => a.userId !== user?.id);
  const current = user ? accounts.find((a) => a.userId === user.id) : null;

  return (
    <ScrollView contentContainerStyle={[styles.container, bottomInset]} testID="accounts-ready">
      <Text style={styles.section}>Current</Text>
      <View style={[styles.row, styles.current]} testID="accounts-current">
        <Avatar
          url={user?.avatar_url}
          size={40}
          name={user?.display_name}
          testID="accounts-current-avatar"
        />
        <View style={styles.rowMain}>
          <Text style={styles.name}>
            {user ? accountLabel({ displayName: user.display_name, phone: user.phone }) : 'Guest'}
          </Text>
          <Text style={styles.sub}>
            {user
              ? current
                ? accountSubLabel(current) || 'Signed in'
                : user.phone || 'Signed in'
              : 'Not signed in · shortcuts on this device'}
          </Text>
        </View>
      </View>

      <Text style={styles.section}>
        {others.length ? 'Other accounts on this device' : 'No other accounts'}
      </Text>
      {others.map((a) => (
        <View key={a.userId} style={styles.row} testID={`accounts-row-${a.userId}`}>
          <Avatar url={a.avatarUrl} size={36} name={accountLabel(a)} />
          <TouchableOpacity
            style={styles.rowMain}
            onPress={() => open(a)}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${accountLabel(a)}`}
            testID={`accounts-switch-${a.userId}`}
          >
            <Text style={[styles.name, a.status === 'signed_out' && styles.muted]}>
              {busy === a.userId ? `${accountLabel(a)}…` : accountLabel(a)}
            </Text>
            <Text style={[styles.sub, a.status === 'signed_out' && styles.signedOut]}>
              {accountSubLabel(a)}
            </Text>
          </TouchableOpacity>
          {confirm === a.userId ? (
            <View style={styles.confirm} testID={`accounts-confirm-${a.userId}`}>
              <Text style={styles.sub}>Remove from this device?</Text>
              <TouchableOpacity
                onPress={async () => {
                  setConfirm(null);
                  setBusy(a.userId);
                  await signOutAccount(a.userId);
                  setBusy(null);
                  setNotice(`Signed out ${accountLabel(a)}`);
                }}
                testID={`accounts-signout-yes-${a.userId}`}
              >
                <Text style={styles.danger}>Sign out</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setConfirm(null)}
                testID={`accounts-signout-no-${a.userId}`}
              >
                <Text style={styles.link}>Keep</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setConfirm(a.userId)}
              disabled={!!busy}
              testID={`accounts-signout-${a.userId}`}
            >
              <Text style={styles.link}>Sign out</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      {notice ? (
        <Text style={styles.notice} testID="accounts-notice">
          {notice}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          title="Add account"
          onPress={() => router.push('/auth?add=1' as never)}
          disabled={!!busy}
          testID="accounts-add"
        />
        {user ? (
          <Button
            title="Continue as guest"
            variant="outline"
            onPress={async () => {
              setBusy('guest');
              await continueAsGuest();
              setBusy(null);
              router.replace('/search');
            }}
            disabled={!!busy}
            testID="accounts-guest"
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.lg, backgroundColor: theme.colors.background, flexGrow: 1 },
  section: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  current: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  rowMain: { flex: 1, minWidth: 0 },
  name: { ...theme.typography.body, fontWeight: '700' },
  sub: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 2 },
  muted: { color: theme.colors.text.secondary },
  signedOut: { color: theme.colors.danger },
  link: { ...theme.typography.bodySmall, color: theme.colors.primary, fontWeight: '600' },
  danger: { ...theme.typography.bodySmall, color: theme.colors.danger, fontWeight: '700' },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  notice: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginVertical: theme.spacing.sm,
  },
  actions: { gap: theme.spacing.sm, marginTop: theme.spacing.lg },
});
