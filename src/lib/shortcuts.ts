// Location shortcuts (rj): quick links to listing details, shown in the sidebar
// (first 3) and on the Shortcuts screen (all, in the user's order).

export type Shortcut = {
  locationId: string;
  name: string | null;
  /** false when the listing was deleted or is no longer visible. */
  available: boolean;
};

export const SIDEBAR_SHORTCUT_LIMIT = 3;
export const GUEST_SHORTCUTS_KEY = 'wtp-shortcuts';

/** New shortcuts go to the bottom; an existing one keeps its place. */
export function appendShortcut(list: Shortcut[], item: Shortcut): Shortcut[] {
  if (list.some((s) => s.locationId === item.locationId)) return list;
  return [...list, item];
}

export function removeShortcut(list: Shortcut[], locationId: string): Shortcut[] {
  return list.filter((s) => s.locationId !== locationId);
}

/** Move one item from index `from` to index `to` (clamped). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const t = Math.max(0, Math.min(list.length - 1, to));
  if (t === from) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(t, 0, it);
  return next;
}

/** Index a dragged row lands on after moving dy pixels (rows of rowHeight). */
export function dragTargetIndex(
  start: number,
  dy: number,
  rowHeight: number,
  count: number
): number {
  if (count <= 0 || rowHeight <= 0) return start;
  return Math.max(0, Math.min(count - 1, start + Math.round(dy / rowHeight)));
}

export function sidebarShortcuts(list: Shortcut[]): Shortcut[] {
  return list.slice(0, SIDEBAR_SHORTCUT_LIMIT);
}

export function shortcutLabel(s: Shortcut): string {
  if (!s.available)
    return s.name ? `${s.name} (no longer available)` : 'Listing no longer available';
  return s.name || 'Listing';
}

/** Guest storage: [{ locationId, name }], tolerant of bad data. */
export function parseGuestShortcuts(
  raw: string | null
): { locationId: string; name: string | null }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    return v
      .filter(
        (x) =>
          x && typeof x.locationId === 'string' && !seen.has(x.locationId) && seen.add(x.locationId)
      )
      .map((x) => ({ locationId: x.locationId, name: typeof x.name === 'string' ? x.name : null }));
  } catch {
    return [];
  }
}

/** Device key remembering which guest set was already offered (Add or Don't add). */
export const GUEST_SHORTCUTS_ASKED_KEY = 'wtp-shortcuts-asked';

/** Order-independent fingerprint of a set of listing ids ('' for none). */
export function shortcutSetKey(ids: string[]): string {
  return [...new Set(ids)].sort().join(',');
}

/** Device shortcuts to append to the account, in device order, skipping ones it has. */
export function shortcutsToMerge(accountIds: string[], deviceIds: string[]): string[] {
  const have = new Set(accountIds);
  const out: string[] = [];
  for (const id of deviceIds) {
    if (!have.has(id)) {
      have.add(id);
      out.push(id);
    }
  }
  return out;
}
