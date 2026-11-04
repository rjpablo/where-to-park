// Inbox row helpers: unread state and the last-message preview.
// The unread rule mirrors the database's my_unread_messages(): a message is unread for me
// when read_at is empty, it isn't hidden or a system event, someone else sent it, and, when
// I'm on the operator side of the thread, the driver sent it.

export type InboxMessage = {
  thread_id: string;
  sender_id: string | null;
  kind: string;
  body: string | null;
  read_at: string | null;
  hidden?: boolean | null;
  created_at: string;
};

export function isUnreadFor(
  m: InboxMessage,
  thread: { driver_id: string },
  me: string | null | undefined
): boolean {
  if (!me || m.read_at || m.hidden || m.kind === 'system' || !m.sender_id) return false;
  if (m.sender_id === me) return false;
  return thread.driver_id === me || m.sender_id === thread.driver_id;
}

export function threadHasUnread(
  thread: { id: string; driver_id: string },
  messages: InboxMessage[],
  me: string | null | undefined
): boolean {
  return messages.some((m) => m.thread_id === thread.id && isUnreadFor(m, thread, me));
}

/** The newest message per thread (messages in any order). */
export function latestByThread(messages: InboxMessage[]): Record<string, InboxMessage> {
  const out: Record<string, InboxMessage> = {};
  for (const m of messages) {
    const cur = out[m.thread_id];
    if (!cur || m.created_at > cur.created_at) out[m.thread_id] = m;
  }
  return out;
}

/** One-line preview of a message for the inbox row. */
export function previewText(m: InboxMessage | undefined, me?: string | null): string {
  if (!m) return 'No messages yet';
  if (m.hidden) return 'Message hidden';
  const prefix = me && m.sender_id === me ? 'You: ' : '';
  if (m.kind === 'image') return `${prefix}📷 Photo`;
  const text = (m.body || '').replace(/\s+/g, ' ').trim();
  return prefix + (text || 'Message');
}
