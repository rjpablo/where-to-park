# Where To Park API Documentation

All actions in Where To Park go through documented Supabase RPCs (Postgres functions) or Edge Functions. This ensures the Phase 5 web dashboard can reuse the same API.

## Authentication

All RPCs use Row-Level Security (RLS) based on `auth.uid()`. The JWT is passed in the `Authorization: Bearer <token>` header.

- **Guest**: No auth (anonymous key only)
- **Authenticated**: Any signed-in user
- **Operator/Staff**: Checked via `operator_members` table
- **Admin**: Checked via `profiles.is_admin`

## Error Codes

- `no_longer_available` - Capacity claim failed (space taken)
- `waiver_note_required` - Attempted to close session with balance > 0 without a note
- `waiver_not_allowed` - Staff tried to waive when `staff_can_waive = false`
- `Permission denied` - RLS or admin check failed

## RPCs (Postgres Functions)

### Search & Discovery

#### `search_nearby`

Search for parking locations within radius.

**Parameters:**

```typescript
{
  p_lat: number;              // Search origin latitude
  p_lng: number;              // Search origin longitude
  p_radius_m: number;         // Radius in meters (default 1000)
  p_vehicle_type?: VehicleType; // Filter by vehicle type
  p_monthly_only: boolean;    // Show only locations with Monthly rates (default false)
  p_hide_full: boolean;       // Hide Full locations (default false)
  p_sort_by: 'distance' | 'price' | 'availability' | 'rating' | 'eta'; // Sort order (default 'distance')
  p_limit: number;            // Max results (default 50)
}
```

**Returns:**

```typescript
Array<{
  id: UUID;
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
  availability_updated_at: timestamp;
  stale_after_min: number;
  verification_status: 'unverified' | 'verified';
  cover_photo_url: string | null;
  starting_rate: number | null; // Hourly rate for selected vehicle
  avg_rating: number | null;
  review_count: number;
  has_monthly: boolean;
}>;
```

**Auth:** Guest (anonymous) or authenticated  
**Notes:**

- Uses PostGIS `ST_DWithin` for radius search
- Returns only `published = true` locations, including Unverified listings (clients show an Unverified badge from `verification_status`)
- Unpublished listings are hidden from guests
- `starting_rate` is the hourly rate for `p_vehicle_type` (or first hourly rate if null)

---

#### `quote_price`

Calculate parking fee for a given duration and vehicle.

**Parameters:**

```typescript
{
  p_location_id: UUID;
  p_vehicle_type: VehicleType;
  p_start_at: timestamp;
  p_hours: number | null;     // Duration in hours (default 1)
  p_area_id?: UUID;
  p_slot_id?: UUID;
}
```

**Returns:**

```typescript
{
  amount: number; // Total in pesos (numeric(12,2))
  rate_id: UUID;
  rate_name: string;
  rate_type: 'hourly' | 'daily' | 'flat_then_hourly' | 'monthly';
  billed_hours: number; // Rounded up to started hours
}
```

**Auth:** Guest or authenticated  
**Rate Resolution:**

1. Custom beats default
2. Dated (effective period) beats indefinite
3. Slot > area > location scope
4. Vehicle-specific beats all vehicles
5. Specific days beat every day
6. Shorter period, higher priority, newest created

---

### Capacity Management

#### `claim_capacity`

**Internal function** (security definer, called by other RPCs). Atomically reserves capacity with row lock.

**Parameters:**

```typescript
{
  p_location_id: UUID;
  p_slot_id?: UUID;           // For slots mode
  p_start_at: timestamp;
  p_end_at?: timestamp;
  p_kind: 'session' | 'reservation';
  p_area_id?: UUID;           // 0067: the area (Main when omitted)
}
```

**Returns:**

```typescript
{
  success: boolean;
  available?: number;         // For count mode
  slot_id?: UUID;             // For slots mode
  error?: 'no_longer_available' | string;
}
```

