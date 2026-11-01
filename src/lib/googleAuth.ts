import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  oauthRedirectFor,
  parseOAuthCallback,
  oauthErrorMessage,
  type OAuthIntent,
} from './oauthCallback';

// Web: a popup opened by expo-web-browser finishes here (harmless otherwise).
WebBrowser.maybeCompleteAuthSession();

const INTENT_KEY = 'wtp-oauth-intent';
/** Codes already being exchanged (the deep link can arrive twice on Android). */
const claimed = new Set<string>();
let nativePending = false;

export function oauthRedirectUri(): string {
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null;
  return oauthRedirectFor(Platform.OS, origin);
}

/** True while a native Google sign-in is waiting for the browser to come back. */
export function isNativeOAuthPending(): boolean {
  return nativePending;
}

export async function readOAuthIntent(): Promise<OAuthIntent> {
  const v = await AsyncStorage.getItem(INTENT_KEY).catch(() => null);
  return v === 'link' ? 'link' : 'signin';
}

/**
 * Starts Google sign-in (or linking Google to the signed-in account).
 * Web: full-page redirect to Google; /oauth-callback finishes it ('redirected').
 * Native: an auth browser session; returns the redirect URL to finish with
 * finishOAuthRedirect, or 'cancelled'.
 */
export async function startGoogleOAuth(
  intent: OAuthIntent
): Promise<{ kind: 'redirected' } | { kind: 'cancelled' } | { kind: 'url'; url: string }> {
  const redirectTo = oauthRedirectUri();
  const options = {
    redirectTo,
    skipBrowserRedirect: true,
    queryParams: { prompt: 'select_account' },
  };
  const { data, error } =
    intent === 'link'
      ? await supabase.auth.linkIdentity({ provider: 'google', options })
      : await supabase.auth.signInWithOAuth({ provider: 'google', options });
  if (error) throw new Error(oauthErrorMessage(error.name, error.message));
  if (!data?.url) throw new Error('Google sign-in failed');
  await AsyncStorage.setItem(INTENT_KEY, intent).catch(() => {});
  if (Platform.OS === 'web') {
    window.location.assign(data.url);
    return { kind: 'redirected' };
  }
  nativePending = true;
  try {
    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== 'success' || !res.url) return { kind: 'cancelled' };
    return { kind: 'url', url: res.url };
  } finally {
    nativePending = false;
  }
}

/**
 * Turns the redirect into a session (PKCE code exchange, or tokens from the hash).
 * Returns null when this code is already being handled elsewhere.
 */
export async function finishOAuthRedirect(url: string) {
  const cb = parseOAuthCallback(url);
  if (cb.error) throw new Error(oauthErrorMessage(cb.error, cb.errorDescription));
  if (cb.code) {
    if (claimed.has(cb.code)) return null;
    claimed.add(cb.code);
    const { data, error } = await supabase.auth.exchangeCodeForSession(cb.code);
    if (error) throw new Error(oauthErrorMessage(error.name, error.message));
    return data.session;
  }
  if (cb.accessToken && cb.refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: cb.accessToken,
      refresh_token: cb.refreshToken,
    });
    if (error) throw new Error(oauthErrorMessage(error.name, error.message));
    return data.session;
  }
  throw new Error('Google sign-in did not return to the app');
}
