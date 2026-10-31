/**
 * Sidebar (drawer) model: which items a user sees, each item's count, and
 * whether the toggle's red attention badge is lit. Counts come from the
 * get_sidebar_counts RPC; which conditions light the badge is configured in the
 * attention_triggers table (database only, all enabled by default).
 */

export const ATTENTION_KEYS = [
  'unread_messages',
  'unread_notifications',
  'pending_verifications',
  'listing_reviewed',
  'profile_incomplete',
] as const;
export type AttentionKey = (typeof ATTENTION_KEYS)[number];

export type SidebarCounts = {
  signed_in: boolean;
  /** attention_triggers.enabled by key; a missing key counts as enabled. */
  triggers: Partial<Record<AttentionKey, boolean>>;
  unread_messages?: number;
  unread_notifications?: number;
  pending_verifications?: number;
  pending_reports?: number;
  listing_reviewed?: number;
  listings?: number;
  vehicles?: number;
  profile_incomplete?: number;
};

export const EMPTY_COUNTS: SidebarCounts = { signed_in: false, triggers: {} };

export function triggerEnabled(counts: SidebarCounts, key: AttentionKey): boolean {
  return counts.triggers?.[key] !== false;
}

/** Keys that currently need attention (count > 0 and the trigger is enabled). */
export function attentionReasons(counts: SidebarCounts): AttentionKey[] {
  if (!counts.signed_in) return [];
  return ATTENTION_KEYS.filter((key) => (counts[key] ?? 0) > 0 && triggerEnabled(counts, key));
}

export function needsAttention(counts: SidebarCounts): boolean {
  return attentionReasons(counts).length > 0;
}

export type SidebarItemKey =
  | 'sign_in'
  | 'profile'
  | 'messages'
  | 'notifications'
  | 'listings'
  | 'list_space'
  | 'vehicles'
  | 'verify'
  | 'moderation'
  | 'sign_out';

export type SidebarItem = {
  key: SidebarItemKey;
  label: string;
  /** Route to open; list_space and sign_out are actions instead. */
  route?: string;
  count: number;
  /** Count text ('' when nothing to show). */
  countLabel: string;
  /** Red pill when this count lights the badge, grey when it's informational. */
  alert: boolean;
  section: 'account' | 'admin';
};

export type SidebarUser = {
  isAdmin: boolean;
  /** Operator account, staff/owner membership, or admin. */
  hasWorkspace: boolean;
} | null;

export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
}

function item(
  key: SidebarItemKey,
  label: string,
  route: string | undefined,
  counts: SidebarCounts,
  countKey?: keyof SidebarCounts,
  attentionKey?: AttentionKey,
  section: SidebarItem['section'] = 'account'
): SidebarItem {
  const raw = countKey ? counts[countKey] : 0;
  const count = typeof raw === 'number' ? raw : 0;
  const alert = !!attentionKey && count > 0 && triggerEnabled(counts, attentionKey);
  const countLabel = key === 'profile' ? (count > 0 ? '!' : '') : formatCount(count);
  return { key, label, route, count, countLabel, alert, section };
}

/** Items in display order for the signed-in role (guests get Sign in only). */
export function buildSidebarItems(user: SidebarUser, counts: SidebarCounts): SidebarItem[] {
  if (!user) return [item('sign_in', 'Sign in', '/auth', counts)];
  const items: SidebarItem[] = [
    item('profile', 'My profile', '/profile', counts, 'profile_incomplete', 'profile_incomplete'),
    item('messages', 'Messages', '/operator/inbox', counts, 'unread_messages', 'unread_messages'),
    item(
      'notifications',
      'Notifications',
      '/notifications',
      counts,
      'unread_notifications',
      'unread_notifications'
    ),
  ];
  if (user.hasWorkspace) {
    // Unseen verify/reject outcomes win over the plain listing total.
    const reviewed = counts.listing_reviewed ?? 0;
    items.push(
      reviewed > 0
        ? item(
            'listings',
            'My listings',
            '/operator/listings',
            counts,
            'listing_reviewed',
            'listing_reviewed'
          )
        : item('listings', 'My listings', '/operator/listings', counts, 'listings')
    );
  } else {
    items.push(item('list_space', 'List your parking space', undefined, counts));
  }
  items.push(item('vehicles', 'Saved vehicles', '/vehicles', counts, 'vehicles'));
  if (user.isAdmin) {
    items.push(
      item(
        'verify',
        'Verify listings',
        '/admin/verify',
        counts,
        'pending_verifications',
        'pending_verifications',
        'admin'
      ),
      item(
        'moderation',
        'Moderation queue',
        '/admin/reports',
        counts,
        'pending_reports',
        undefined,
        'admin'
      )
    );
  }
  items.push(item('sign_out', 'Sign out', undefined, counts));
  return items;
}

/** Parse the RPC payload defensively (numbers may arrive as strings). */
export function parseSidebarCounts(data: unknown): SidebarCounts {
  if (!data || typeof data !== 'object') return EMPTY_COUNTS;
  const d = data as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  };
  const triggers: SidebarCounts['triggers'] = {};
  if (d.triggers && typeof d.triggers === 'object') {
    for (const key of ATTENTION_KEYS) {
      const v = (d.triggers as Record<string, unknown>)[key];
      if (typeof v === 'boolean') triggers[key] = v;
    }
  }
  return {
    signed_in: d.signed_in === true,
    triggers,
    unread_messages: num(d.unread_messages),
    unread_notifications: num(d.unread_notifications),
    pending_verifications: num(d.pending_verifications),
    pending_reports: num(d.pending_reports),
    listing_reviewed: num(d.listing_reviewed),
    listings: num(d.listings),
    vehicles: num(d.vehicles),
    profile_incomplete: num(d.profile_incomplete),
  };
}