**Logic:**

1. `SELECT ... FOR UPDATE` on the location and the area (or slot) row → serializes concurrent requests
2. 🟧 0067: an unmonitored area always succeeds (no count). A start ≤ now needs `area_counted_spaces ≥ 1`; a future start counts the area's overlapping sessions
3. Subtract the area's `manual_reserved_count` and `unavailable_count`
4. If `available >= 1`, return success; else `no_longer_available`

Not callable by clients (0067). **Used by:** `start_walk_in`, `update_walk_in_session` (moving a session to another area)

---

#### `release_capacity`

Release reserved/occupied capacity (called on session end, reservation cancel).

**Parameters:**

```typescript
{
  p_location_id: UUID;
  p_slot_id?: UUID;
}
```

**Returns:** `{ success: boolean }`

**Auth:** System (security definer)

---

#### `location_free_spaces` / `free_spaces` 🟧

A listing's free spaces, the one source. Since migration 0067 it is the **sum over the listing's monitored areas** (optionally only areas that take a vehicle type): `location_free_spaces(p_location_id, p_vehicle_type DEFAULT NULL)`; `NULL` when no such area is monitored. Per area: `area_free_spaces(area_id)` = 0 when the area is switched Full, else `capacity − started open sessions in the area − Reserved − Unavailable` (never below 0), `NULL` when not monitored. `area_counted_spaces` is the same without the Full switch. `location_is_full(p_location_id, p_vehicle_type DEFAULT NULL)` is true only when every (applicable) area is full (an unmonitored area is full only when its Available/Full toggle says Full). Computed fields: `locations?select=*,free_spaces,counted_spaces,listing_full` and `areas?select=*,area_free,area_counted,area_occupied,area_full`. Readable by anyone. `locations.capacity / manual_reserved_count / unavailable_count / marked_full / available_count` are now caches kept in sync from the areas (monitored totals; `marked_full` = the listing is Full).

`adjust_availability` (the old +1/-1) was removed in migration 0065 (it had no permission check).

---

#### Areas 🟧 (migration 0067)

Every listing has a **Main** area (`areas.is_main`), created with the listing; it can't be deleted or renamed (RPCs return `main_area_locked`; a trigger also blocks direct writes). Area columns: `capacity`, `vehicle_types` (NULL = all), `monitored`, `manual_reserved_count`, `unavailable_count`, `marked_full`. Sessions have `area_id` (Main when not given).

| RPC | Who | Notes |
| --- | --- | --- |
| `upsert_area(p_location_id, p_name, p_area_id?, p_sort_order?)` | owner/manager | `name_required`, `area_name_taken` (case-insensitive), `main_area_locked` (rename Main) |
| `delete_area(p_area_id)` | owner/manager | `main_area_locked`, `area_has_sessions` (open sessions); ended sessions move to Main |
| `set_area_settings(p_area_id, p_capacity, p_vehicle_types, p_monitored)` | owner/manager | `capacity_invalid`, `capacity_below_in_use` (`in_use`); empty or every type = all |
| `set_area_counts(p_area_id, p_reserved, p_unavailable)` | owner/manager/assigned staff | Reserved/Unavailable; `area_not_monitored`, `no_longer_available` |
| `set_area_full(p_area_id, p_full)` | owner/manager/assigned staff | Full switch (monitored) / Available-Full toggle (unmonitored); logged in `availability_events` with `area_id` |

`set_manual_counts` and `set_listing_full` were dropped (0067). `update_location(p_capacity)` now sets Main's total spots.

---

### Sessions (Walk-ins)

#### `start_walk_in`

Check in a walk-in session.

**Parameters:**

```typescript
{
  p_location_id: UUID;
  p_vehicle_type: VehicleType;  // Required (drives rate)
  p_plate: string;              // Required
  p_note?: string;
  p_scheduled_end_at?: timestamp;
  p_started_at?: timestamp;
  p_rate_id?: UUID;
  p_area_id?: UUID;             // 🟧 0067: the area (Main when omitted)
}
```

