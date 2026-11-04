import { supabase } from './supabase';

/**
 * Active (and overdue) sessions of a listing, newest start first, with each session's
 * live balance preview. Used by the Availability screen's Sessions tab.
 */
export async function fetchActiveSessions(
  locationId: string | null | undefined
): Promise<{ sessions: any[]; previews: Record<string, any> }> {
  await supabase.rpc('refresh_overdue');
  let query = supabase
    .from('parking_sessions')
    .select(
      `
      *,
      locations(name),
      folios(
        id,
        status,
        folio_charges(amount, type, voided_at),
        payments(amount)
      )
    `
    )
    .in('status', ['active', 'overdue'])
    .order('started_at', { ascending: false });
  if (locationId) query = query.eq('location_id', locationId);
  const { data, error } = await query;
  if (error) throw error;
  const sessions = data || [];
  const previews: Record<string, any> = {};
  await Promise.all(
    sessions.map(async (s: any) => {
      const { data: preview } = await supabase.rpc('session_balance_preview', {
        p_session_id: s.id,
      });
      if (preview?.success) previews[s.id] = preview;
    })
  );
  return { sessions, previews };
}
