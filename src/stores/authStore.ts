import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/supabase';

interface AuthState {
  user: Profile | null;
  loading: boolean;
  /** True once the persisted session has been restored (or found missing). */
  initialized: boolean;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<{ isNew: boolean }>;
  completeProfile: (displayName: string, accountType: 'driver' | 'operator') => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,

  initialize: async () => {
    if (!authListenerAttached) {
      authListenerAttached = true;
      // Keep the store in sync with token refreshes and sign-outs (including a
      // refresh token that was revoked or expired while the app was closed).
      supabase.auth.onAuthStateChange((event, session) => {
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
              if (profile) set({ user: profile });
            });
          }, 0);
        }
      });
    }
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
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
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      });
      if (error) throw error;
      if (!data.user) throw new Error('No session');
      const profile = await loadProfile(data.user.id);
      set({ user: profile });
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

  completeProfile: async (displayName, accountType) => {
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.user) set({ user: await loadProfile(data.user.id) });
  },

  signInWithGoogle: async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) throw error;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null });
  },
}));
