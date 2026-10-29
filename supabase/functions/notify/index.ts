import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationRequest {
  recipient_id: string;
  type: string;
  title: string;
  body?: string;
  ref_type?: string;
  ref_id?: string;
  data?: Record<string, any>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const notification: NotificationRequest = await req.json();

    if (!notification.recipient_id || !notification.type || !notification.title) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Insert notification record
    const { data: notif, error: insertError } = await supabaseClient
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
      throw insertError;
    }

    // Get user's push tokens (if implemented)
    // For now, just return success
    // In production, you would:
    // 1. Query push_tokens table for this user
    // 2. Send push notifications via Expo Push API
    // 3. Mark notification as pushed

    return new Response(JSON.stringify({ success: true, notification: notif }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
