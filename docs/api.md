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
- Returns only `published = true` locations
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

1. `SELECT ... FOR UPDATE` on location (or slot) row → serializes concurrent requests
2. Count overlapping active/confirmed sessions and reservations
3. Subtract `manual_reserved_count` and `unavailable_count`
4. If `available >= 1`, return success; else `no_longer_available`

**Used by:** `start_walk_in`, `request_reservation`, `set_manual_counts`

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

#### `adjust_availability`

Manually adjust available count (+1, -1, set).

**Parameters:**

```typescript
{
  p_location_id: UUID;
  p_delta: number; // +1, -1, or set to specific value
}
```

**Returns:**

```typescript
{
  success: boolean;
  available_count: number; // New count
}
```

**Auth:** Operator/Staff for this location  
**Notes:** Updates `availability_updated_at` and logs in `availability_events`

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
}
```

**Returns:**

```typescript
{
  success: boolean;
  session_id: UUID;
  folio_id: UUID;
  error?: 'no_longer_available';
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
