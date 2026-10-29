import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/supabase';

interface AuthState {
  user: Profile | null;
  loading: boolean;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<{ isNew: boolean }>;
  completeProfile: (displayName: string, accountType: 'driver' | 'operator') => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,

  initialize: async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        set({ user: await loadProfile(session.user.id), loading: false });
      } else {
        set({ user: null, loading: false });
      }
    } catch (error) {
      console.error('Initialize error:', error);
      set({ loading: false });
    }
  },

  requestOtp: async (phone: string) => {
    set({ loading: true });
    try {
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
      const isNew = !!(data.user.user_metadata as any)?.is_new || profile?.display_name === phone;
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
