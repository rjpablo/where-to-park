import { supabase } from './supabase';

export type OperatorRole = 'owner' | 'manager' | 'staff';

export type Membership = {
  id: string;
  operator_id: string;
  role: OperatorRole;
  location_ids: string[] | null;
};

export type ManagedLocation = {
  id: string;
  name: string;
  verification_status: 'unverified' | 'verified';
  published: boolean;
  tracking_mode: 'count' | 'open_full' | 'slots';
  available_count: number;
  capacity: number;
  open_status: boolean | null;
  operator_id: string;
  availability_updated_at: string | null;
  role: OperatorRole;
};

export function canManageListings(role: OperatorRole | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export function membershipCoversLocation(
  membership: Membership,
  location: { id: string; operator_id: string }
): boolean {
  if (membership.operator_id !== location.operator_id) return false;
  if (canManageListings(membership.role)) return true;
  const ids = membership.location_ids || [];
  return ids.length === 0 || ids.includes(location.id);
}

export function roleForLocation(
  memberships: Membership[],
  location: { id: string; operator_id: string }
): OperatorRole | null {
  const hits = memberships.filter((m) => membershipCoversLocation(m, location));
  if (!hits.length) return null;
  if (hits.some((h) => h.role === 'owner')) return 'owner';
  if (hits.some((h) => h.role === 'manager')) return 'manager';
  return 'staff';
}

export async function loadMyMemberships(userId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from('operator_members')
    .select('id, operator_id, role, location_ids')
    .eq('profile_id', userId);
  if (error) throw error;
  return (data || []) as Membership[];
}

export async function loadManagedLocations(userId: string): Promise<ManagedLocation[]> {
  const memberships = await loadMyMemberships(userId);
  if (!memberships.length) return [];
  const operatorIds = [...new Set(memberships.map((m) => m.operator_id))];
  const { data, error } = await supabase
    .from('locations')
    .select(
      'id, name, verification_status, published, tracking_mode, available_count, capacity, open_status, operator_id, availability_updated_at'
    )
    .in('operator_id', operatorIds)
    .order('name');
  if (error) throw error;
  return ((data || []) as Omit<ManagedLocation, 'role'>[])
    .map((loc) => {
      const role = roleForLocation(memberships, loc);
      return role ? { ...loc, role } : null;
    })
    .filter((loc): loc is ManagedLocation => !!loc);
}

export function availabilityLabel(loc: {
  tracking_mode: string;
  open_status: boolean | null;
  available_count: number;
  capacity: number;
}): string {
  if (loc.tracking_mode === 'open_full') return loc.open_status ? 'Open' : 'Full';
  return `${loc.available_count} / ${loc.capacity} open`;
}