**Returns:**

```typescript
{
  success: boolean;
  session_id: UUID;
  folio_id: UUID;
  area_id: UUID;
  error?: 'no_longer_available' | 'vehicle_not_allowed' | 'area_not_found' | 'plate_active';
}
```

**Auth:** Staff assigned to this location, or Operator  
**Flow:**

1. Call `claim_capacity` (may fail if no space)
2. Call `quote_price` for rate snapshot
3. Insert `parking_sessions` row
4. Create `folio`
5. Log `availability_events`

---

#### `end_session`

End a session with optional cash payment and waiver.

**Parameters:**

```typescript
{
  p_session_id: UUID;
  p_cash_amount?: number;       // Cash collected at checkout
  p_waive_note?: string;        // Required if balance > 0.01
}
```

**Returns:**

```typescript
{
  success: boolean;
  session_id: UUID;
  final_balance: number;        // Always 0 after success
  push_tokens?: string[];       // Expo tokens for Operator/staff
  error?: 'waiver_note_required' | 'waiver_not_allowed';
}
```

**Auth:** Staff/Operator for this location  
**Logic:**

1. Calculate parking fee from `started_at` to now (or `ended_at` if overridden), using `rate_snapshot`
2. Add parking_fee charge to folio (if not already added)
3. Record cash payment if `p_cash_amount` provided
4. Compute balance = charges - payments
5. If balance > 0.01:
   - Check `p_waive_note` not empty → error if missing
   - Check user can waive (Operator/Manager always; Staff only if `staff_can_waive = true`)
   - Post waiver charge (negative amount = remaining balance) with note, who, when
6. Mark session `status = 'ended'`, folio `status = 'settled'`
7. Log `booking_events`

**Waiver Rules:**

- Operators and Managers can always waive
- Staff can waive only if `operators.staff_can_waive = true` (default on)
- Waivers recorded as `folio_charges.type = 'waiver'` with negative `amount`
- Waivers excluded from revenue and payouts
- Notifies Operator/staff (`session_ended`) and returns Expo `push_tokens` for the acting client to deliver

---

#### `extend_session`

Move a walk-in session's scheduled end forward after a reservation collision check.

**Parameters:**

```typescript
{
  p_session_id: UUID;
  p_hours: number;              // Hours to add from max(scheduled_end, now)
  p_reason?: string;
}
```

**Returns:** `{ success: boolean; scheduled_end_at: timestamp; push_tokens?: string[] }`  
**Auth:** Operator/staff for the location  
**Errors:** `not_active`, `hours_required`, `reservation_collision`

---

#### `set_tracking_mode` / `set_open_status`

Switch a location between Count and Open/Full, or toggle Open vs Full. Walk-ins call `claim_capacity`, which refuses a Full lot with `no_longer_available`.

---

#### `register_push_token` / `mark_notification_read` / `refresh_overdue`

Register an Expo push token, mark an inbox row read, and flip active sessions past `scheduled_end_at` to overdue (writes `scheduled_end` notifications).

---

### Admin Functions

#### `create_admin`

Promote a user to Admin.

**Parameters:**

```typescript
{
  p_profile_id: UUID;
}
```

**Returns:** `{ success: boolean }`

**Auth:** Existing Admin only  
**Notes:** Only existing Admins can create new Admins (bootstrap: rj is seeded as first Admin)

---

#### `verify_location`

Mark a location as Verified.

**Parameters:**

```typescript
{
  p_location_id: UUID;
}
```

**Returns:** `{ success: boolean }`

**Auth:** Admin only  
**Notes:** Sets `verification_status = 'verified'`, records `verified_by` and `verified_at`

---

## Edge Functions

Edge Functions are Deno TypeScript functions deployed to Supabase Edge Runtime. They run close to users and can call external APIs.

### `get-etas`

