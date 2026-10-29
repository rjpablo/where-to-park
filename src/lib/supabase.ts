import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: undefined, // Will use AsyncStorage via custom implementation
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Types for database tables (subset for demonstration)
export type Profile = {
  id: string;
  display_name: string;
  phone: string | null;
  is_admin: boolean;
  preferred_nav_app: 'google_maps' | 'waze' | 'default' | null;
  created_at: string;
  updated_at: string;
};

export type Operator = {
  id: string;
  display_name: string;
  contact: string | null;
  status: 'active' | 'suspended';
  payments_mode: string;
  payout_gcash_number: string | null;
  staff_can_waive: boolean;
  created_at: string;
  updated_at: string;
};

export type Location = {
  id: string;
  operator_id: string;
  name: string;
  listing_type: 'commercial' | 'residential';
  geog: any; // PostGIS geography
  address: string;
  rules: string | null;
  tracking_mode: 'count' | 'open_full' | 'slots';
  capacity: number;
  available_count: number;
  open_status: boolean | null;
  availability_updated_at: string;
  stale_after_min: number;
  published: boolean;
  verification_status: 'unverified' | 'verified';
  created_at: string;
  updated_at: string;
};

export type SearchResult = {
  id: string;
  name: string;
  listing_type: 'commercial' | 'residential';
  address: string;
  lat: number;
  lng: number;
  distance_m: number;
  available_count: number;
  capacity: number;
  open_status: boolean | null;
  tracking_mode: 'count' | 'open_full' | 'slots';
  availability_updated_at: string;
  stale_after_min: number;
  verification_status: 'unverified' | 'verified';
  cover_photo_url: string | null;
  starting_rate: number | null;
  avg_rating: number | null;
  review_count: number;
  has_monthly: boolean;
};

export type Vehicle = {
  id: string;
  driver_id: string;
  nickname: string;
  plate: string | null;
  vehicle_type: 'car' | 'suv' | 'van' | 'motorcycle' | 'truck';
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  is_default: boolean;
  created_at: string;
};

export type ParkingSession = {
  id: string;
  location_id: string;
  driver_id: string | null;
  plate: string;
  vehicle_type: 'car' | 'suv' | 'van' | 'motorcycle' | 'truck';
  note: string | null;
  started_at: string;
  scheduled_end_at: string | null;
  ended_at: string | null;
  status: 'active' | 'overdue' | 'ended';
  rate_snapshot: any;
  created_at: string;
};

export type Folio = {
  id: string;
  operator_id: string;
  location_id: string;
  session_id: string | null;
  reservation_id: string | null;
  currency: string;
  status: 'open' | 'settled';
  created_at: string;
};

export type FolioCharge = {
  id: string;
  folio_id: string;
  type: 'parking_fee' | 'additional_fee' | 'adjustment' | 'waiver';
  description: string;
  amount: number;
  note: string | null;
  added_by: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  folio_id: string;
  direction: 'payment' | 'refund';
  amount: number;
  method: 'cash' | 'gcash' | 'maya' | 'card' | 'other';
  recorded_by: string | null;
  received_at: string;
  note: string | null;
};

export type ChatThread = {
  id: string;
  location_id: string;
  operator_id: string;
  driver_id: string;
  last_message_at: string;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  kind: 'text' | 'image' | 'system';
  body: string | null;
  image_path: string | null;
  event_type: string | null;
  created_at: string;
  read_at: string | null;
  hidden: boolean;
};

export type Review = {
  id: string;
  location_id: string;
  author_id: string;
  rating: number;
  comment: string | null;
  operator_reply: string | null;
  reply_at: string | null;
  hidden: boolean;
  created_at: string;
  updated_at: string;
};

export type Notification = {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  data: any;
  created_at: string;
  pushed_at: string | null;
  read_at: string | null;
};
