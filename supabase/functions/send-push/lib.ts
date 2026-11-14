// Pure helpers for the send-push Edge Function (no Deno / network APIs here so Node's
// test runner can check them: supabase/functions/send-push/lib.test.ts).

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo accepts at most 100 messages / receipt ids per request. */
export const EXPO_BATCH = 100;
/** Android channel the app creates (src/lib/push.ts). */
export const ANDROID_CHANNEL_ID = 'default';

export type NotificationRow = {
  /** null for a direct push that has no notifications row (chat messages, 0081). */
  id: string | null;
  recipient_id: string;
  type: string;
  title: string;
  body?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  data?: Record<string, unknown> | null;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body?: string;
  data: Record<string, unknown>;
  sound: 'default';
  channelId: string;
  priority: 'high';
};

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type ExpoReceipt =
  { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

/** What a tap needs to deep-link: the row's type and ref plus its own data. */
export function pushData(n: NotificationRow): Record<string, unknown> {
  return {
    ...(n.data && typeof n.data === 'object' ? n.data : {}),
    ...(n.id ? { notification_id: n.id } : {}),
    type: n.type,
    ref_type: n.ref_type ?? null,
    ref_id: n.ref_id ?? null,
  };
}

export function buildMessages(n: NotificationRow, tokens: string[]): ExpoMessage[] {
  const data = pushData(n);
  const uniq = [...new Set(tokens.filter((t) => typeof t === 'string' && t.trim()))];
  return uniq.map((to) => ({
    to,
    title: n.title,
    ...(n.body ? { body: n.body } : {}),
    data,
    sound: 'default',
    channelId: ANDROID_CHANNEL_ID,
    priority: 'high',
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Types that are pushed without a notifications row (0081: new chat messages). */
export const DIRECT_PUSH_TYPES = new Set(['chat_message']);

/**
 * A direct push from Postgres (`{ push: {...} }`, no notifications row). Returns the row
 * to send, or null when the payload is not a valid direct push.
 */
export function directPushRow(p: unknown): NotificationRow | null {
  if (!p || typeof p !== 'object') return null;
  const v = p as Record<string, unknown>;
  if (typeof v.recipient_id !== 'string' || !UUID.test(v.recipient_id)) return null;
  if (typeof v.type !== 'string' || !DIRECT_PUSH_TYPES.has(v.type)) return null;
  if (typeof v.title !== 'string' || !v.title.trim()) return null;
  return {
    id: null,
    recipient_id: v.recipient_id,
    type: v.type,
    title: v.title.slice(0, 200),
    body: typeof v.body === 'string' ? v.body.slice(0, 300) : null,
    ref_type: typeof v.ref_type === 'string' ? v.ref_type : null,
    ref_id: typeof v.ref_id === 'string' ? v.ref_id : null,
    data: v.data && typeof v.data === 'object' ? (v.data as Record<string, unknown>) : null,
  };
}

export function chunk<T>(items: T[], size = EXPO_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const DEAD = 'DeviceNotRegistered';

/**
 * Tickets come back in the same order as the messages sent. Returns the tokens to delete
 * now (DeviceNotRegistered) and the ok tickets to check for a receipt later.
 */
export function readTickets(
  messages: Pick<ExpoMessage, 'to'>[],
  tickets: ExpoTicket[]
): { deadTokens: string[]; pending: { ticket_id: string; token: string }[] } {
  const deadTokens: string[] = [];
  const pending: { ticket_id: string; token: string }[] = [];
  tickets.forEach((t, i) => {
    const token = messages[i]?.to;
    if (!token || !t) return;
    if (t.status === 'ok' && t.id) pending.push({ ticket_id: t.id, token });
    else if (t.status === 'error' && t.details?.error === DEAD) deadTokens.push(token);
  });
  return { deadTokens: [...new Set(deadTokens)], pending };
}

/** Receipts keyed by ticket id: tokens Expo says are no longer registered. */
export function deadTokensFromReceipts(
  receipts: Record<string, ExpoReceipt>,
  ticketToken: Record<string, string>
): string[] {
  const dead = new Set<string>();
  for (const [ticketId, r] of Object.entries(receipts || {})) {
    if (r?.status === 'error' && r.details?.error === DEAD && ticketToken[ticketId]) {
      dead.add(ticketToken[ticketId]);
    }
  }
  return [...dead];
}

/** Constant-time string compare for the webhook secret. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