Fetch drive-time ETAs for a list of locations from OpenRouteService Matrix API, with caching and straight-line fallback.

**Endpoint:** `POST /functions/v1/get-etas`

**Body:**

```typescript
{
  origin: {
    lat: number;
    lng: number;
  }
  locations: Array<{ id: string; lat: number; lng: number }>;
}
```

**Response:**

```typescript
{
  etas: Array<{
    location_id: string;
    duration_s: number;
    distance_m: number;
    source: 'ors' | 'estimate';
  }>;
}
```

**Logic:**

1. Round origin to ~200m grid cell (cache key)
2. Check `eta_cache` for fresh entries (10-min TTL)
3. For uncached locations:
   - If `OPENROUTE_SERVICE_API_KEY` set, call ORS Matrix API
   - On ORS success, cache results as `source = 'ors'`
   - On ORS error/rate-limit, fall back to Haversine straight-line estimate (30 km/h avg in Baguio)
   - Cache estimates as `source = 'estimate'`
4. Return all ETAs (cached + freshly fetched)

**Rate Limiting:** ORS free tier allows ~40 req/day for matrices up to 50 locations. With 10-min cache and 200m rounding, typical usage stays well under this.

**Auth:** Anonymous or authenticated (uses anon key)

---

### `notify`

Create a notification and optionally send push.

**Endpoint:** `POST /functions/v1/notify`

**Body:**

```typescript
{
  recipient_id: string;
  type: 'new_listing' | 'reservation_request' | 'fee_paid' | 'scheduled_end' | 'overdue' | 'no_show' | 'report' | 'chat_message' | 'approval_required' | 'verification_needed';
  title: string;
  body?: string;
  ref_type?: string;          // e.g., 'session', 'reservation'
  ref_id?: string;            // UUID
  data?: Record<string, any>; // Custom payload
}
```

**Response:**

```typescript
{
  success: boolean;
  notification: Notification;
}
```

**Auth:** Service role key (internal calls only)  
**Notes:** In production, would also query `push_tokens` table and send via Expo Push API

---

## RLS Policies Summary

| Table               | Select                                  | Insert               | Update          | Delete   |
| ------------------- | --------------------------------------- | -------------------- | --------------- | -------- |
| `profiles`          | All                                     | Own                  | Own             | -        |
| `operators`         | Active                                  | Auth                 | Owner/Manager   | -        |
| `locations`         | Published OR operator member            | Operator             | Operator        | Operator |
| `location_photos`   | Published location                      | Operator             | Operator        | Operator |
| `rates`             | Published location                      | Operator             | Operator        | Operator |
| `vehicles`          | Own                                     | Own                  | Own             | Own      |
| `reviews`           | Published, not hidden                   | Auth (for published) | Own author      | -        |
| `parking_sessions`  | Own driver OR operator/staff            | Via RPC              | Via RPC         | -        |
| `folios`            | Own or operator                         | Via RPC              | Via RPC         | -        |
| `folio_charges`     | Via folio                               | Via RPC              | Via RPC         | -        |
| `payments`          | Via folio                               | Via RPC              | -               | -        |
| `chat_threads`      | Participant (driver or operator member) | Driver               | -               | -        |
| `chat_messages`     | Thread participant, not hidden          | Participant          | -               | -        |
| `notifications`     | Own                                     | System               | Own (mark read) | -        |
| `reports`           | Admin                                   | Auth                 | Admin (resolve) | -        |
| `platform_settings` | All                                     | -                    | Admin           | -        |
| `eta_cache`         | All                                     | System               | System          | -        |

**Key Points:**

- Guests (anonymous) can search (`locations`, `rates`, `reviews`) but cannot modify
- Drivers see only their own sessions, vehicles, folios
- Operators/Staff see only locations they're members of
- Admins see reports and can verify locations
- Most writes go through RPCs (security definer) rather than direct table access

---

## Integration Examples

### Search and Display

