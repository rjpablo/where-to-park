import { create } from 'zustand';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/supabase';
import { getSupabaseUrl } from '../lib/env';
import type { SavedAccount } from '../lib/accounts';
import {
  forgetAccount,
  markAccountSignedOut,
  readAccounts,
  readTokens,
  saveAccountInfo,
  saveTokens,
} from '../lib/accountVault';
import { finishOAuthRedirect, startGoogleOAuth } from '../lib/googleAuth';
import type { OAuthIntent } from '../lib/oauthCallback';
import { useSidebarStore } from './sidebarStore';
import { useShortcutsStore } from './shortcutsStore';

interface AuthState {
  user: Profile | null;
  loading: boolean;
  /** True once the persisted session has been restored (or found missing). */
  initialized: boolean;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<{ isNew: boolean }>;
  /** accountType defaults to 'driver' (onboarding no longer asks; rj). */
  completeProfile: (displayName: string, accountType?: 'driver' | 'operator') => Promise<void>;
  /** Email + password sign-in (also from Add account). */
  signIn: (email: string, password: string) => Promise<{ isNew: boolean }>;
  /** Email + password sign-up; needsConfirmation when the project requires a confirmation mail. */
  signUp: (
    email: string,
    password: string
  ) => Promise<{ isNew: boolean; needsConfirmation?: boolean }>;
  /**
   * Google sign-in (also from Add account) or linking Google to the current account.
   * Web navigates away ('redirected'; /oauth-callback finishes). Native returns when done.
   */
  signInWithGoogle: (
    intent?: OAuthIntent
  ) => Promise<{ status: 'redirected' | 'cancelled' | 'done'; isNew?: boolean }>;
  /** Finish a Google redirect (/oauth-callback): exchange, save the account, load the profile. */
  completeOAuth: (url: string) => Promise<{ isNew: boolean } | null>;
  /** Sign out of the CURRENT account: revokes its session and removes it from the device. */
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
  /** Accounts saved on this device (account switching). */
  accounts: SavedAccount[];
  loadAccounts: () => Promise<void>;
  /** Switch instantly to a saved account; 'signed_out' when its session no longer works. */
  switchAccount: (userId: string) => Promise<{ error?: 'signed_out' | 'failed' }>;
  /** Guest mode without removing saved accounts. */
  continueAsGuest: () => Promise<void>;
  /** Remove another (not current) account from the device and revoke its session. */
  signOutAccount: (userId: string) => Promise<void>;
}

function digits(value: string | null | undefined): string {
  return String(value || '').replace(/[^0-9]/g, '');
}

export function isNewOnboardingProfile(
  profile: Profile | null,
  phone: string,
  userMetadata?: Record<string, unknown> | null
): boolean {
  if (userMetadata?.is_new) return true;
  // 0069: new accounts (Google or phone) stay 'not onboarded' until onboarding is saved.
  if (profile && (profile as { onboarded?: boolean }).onboarded === false) return true;
  const name = (profile?.display_name || '').trim();
  if (!name || name === 'New user') return true;
  const phoneDigits = digits(phone) || digits(profile?.phone);
  if (phoneDigits && digits(name) === phoneDigits) return true;
  if (profile?.phone && name === profile.phone) return true;
  return false;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data;
}

let authListenerAttached = false;
/** User id of the session the client holds right now (guards late profile loads). */
let currentAuthUserId: string | null = null;
const supabaseUserIs = (id: string) => currentAuthUserId === id;

/** Remember the current session's tokens for switching back later (never logged). */
function rememberSession(
  session: { user?: { id: string } | null; access_token?: string; refresh_token?: string } | null
) {
  if (!session?.user?.id || !session.refresh_token) return;
  saveTokens(session.user.id, {
    access_token: session.access_token || '',
    refresh_token: session.refresh_token,
  }).catch(() => {});
}

async function saveCurrentSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user && session.refresh_token) {
    await saveTokens(session.user.id, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  }
}

/** Drop the current session from this client only (no server call, so it stays usable). */
async function clearLocalSession() {
  const auth = supabase.auth as any;
  if (typeof auth._removeSession === 'function') {
    await auth._removeSession();
    return;
  }
  await supabase.auth.signOut({ scope: 'local' });
}

