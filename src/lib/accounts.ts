// Saved accounts on this device (account switching). Pure list helpers; the tokens
// themselves live in src/lib/accountVault.ts (SecureStore on native).

export const ACCOUNTS_INDEX_KEY = 'wtp-accounts';

export type SavedAccount = {
  userId: string;
  displayName: string | null;
  phone: string | null;
  isAdmin: boolean;
  /** 'signed_out': its saved session no longer works; sign in again to use it. */
  status: 'active' | 'signed_out';
  addedAt: number;
};

export function parseAccounts(raw: string | null | undefined): SavedAccount[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: SavedAccount[] = [];
    for (const a of v) {
      if (!a || typeof a.userId !== 'string' || !a.userId || seen.has(a.userId)) continue;
      seen.add(a.userId);
      out.push({
        userId: a.userId,
        displayName: typeof a.displayName === 'string' ? a.displayName : null,
        phone: typeof a.phone === 'string' ? a.phone : null,
        isAdmin: a.isAdmin === true,
        status: a.status === 'signed_out' ? 'signed_out' : 'active',
        addedAt: typeof a.addedAt === 'number' ? a.addedAt : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Add or refresh an account (keeps its place in the list; signed in again = active). */
export function upsertAccount(
  list: SavedAccount[],
  a: { userId: string; displayName?: string | null; phone?: string | null; isAdmin?: boolean },
  now = Date.now()
): SavedAccount[] {
  const i = list.findIndex((x) => x.userId === a.userId);
  const next: SavedAccount = {
    userId: a.userId,
    displayName: a.displayName ?? (i >= 0 ? list[i].displayName : null),
    phone: a.phone ?? (i >= 0 ? list[i].phone : null),
    isAdmin: a.isAdmin ?? (i >= 0 ? list[i].isAdmin : false),
    status: 'active',
    addedAt: i >= 0 ? list[i].addedAt : now,
  };
  if (i < 0) return [...list, next];
  const copy = [...list];
  copy[i] = next;
  return copy;
}

export function removeAccount(list: SavedAccount[], userId: string): SavedAccount[] {
  return list.filter((a) => a.userId !== userId);
}

export function markSignedOut(list: SavedAccount[], userId: string): SavedAccount[] {
  return list.map((a) => (a.userId === userId ? { ...a, status: 'signed_out' } : a));
}

/** Saved accounts other than the current one, in the order they were added. */
export function otherAccounts(list: SavedAccount[], currentId: string | null): SavedAccount[] {
  return list.filter((a) => a.userId !== currentId);
}

export function accountLabel(a: { displayName?: string | null; phone?: string | null }): string {
  const name = (a.displayName || '').trim();
  return name || a.phone || 'Account';
}

/** Second line under an account: phone, admin, or 'Signed out'. */
export function accountSubLabel(a: SavedAccount): string {
  if (a.status === 'signed_out') return 'Signed out · tap to sign in again';
  return [a.isAdmin ? 'Admin' : null, a.phone].filter(Boolean).join(' · ');
}

/** SecureStore keys allow [A-Za-z0-9._-]. */
export function tokenKey(userId: string): string {
  return `wtp-acct-${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** Per-account key for 'already asked about this device's guest shortcuts'. */
export function askedKeyFor(base: string, userId: string): string {
  return `${base}:${userId}`;
}