```typescript
const { data: results } = await supabase.rpc('search_nearby', {
  p_lat: 16.412,
  p_lng: 120.596,
  p_radius_m: 2000,
  p_vehicle_type: 'car',
  p_monthly_only: false,
  p_hide_full: false,
  p_sort_by: 'distance',
  p_limit: 20,
});

// Fetch ETAs for top results
const etaResp = await fetch(`${supabaseUrl}/functions/v1/get-etas`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${anonKey}`,
  },
  body: JSON.stringify({
    origin: { lat: 16.412, lng: 120.596 },
    locations: results.slice(0, 20).map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
    })),
  }),
});

const { etas } = await etaResp.json();
// Merge ETAs into results by location_id
```

### Walk-in Check-in

```typescript
const { data, error } = await supabase.rpc('start_walk_in', {
  p_location_id: locationId,
  p_vehicle_type: 'car',
  p_plate: 'ABC 1234',
  p_note: 'Visitor',
  p_scheduled_end_at: null,
});

if (error?.message === 'no_longer_available') {
  alert('Space just taken by another booking');
} else {
  // data.session_id, data.folio_id
  // Navigate to active session screen
}
```

### End Session with Waiver

```typescript
// User enters cash amount (partial payment)
const { data, error } = await supabase.rpc('end_session', {
  p_session_id: sessionId,
  p_cash_amount: 100.0,
  p_waive_note: null, // Try without note first
});

