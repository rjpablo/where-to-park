import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { useAuthStore } from '../src/stores/authStore';
import { supabase } from '../src/lib/supabase';
import { loadMyMemberships, type Membership } from '../src/lib/operatorAccess';
import { theme } from '../src/lib/theme';

type NavApp = 'google_maps' | 'waze' | 'default';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut, initialize } = useAuthStore();
  const [navApp, setNavApp] = React.useState<NavApp>('default');
  const [navNotice, setNavNotice] = React.useState<string | null>(null);
  const [memberships, setMemberships] = React.useState<Membership[]>([]);
  const [listingBusy, setListingBusy] = React.useState(false);

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    if (user?.preferred_nav_app) setNavApp(user.preferred_nav_app);
  }, [user?.preferred_nav_app]);

  React.useEffect(() => {
    if (!user) {
      setMemberships([]);
      return;
    }
    loadMyMemberships(user.id)
      .then(setMemberships)
      .catch(() => setMemberships([]));
  }, [user]);

  const hasMembership = memberships.length > 0;
  const isOperatorAccount = user?.account_type === 'operator' || hasMembership || !!user?.is_admin;
  const showDriverListCta = !!user && !hasMembership && !user.is_admin;

  const startListing = async () => {
    if (!user) return;
    setListingBusy(true);
    try {
      if (user.account_type !== 'operator') {
        const { error } = await supabase
          .from('profiles')
          .update({ account_type: 'operator' })
          .eq('id', user.id);
        if (error) throw error;
        await initialize();
      }
      router.push('/operator/onboarding');
    } catch (err: any) {
      setNavNotice(err.message || 'Could not start listing');
    } finally {
      setListingBusy(false);
    }
  };

  const saveNav = async (app: NavApp) => {
    if (!user) return;
    setNavApp(app);
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_nav_app: app })
      .eq('id', user.id);
    setNavNotice(error ? error.message : 'Preferred maps app saved');
    await initialize();
  };

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

      <Text style={styles.section}>Preferred maps app</Text>
      <View style={styles.row}>
        <Button
          title="Google Maps"
          size="small"
          variant={navApp === 'google_maps' ? 'primary' : 'outline'}
          onPress={() => saveNav('google_maps')}
          testID="pref-nav-google"
        />
        <Button
          title="Waze"
          size="small"
          variant={navApp === 'waze' ? 'primary' : 'outline'}
          onPress={() => saveNav('waze')}
          testID="pref-nav-waze"
        />
        <Button
          title="Default"
          size="small"
          variant={navApp === 'default' ? 'primary' : 'outline'}
          onPress={() => saveNav('default')}
          testID="pref-nav-default"
        />
      </View>
      {navNotice ? (
        <Text style={styles.notice} testID="pref-nav-saved">
          {navNotice}
        </Text>
      ) : null}

      {isOperatorAccount ? (
        <Button
          title="My listings"
          onPress={() => router.push('/operator/listings')}
          testID="profile-listings"
        />
      ) : null}
      {showDriverListCta ? (
        <Button
          title="List your parking space"
          onPress={startListing}
          loading={listingBusy}
          testID="profile-list-space"
        />
      ) : null}
      <Button
        title="Notifications"
        onPress={() => router.push('/notifications')}
        testID="profile-notifications"
      />
      <Button title="Saved vehicles" onPress={() => router.push('/vehicles')} />
      {isOperatorAccount ? (
        <Button title="Messages" variant="outline" onPress={() => router.push('/operator/inbox')} />
      ) : null}
      {user.is_admin ? (
        <Button
          title="Verify listings"
          onPress={() => router.push('/admin/verify')}
          testID="profile-verify"
        />
      ) : null}
      {user.is_admin ? (
        <Button title="Moderation queue" onPress={() => router.push('/admin/reports')} />
      ) : null}
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
  section: { ...theme.typography.bodySmall, fontWeight: '600', marginTop: theme.spacing.sm },
  row: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
  notice: { ...theme.typography.bodySmall, color: theme.colors.success },
});