/** Make a fresh session the current account (password sign-in / sign-up); true = onboarding. */
async function adoptSession(session: {
  user: { id: string; user_metadata?: Record<string, unknown> | null };
  access_token?: string;
  refresh_token?: string;
}): Promise<boolean> {
  currentAuthUserId = session.user.id;
  rememberSession(session);
  const profile = await loadProfile(session.user.id);
  useAuthStore.setState({ user: profile });
  resetPerAccount(session.user.id);
  return isNewOnboardingProfile(profile, '', session.user.user_metadata ?? null);
}

/** Per-account state that must not leak across accounts. */
function resetPerAccount(userId: string | null) {
  useSidebarStore.getState().reset();
  useSidebarStore.getState().refresh();
  useShortcutsStore.setState({ items: [], loaded: false, userId });
  useShortcutsStore.getState().load(userId);
}

/** Best-effort server revoke of a saved session that isn't the current one. */
async function revokeSaved(refreshToken: string) {
  const base = getSupabaseUrl();
  const key =
    Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!base || !key) return;
  try {
    const r = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!r.ok) return;
    const t = await r.json();
    if (!t?.access_token) return;
    await fetch(`${base}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${t.access_token}` },
    });
  } catch {
    // Offline: the tokens are deleted from the device anyway.
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,
  accounts: [],

  initialize: async () => {
    if (!authListenerAttached) {
      authListenerAttached = true;
      // Keep the store in sync with token refreshes and sign-outs (including a
      // refresh token that was revoked or expired while the app was closed).
      supabase.auth.onAuthStateChange((event, session) => {
        currentAuthUserId = session?.user?.id ?? null;
        if (session?.user) rememberSession(session);
        if (event === 'SIGNED_OUT' || !session?.user) {
          set({ user: null });
          return;
        }
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          const current = get().user;
          if (current?.id === session.user.id && event === 'SIGNED_IN') return;
          // Defer the query: supabase-js warns against awaiting inside this callback.
          setTimeout(() => {
            loadProfile(session.user.id).then((profile) => {
              if (profile && supabaseUserIs(profile.id)) set({ user: profile });
            });
          }, 0);
        }
      });
    }
    get().loadAccounts();
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      currentAuthUserId = session?.user?.id ?? null;
      if (session?.user) {
        rememberSession(session);
        const profile = await loadProfile(session.user.id);
        // Keep a previously loaded profile if the network is briefly unavailable.
        set({ user: profile ?? get().user, loading: false, initialized: true });
      } else {
        set({ user: null, loading: false, initialized: true });
      }
    } catch (error) {
      console.error('Initialize error:', error);
      set({ loading: false, initialized: true });
    }
  },

  requestOtp: async (phone: string) => {
    set({ loading: true });
    try {
      // Hosted GoTrue phone OTP, or the local proxy /auth/v1/otp stub.
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) throw error;
    } finally {
      set({ loading: false });
    }
  },

  verifyOtp: async (phone: string, code: string) => {
    set({ loading: true });
    try {
      // Adding another account: keep the current one's session for switching back.
      await saveCurrentSession().catch(() => {});
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      });
      if (error) throw error;
      if (!data.user) throw new Error('No session');
      currentAuthUserId = data.user.id;
      if (data.session) rememberSession(data.session);
      const profile = await loadProfile(data.user.id);
      set({ user: profile });
      resetPerAccount(data.user.id);
      const isNew = isNewOnboardingProfile(
        profile,
        phone,
        data.user.user_metadata as Record<string, unknown> | null
      );
      return { isNew };
    } finally {
      set({ loading: false });
    }
  },

  completeProfile: async (displayName, accountType = 'driver') => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.rpc('complete_profile', {
        p_display_name: displayName,
        p_account_type: accountType,
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) set({ user: await loadProfile(session.user.id) });
    } finally {
      set({ loading: false });
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true });
    try {
      // Adding another account: keep the current one's session for switching back.
      await saveCurrentSession().catch(() => {});
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user || !data.session) throw new Error('No session');
      return { isNew: await adoptSession(data.session) };
    } finally {
      set({ loading: false });
    }
  },

  signUp: async (email: string, password: string) => {
    set({ loading: true });
    try {
      await saveCurrentSession().catch(() => {});
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      // Email confirmation on (prod later): no session until the mail link is opened.
      if (!data.session) return { isNew: true, needsConfirmation: true };
      // Supabase answers an existing, confirmed email with a fake user that has no
      // identities (no session either, so handled above); a session means a new account.
      return { isNew: await adoptSession(data.session) };
    } finally {
      set({ loading: false });
    }
  },

  signInWithGoogle: async (intent = 'signin') => {
    // Adding another account: keep the current one's session for switching back.
    if (intent === 'signin') await saveCurrentSession().catch(() => {});
    const res = await startGoogleOAuth(intent);
    if (res.kind === 'redirected') return { status: 'redirected' };
    if (res.kind === 'cancelled') return { status: 'cancelled' };
    const done = await get().completeOAuth(res.url);
    return { status: 'done', isNew: done?.isNew };
  },

  completeOAuth: async (url) => {
    set({ loading: true });
    try {
      const session = await finishOAuthRedirect(url);
      if (!session?.user) return null;
      currentAuthUserId = session.user.id;
      rememberSession(session);
      const profile = await loadProfile(session.user.id);
      set({ user: profile });
      resetPerAccount(session.user.id);
      return {
        isNew: isNewOnboardingProfile(
          profile,
          '',
          session.user.user_metadata as Record<string, unknown> | null
        ),
      };
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    const id = get().user?.id ?? currentAuthUserId;
    await supabase.auth.signOut({ scope: 'local' });
    currentAuthUserId = null;
    if (id) await forgetAccount(id);
    set({ user: null, accounts: await readAccounts() });
    resetPerAccount(null);
  },

  loadAccounts: async () => {
    set({ accounts: await readAccounts() });
  },

  switchAccount: async (userId) => {
    const prevId = get().user?.id ?? null;
    if (prevId === userId) return {};
    await saveCurrentSession().catch(() => {});
    const prevTokens = prevId ? await readTokens(prevId) : null;
    const tokens = await readTokens(userId);
    const fail = async (code: 'signed_out' | 'failed') => {
      if (code === 'signed_out') await markAccountSignedOut(userId);
      // Put the previous account (or guest mode) back.
      if (prevTokens) {
        const back = await supabase.auth.setSession(prevTokens);
        if (back.error) await clearLocalSession();
      } else {
        await clearLocalSession();
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      currentAuthUserId = session?.user?.id ?? null;
      const profile = session?.user ? await loadProfile(session.user.id) : null;
      set({ user: profile, accounts: await readAccounts() });
      resetPerAccount(profile?.id ?? null);
      return { error: code };
    };
    if (!tokens) return fail('signed_out');
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.setSession(tokens);
      if (error || !data.session?.user || data.session.user.id !== userId) {
        const msg = String(error?.message || '');
        // Network trouble: don't drop the account, just report it.
        return fail(/fetch|network/i.test(msg) ? 'failed' : 'signed_out');
      }
      currentAuthUserId = userId;
      rememberSession(data.session);
      const profile = await loadProfile(userId);
      set({ user: profile });
      resetPerAccount(userId);
      return {};
    } finally {
      set({ loading: false });
    }
  },

  continueAsGuest: async () => {
    await saveCurrentSession().catch(() => {});
    await clearLocalSession();
    currentAuthUserId = null;
    set({ user: null });
    resetPerAccount(null);
  },

  signOutAccount: async (userId) => {
    if (userId === get().user?.id) return get().signOut();
    const tokens = await readTokens(userId);
    await forgetAccount(userId);
    set({ accounts: await readAccounts() });
    if (tokens?.refresh_token) await revokeSaved(tokens.refresh_token);
  },
}));

// Keep the saved-accounts list in step with whoever is signed in (name, phone, email, admin).
useAuthStore.subscribe((state, prev) => {
  const u = state.user;
  if (!u || u === prev.user) return;
  supabase.auth
    .getSession()
    .then(({ data }) =>
      saveAccountInfo({
        userId: u.id,
        displayName: u.display_name,
        phone: u.phone,
        email: data.session?.user?.id === u.id ? (data.session.user.email ?? null) : undefined,
        isAdmin: !!u.is_admin,
      })
    )
    .then((accounts) => useAuthStore.setState({ accounts }))
    .catch(() => {});
});