if (error?.message === 'waiver_note_required') {
  // Show alert: "Balance of ₱135 remains. Add a note to waive."
  // User enters note, retry with note
  const { data: data2 } = await supabase.rpc('end_session', {
    p_session_id: sessionId,
    p_cash_amount: 0, // Already recorded above
    p_waive_note: 'Regular customer, short on cash',
  });
  // data2.final_balance === 0
} else if (error?.message === 'waiver_not_allowed') {
  alert('Only the operator can waive. Please ask them to close this session.');
}
```

---

## Contract Testing

All RPCs should have contract tests in CI:

- Input validation (required params, types)
- Auth checks (guest, driver, operator, staff, admin)
- Business logic (capacity, ledger, rates)
- Error codes

See `supabase/tests/*.sql` for pgTAP examples.

---

**For more details, see the feature spec (`docs/spec.md`) and database schema (`supabase/migrations/`). **

## 🟧 Realtime: `listing-availability` broadcast (0068)

Public broadcast channel (no sign-in needed). Event `changed`, payload `{ id: UUID, lat: number, lng: number }`, sent by a trigger on `locations` whenever a published, non-deleted listing's availability caches change (sessions, area settings, Reserved/Unavailable, Full) or it is published/unpublished/deleted. Carries no counts: clients re-read through `search_nearby` / `free_spaces`. Clients only listen; `realtime.send` and the trigger function aren't callable by clients.

## 🟧 Google sign-in and linking (0069)

- `profiles.avatar_url text` (Google picture, https only) and `profiles.onboarded boolean` (false for new accounts until `complete_profile`, which now sets it true).
- `handle_new_auth_user` (auth.users insert): Google sign-ups get `display_name` from `full_name`/`name`, `avatar_url` from `avatar_url`/`picture`, `phone` null. Never the email.
- `guard_oauth_identity` (BEFORE INSERT / UPDATE OF identity_data on `auth.identities`, non-phone/email providers). Errors: `oauth_email_not_verified`, `oauth_email_belongs_to_another_account`, `oauth_link_target_unverified` (🟧 0070: only when the target account already has another identity; GoTrue confirms a new OAuth user's email after inserting its identity). GoTrue reports them to the app as a sign-in error ('Database error …'). 🟧 0071: also `oauth_link_target_unverified` when the target account has an `email` (password) identity with the same email that isn't verified (`identity_data.email_verified`; auto-confirmed sign-ups).
- `oauth_identity_linked` (AFTER INSERT): fills a missing `profiles.avatar_url` when Google is linked to an existing account.
- Not client-callable: all three trigger functions have EXECUTE revoked.

## 🟧 Profile photos, listing owner, email privacy (0075–0080, rj t179u)

- 0075: `public_profiles` is **read-only** (SELECT only for anon/authenticated; it was an auto-updatable view, so anyone could rename any user).
- `profiles.avatar_url text`: either a Storage path `avatars/<user id>/<file>.jpg` (uploaded) or a Google `https://` URL. The app turns a Storage path into `${SUPABASE_URL}/storage/v1/object/public/avatars/<user id>/<file>` (`src/lib/avatar.ts`). Not writable by clients directly (no column grant); use the RPCs below. `profiles.avatar_removed_at timestamptz`: set by **Remove photo**; while set, Google never fills the photo.
- Storage bucket `avatars` (0076): public read, 2 MB, `image/jpeg|png|webp`. Insert/update/delete only in your own folder `<auth.uid()>/` (one level).
- `set_my_avatar(p_path text) → {success, avatar_url} | {error}` (authenticated): `p_path` = `<your id>/<name>` (`[A-Za-z0-9._-]{1,80}`), the object must already be uploaded. Errors: `not_authenticated`, `invalid_path`, `not_uploaded`. Clears `avatar_removed_at`.
- `clear_my_avatar() → {success}` (authenticated): photo off (`avatar_url` null, `avatar_removed_at` now). The app then deletes your files in the bucket.
- 0077 `oauth_identity_linked`: fills the Google picture only when `avatar_url` is null **and** `avatar_removed_at` is null. Backfills existing Google accounts the same way.
- 0078 `public_profiles` = `id, display_name, avatar_url` (embeds `public_profiles(...)` from `reviews` and `chat_threads` return it too). `admin_contact_submissions` / `admin_contact_submission` items add `user_avatar_url`.
- 0079 `listing_owner(p_location_id uuid) → {id, display_name, avatar_url} | null` (anon, authenticated): the listing's operator owner (earliest owner). Null when the listing is not visible to you (unpublished/deleted and you are not on its team or admin) or has no owner. Never email or phone.
- 0080 `oauth_display_name`: ignores a provider name containing '@'.
- **Email privacy**: no client-readable table, view or RPC returns an email; emails stay in `auth.users`/`auth.identities` (no client grants). Your own email: `GET /auth/v1/user`. Tests: `supabase/tests/email_privacy.sql`, `scripts/test-email-privacy.js` (signs in as each test account and checks no response holds another account's email; `/auth/v1/admin/users` refused). Known: `invite_staff` answers `user_not_found` for an unknown email/phone, which tells an operator whether an account exists (no email is returned).

## 🟧 Private staff invites (0082, rj t181u)

- `invite_staff(p_operator_id, p_email?, p_phone?, p_role='staff', p_location_ids='{}')` (owners/managers). For any valid request it returns `{success: true, sent_to, resend_after_seconds: 180}`, whether or not the email/phone has an account. `member_id`, `profile_id` and `user_not_found` are gone. Errors that don't depend on the account: `not_authenticated`, `Permission denied`, `cannot_invite_owner`, `email_or_phone_required`, `invalid_email`, `invalid_phone`, `cannot_invite_self`, and `cooldown` + `retry_after_seconds` (3 minutes per inviter + team + email/phone, for every target).
  - Account, not on the team: a pending invite, plus a `staff_added` notification with `ref_type 'staff_invite'`, `ref_id` = invite id, and `data {invite_id, operator_id, role, audience: 'invitee'}`.
  - Already on the team: nothing changes. No account: nothing visible.
- `respond_staff_invite(p_invite_id uuid, p_accept boolean) → {success, status, operator_id}` (the invited account only). Accept adds the membership. It also marks the invite's notifications read with `data.status`. Errors: `not_authenticated`, `not_found` (not your invite), `already_answered`.
- `staff_invites` table: server only (no client grants).

