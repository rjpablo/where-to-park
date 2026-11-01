import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { useAuthStore } from '../src/stores/authStore';
import { supabase } from '../src/lib/supabase';
import { theme } from '../src/lib/theme';
import { FilterDropdown } from '../src/components/FilterDropdown';
import { NAV_APP_OPTIONS } from '../src/lib/navigation';
import { refreshSidebarCounts, useSidebarStore } from '../src/stores/sidebarStore';
import { useBottomInset } from '../src/hooks/useBottomInset';
import { PHONE_SIGN_IN_ENABLED } from '../src/lib/authConfig';

type NavApp = 'google_maps' | 'waze' | 'default';

export default function ProfileScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const { user, initialize, signInWithGoogle } = useAuthStore();
  // Sign-in methods (rj t146u): email + password, Phone, Google; Link Google uses manual linking.
  const params = useLocalSearchParams<{ googleLinked?: string }>();
  const [methods, setMethods] = React.useState<{ provider: string; email: string | null }[] | null>(
    null
  );
  const [linkBusy, setLinkBusy] = React.useState(false);
  const [linkNotice, setLinkNotice] = React.useState<string | null>(
    params.googleLinked ? 'Google linked: you can now sign in with Google' : null
  );
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const loadMethods = React.useCallback(async () => {
    const { data } = await supabase.auth.getUserIdentities();
    setMethods(
      (data?.identities || []).map((i) => ({
        provider: i.provider,
        email: (i.identity_data?.email as string | undefined) ?? null,
      }))
    );
  }, []);
  React.useEffect(() => {
    if (user?.id) loadMethods();
  }, [user?.id, loadMethods]);
  const google = methods?.find((m) => m.provider === 'google') ?? null;
  const emailMethod = methods?.find((m) => m.provider === 'email') ?? null;
  const linkGoogle = async () => {
    setLinkError(null);
    setLinkNotice(null);
    setLinkBusy(true);
    try {
      const res = await signInWithGoogle('link');
      if (res.status === 'done') {
        setLinkNotice('Google linked: you can now sign in with Google');
        await loadMethods();
      }
    } catch (e: any) {
      setLinkError(e?.message || 'Could not link Google');
    } finally {
      setLinkBusy(false);
    }
  };
  const [navApp, setNavApp] = React.useState<NavApp>('default');
  const [navNotice, setNavNotice] = React.useState<string | null>(null);
  const [name, setName] = React.useState(user?.display_name || '');
  const [nameNotice, setNameNotice] = React.useState<string | null>(null);
  const [nameBusy, setNameBusy] = React.useState(false);
  const incomplete = (useSidebarStore((s) => s.counts.profile_incomplete) ?? 0) > 0;

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    if (user?.preferred_nav_app) setNavApp(user.preferred_nav_app);
  }, [user?.preferred_nav_app]);

  React.useEffect(() => {
    setName(user?.display_name || '');
  }, [user?.display_name]);

  React.useEffect(() => {
    refreshSidebarCounts();
  }, [user?.id]);

  const saveName = async () => {
    if (!user) return;
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      setNameNotice('Enter your name');
      return;
    }
    setNameBusy(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed.slice(0, 60) })
      .eq('id', user.id);
    setNameBusy(false);
    setNameNotice(error ? error.message : 'Name saved');
    await initialize();
    refreshSidebarCounts();
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
      <View style={[styles.container, bottomInset]} testID="profile-guest">
        <Text style={styles.title}>Not signed in</Text>
        <Button title="Sign in with phone" onPress={() => router.push('/auth')} />
        <Button title="Keep browsing" variant="outline" onPress={() => router.replace('/search')} />
      </View>
    );
  }

  return (
    <View style={[styles.container, bottomInset]} testID="profile-ready">
      <Text style={styles.title}>{user.display_name}</Text>
      <Text style={styles.meta} testID="profile-account-type">
        Account type: {user.account_type || 'driver'}
      </Text>
      {user.phone ? <Text style={styles.meta}>Phone: {user.phone}</Text> : null}
      {user.is_admin ? <Text style={styles.meta}>Admin</Text> : null}

      <Text style={styles.section}>Your name</Text>
      {incomplete ? (
        <Text style={styles.warn} testID="profile-incomplete">
          Add your name so operators and drivers know who they are talking to.
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Display name"
          maxLength={60}
          autoCapitalize="words"
          testID="profile-name-input"
        />
        <Button
          title="Save"
          size="small"
          onPress={saveName}
          loading={nameBusy}
          testID="profile-name-save"
        />
      </View>
      {nameNotice ? (
        <Text style={styles.notice} testID="profile-name-notice">
          {nameNotice}
        </Text>
      ) : null}

      <Text style={styles.section}>Sign-in methods</Text>
      <View testID="profile-sign-in-methods">
        {emailMethod ? (
          <Text style={styles.meta} testID="profile-email-method">
            Email and password{emailMethod.email ? `: ${emailMethod.email}` : ''}
          </Text>
        ) : null}
        {user.phone ? (
          <Text style={styles.meta}>
            {PHONE_SIGN_IN_ENABLED
              ? 'Phone (code by SMS)'
              : `Phone: ${user.phone} (SMS sign-in is off for now)`}
          </Text>
        ) : null}
        {google ? (
          <Text style={styles.meta} testID="profile-google-linked">
            Google{google.email ? `: ${google.email}` : ''}
          </Text>
        ) : methods ? (
          <View style={styles.row}>
            <Button
              title="Link Google"
              variant="outline"
              size="small"
              onPress={linkGoogle}
              loading={linkBusy}
              testID="profile-link-google"
            />
          </View>
        ) : null}
      </View>
      {!google && methods ? (
        <Text style={styles.hint}>
          Link your Google account to sign in to this same account with Google.
        </Text>
      ) : null}
      {linkNotice ? (
        <Text style={styles.notice} testID="profile-link-notice">
          {linkNotice}
        </Text>
      ) : null}
      {linkError ? (
        <Text style={styles.warn} testID="profile-link-error">
          {linkError}
        </Text>
      ) : null}

      <Text style={styles.section}>Maps app for Navigate</Text>
      <View style={styles.row}>
        <FilterDropdown
          label="Maps app"
          value={navApp}
          options={NAV_APP_OPTIONS}
          onChange={(app) => saveNav(app ?? 'default')}
          highlightActive={false}
          testID="pref-nav"
        />
      </View>
      {navNotice ? (
        <Text style={styles.notice} testID="pref-nav-saved">
          {navNotice}
        </Text>
      ) : null}
      <Text style={styles.hint}>
        Messages, notifications, listings, vehicles and sign out are in the menu (☰) next to 'Find
        Parking'.
      </Text>
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
  warn: { ...theme.typography.bodySmall, color: theme.colors.danger },
  hint: { ...theme.typography.caption, color: theme.colors.text.tertiary },
  input: {
    ...theme.typography.body,
    flex: 1,
    minWidth: 160,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
  },
});
