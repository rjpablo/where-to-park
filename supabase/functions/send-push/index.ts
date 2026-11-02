// send-push (rj t173u): delivers a notifications row as a push through Expo -> FCM V1.
//
// Called only by Postgres (pg_net) from the notifications AFTER INSERT trigger and the
// `push-receipts` pg_cron job (migration 0072). Deployed with --no-verify-jwt; every call
// must carry the x-push-secret header matching the PUSH_WEBHOOK_SECRET function secret.
//
// POST { notification_id }   -> push the row to the recipient's tokens, set pushed_at
// POST { action: 'receipts' } -> read Expo receipts, drop DeviceNotRegistered tokens
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  EXPO_BATCH,
  EXPO_RECEIPTS_URL,
  EXPO_SEND_URL,
  buildMessages,
  chunk,
  deadTokensFromReceipts,
  readTickets,
  safeEqual,
  type ExpoReceipt,
  type ExpoTicket,
  type NotificationRow,
} from './lib.ts';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function expoPost(url: string, body: unknown): Promise<any> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  // Optional: only needed if "Enhanced push security" is turned on in Expo.
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`expo ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!safeEqual(req.headers.get('x-push-secret'), Deno.env.get('PUSH_WEBHOOK_SECRET'))) {
    return json(401, { error: 'unauthorized' });
  }

  let payload: { notification_id?: string; action?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } }
  );

  if (payload.action === 'receipts') {
    // Expo keeps receipts ~24h and they are ready after ~15 min.
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: rows, error } = await admin
      .from('push_tickets')
      .select('ticket_id, token')
      .lt('created_at', cutoff)
      .limit(1000);
    if (error) return json(500, { error: error.message });
    let removed = 0;
    for (const batch of chunk(rows || [], EXPO_BATCH * 10)) {
      const ticketToken: Record<string, string> = {};
      batch.forEach((r: any) => (ticketToken[r.ticket_id] = r.token));
      const receipts: Record<string, ExpoReceipt> = {};
      for (const ids of chunk(Object.keys(ticketToken), EXPO_BATCH)) {
        const res = await expoPost(EXPO_RECEIPTS_URL, { ids });
        Object.assign(receipts, res?.data || {});
      }
      const dead = deadTokensFromReceipts(receipts, ticketToken);
      if (dead.length) {
        await admin.from('push_tokens').delete().in('token', dead);
        removed += dead.length;
      }
      await admin.from('push_tickets').delete().in('ticket_id', Object.keys(ticketToken));
    }
    // Receipts expire after a day; forget anything older.
    await admin
      .from('push_tickets')
      .delete()
      .lt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    return json(200, { checked: rows?.length || 0, removed_tokens: removed });
  }

  if (!payload.notification_id) return json(400, { error: 'notification_id_required' });

  const { data: n, error: nErr } = await admin
    .from('notifications')
    .select('id, recipient_id, type, title, body, ref_type, ref_id, data, pushed_at')
    .eq('id', payload.notification_id)
    .maybeSingle();
  if (nErr) return json(500, { error: nErr.message });
  if (!n) return json(404, { error: 'not_found' });
  if (n.pushed_at) return json(200, { skipped: 'already_pushed' });

  const { data: tokenRows } = await admin
    .from('push_tokens')
    .select('token')
    .eq('profile_id', n.recipient_id);
  const messages = buildMessages(n as NotificationRow, (tokenRows || []).map((r: any) => r.token));
  if (!messages.length) return json(200, { sent: 0 });

  const dead: string[] = [];
  const pending: { ticket_id: string; token: string; notification_id: string }[] = [];
  for (const batch of chunk(messages)) {
    const res = await expoPost(EXPO_SEND_URL, batch);
    const result = readTickets(batch, (res?.data || []) as ExpoTicket[]);
    dead.push(...result.deadTokens);
    result.pending.forEach((p) => pending.push({ ...p, notification_id: n.id }));
  }
  if (dead.length) await admin.from('push_tokens').delete().in('token', dead);
  if (pending.length) await admin.from('push_tickets').upsert(pending);
  await admin.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', n.id);

  return json(200, { sent: messages.length, tickets: pending.length, removed_tokens: dead.length });
});
