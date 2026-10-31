// What the delete_location RPC returns, and the words shown for each outcome.

export type DeleteListingResult =
  | { success: true }
  | {
      error: 'has_active';
      active_sessions: number;
      active_reservations: number;
    }
  | { error: 'not_found' | 'forbidden' | 'not_signed_in' | string };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The message shown when the listing can't be deleted yet. */
export function deleteBlockedMessage(sessions: number, reservations: number): string {
  const parts: string[] = [];
  if (sessions > 0)
    parts.push(plural(sessions, 'active parking session', 'active parking sessions'));
  if (reservations > 0)
    parts.push(plural(reservations, 'active reservation', 'active reservations'));
  const what = parts.length ? parts.join(' and ') : 'active sessions or reservations';
  return (
    `This listing still has ${what}. ` +
    'End every active session and cancel every active reservation first, then try again.'
  );
}

/** Turn the RPC result (or a request error) into what the screen should do. */
export function deleteOutcome(
  data: unknown,
  requestError?: { message?: string } | null
):
  | { kind: 'deleted' }
  | { kind: 'blocked'; sessions: number; reservations: number; message: string }
  | { kind: 'error'; message: string } {
  if (requestError) {
    return { kind: 'error', message: requestError.message || 'Could not delete the listing' };
  }
  const r = (data || {}) as Record<string, unknown>;
  if (r.success === true) return { kind: 'deleted' };
  if (r.error === 'has_active') {
    const sessions = Number(r.active_sessions) || 0;
    const reservations = Number(r.active_reservations) || 0;
    return {
      kind: 'blocked',
      sessions,
      reservations,
      message: deleteBlockedMessage(sessions, reservations),
    };
  }
  if (r.error === 'forbidden') {
    return { kind: 'error', message: 'Only the listing owner can delete this listing.' };
  }
  if (r.error === 'not_found') {
    return { kind: 'error', message: 'This listing was not found. It may already be deleted.' };
  }
  if (r.error === 'not_signed_in') {
    return { kind: 'error', message: 'Sign in again to delete this listing.' };
  }
  return { kind: 'error', message: String(r.error || 'Could not delete the listing') };
}

/** Only the operator's owner may delete a listing (managers and staff can't). */
export function canDeleteListing(role: string | null | undefined): boolean {
  return role === 'owner';
}
