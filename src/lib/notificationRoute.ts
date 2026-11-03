/**
 * Where a tapped push notification opens (rj t173u). The push `data` carries the
 * notifications row's type, ref_type and ref_id (plus the row's own data, e.g.
 * location_id) — see supabase/functions/send-push/lib.ts › pushData.
 * Anything unknown opens the Notifications list.
 */
export type PushData = {
  notification_id?: unknown;
  type?: unknown;
  ref_type?: unknown;
  ref_id?: unknown;
  location_id?: unknown;
  driver_id?: unknown;
  audience?: unknown;
  [key: string]: unknown;
};

export const NOTIFICATIONS_ROUTE = '/notifications';

const ID = /^[A-Za-z0-9-]{1,64}$/;
function id(v: unknown): string | null {
  return typeof v === 'string' && ID.test(v) ? v : null;
}

export function notificationRoute(data: PushData | null | undefined): string {
  if (!data || typeof data !== 'object') return NOTIFICATIONS_ROUTE;
  const type = typeof data.type === 'string' ? data.type : '';
  const refType = typeof data.ref_type === 'string' ? data.ref_type : '';
  const refId = id(data.ref_id);
  const locationId = id(data.location_id);
  const forDriver = data.audience === 'driver';
  const listing = locationId ? `/location/${locationId}` : NOTIFICATIONS_ROUTE;
  const hub = locationId ? `/operator/hub/${locationId}` : '/operator/listings';

  switch (type) {
    case 'contact_submission':
      return refId ? `/admin/contact-item?id=${refId}` : '/admin/contact';
    case 'verification_needed':
    case 'new_listing':
    case 'approval_required':
      return '/admin/verify';
    case 'report':
      // 0074: a driver's report on your listing -> that listing's page (operators).
      return data.audience === 'operator' || refType === 'location' ? hub : '/admin/reports';
    case 'chat_message': {
      if (!locationId) return '/operator/inbox';
      const driverId = id(data.driver_id);
      return driverId && !forDriver
        ? `/chat/${locationId}?driverId=${driverId}`
        : `/chat/${locationId}`;
    }
    case 'reservation_request':
      return hub;
    case 'no_show':
      return forDriver ? listing : hub;
    case 'reservation_decision':
    case 'session_ending_soon':
      return listing;
    case 'listing_reviewed':
    case 'staff_added':
      // 0082: an invite is answered (Accept / Decline) in the Notifications list.
      return refType === 'staff_invite' ? NOTIFICATIONS_ROUTE : '/operator/listings';
  }
  if (refType === 'session' && refId) {
    return forDriver ? listing : `/staff/session?id=${refId}`;
  }
  if (refType === 'location' && refId) return `/location/${refId}`;
  return NOTIFICATIONS_ROUTE;
}
