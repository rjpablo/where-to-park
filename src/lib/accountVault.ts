// Where saved accounts live on the device:
// - the list (names, phones; no secrets) in AsyncStorage (ACCOUNTS_INDEX_KEY);
// - each account's Supabase session tokens in expo-secure-store on Android/iOS
//   (Keystore/Keychain). Web has no secure store: the best available is the same
//   localStorage supabase-js already uses for the current session.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  ACCOUNTS_INDEX_KEY,
  markSignedOut,
  parseAccounts,
  removeAccount,
  tokenKey,
  upsertAccount,
  type SavedAccount,
} from './accounts';

export type SavedTokens = { access_token: string; refresh_token: string };

const native = Platform.OS !== 'web';

export async function readAccounts(): Promise<SavedAccount[]> {
  return parseAccounts(await AsyncStorage.getItem(ACCOUNTS_INDEX_KEY));
}

async function writeAccounts(list: SavedAccount[]) {
  await AsyncStorage.setItem(ACCOUNTS_INDEX_KEY, JSON.stringify(list));
}

// Serialize index writes so concurrent updates don't drop entries.
let chain: Promise<unknown> = Promise.resolve();
function update(fn: (list: SavedAccount[]) => SavedAccount[]): Promise<SavedAccount[]> {
  const run = chain.then(async () => {
    const next = fn(await readAccounts());
    await writeAccounts(next);
    return next;
  });
  chain = run.catch(() => {});
  return run;
}

export function saveAccountInfo(a: Parameters<typeof upsertAccount>[1]) {
  return update((list) => upsertAccount(list, a));
}

export async function saveTokens(userId: string, t: SavedTokens): Promise<void> {
  if (!t.refresh_token) return;
  const value = JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token });
  if (native) await SecureStore.setItemAsync(tokenKey(userId), value);
  else await AsyncStorage.setItem(tokenKey(userId), value);
}

export async function readTokens(userId: string): Promise<SavedTokens | null> {
  try {
    const raw = native
      ? await SecureStore.getItemAsync(tokenKey(userId))
      : await AsyncStorage.getItem(tokenKey(userId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v?.refresh_token
      ? { access_token: v.access_token || '', refresh_token: v.refresh_token }
      : null;
  } catch {
    return null;
  }
}

async function deleteTokens(userId: string) {
  if (native) await SecureStore.deleteItemAsync(tokenKey(userId));
  else await AsyncStorage.removeItem(tokenKey(userId));
}

/** Its saved session stopped working: keep it in the list as 'Signed out', drop the tokens. */
export async function markAccountSignedOut(userId: string) {
  await deleteTokens(userId);
  return update((list) => markSignedOut(list, userId));
}

/** Remove an account from this device entirely. */
export async function forgetAccount(userId: string) {
  await deleteTokens(userId);
  return update((list) => removeAccount(list, userId));
}
