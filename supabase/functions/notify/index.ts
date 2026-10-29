import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Optional HTTP helper. The app does not call this function; session
 * notifications go through notify_session_staff in Postgres.
 *
 * Previously this inserted for any recipient with the service role.
 * It now requires a caller JWT and only allows:
 * - platform admins
 * - operator members notifying a driver who has a session or reservation
 *   at one of their locations
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_TYPES = new Set([
  'new_listing',
  'reservation_request',
  'fee_paid',
  'scheduled_end',
  'overdue',
  'no_show',
  'report',
  'chat_message',
  'approval_required',
  'verification_needed',
]);

interface NotificationRequest {
  recipient_id: string;
  type: string;
  title: string;
  body?: string;
  ref_type?: string;
  ref_id?: string;
  data?: Record<string, unknown>;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: 'missing_jwt' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return json(401, { error: 'invalid_jwt' });
  }

  let notification: NotificationRequest;
  try {
    notification = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  if (!notification.recipient_id || !notification.type || !notification.title) {
    return json(400, { error: 'Missing required fields' });
  }
  if (!ALLOWED_TYPES.has(notification.type)) {
    return json(400, { error: 'invalid_type' });
  }

  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: caller } = await adminClient
    .from('profiles')
    .select('id, is_admin')
    .eq('id', user.id)
    .maybeSingle();

  let allowed = !!caller?.is_admin;
  if (!allowed) {
    const { data: sessions } = await adminClient
      .from('parking_sessions')
      .select('id, location_id, locations!inner(operator_id)')
      .eq('driver_id', notification.recipient_id);

    const operatorIds = [
      ...new Set((sessions || []).map((row: any) => row.locations?.operator_id).filter(Boolean)),
    ];
    if (operatorIds.length) {
      const { data: membership } = await adminClient
        .from('operator_members')
        .select('id')
        .eq('profile_id', user.id)
        .in('operator_id', operatorIds)
        .limit(1);
      allowed = (membership || []).length > 0;
    }
  }

  if (!allowed) {
    const { data: reservations } = await adminClient
      .from('reservations')
      .select('id, location_id, locations!inner(operator_id)')
      .eq('driver_id', notification.recipient_id);
    const operatorIds = [
      ...new Set((reservations || []).map((row: any) => row.locations?.operator_id).filter(Boolean)),
    ];
    if (operatorIds.length) {
      const { data: membership } = await adminClient
        .from('operator_members')
        .select('id')
        .eq('profile_id', user.id)
        .in('operator_id', operatorIds)
        .limit(1);
      allowed = (membership || []).length > 0;
    }
  }

  if (!allowed) {
    return json(403, { error: 'not_allowed' });
  }

  const { data: notif, error: insertError } = await adminClient
    .from('notifications')
    .insert({
      recipient_id: notification.recipient_id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      ref_type: notification.ref_type,
      ref_id: notification.ref_id,
      data: notification.data,
    })
    .select()
    .single();

  if (insertError) {
    return json(500, { error: insertError.message });
  }

  return json(200, { success: true, notification: notif });
});
