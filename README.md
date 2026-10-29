# Where To Park - README

A parking-finder mobile app for drivers in Baguio City, Philippines. Operators list spaces with live availability and rates; drivers search on a map, see ETAs, and navigate; staff run walk-in sessions with a folio ledger, fees, and chat.

## Stack

- **App**: Expo (React Native, TypeScript), Expo Router for navigation
- **Backend**: Supabase (Postgres + PostGIS, Auth, Realtime, Storage, Edge Functions)
- **Maps**: MapLibre (@maplibre/maplibre-react-native for native, maplibre-gl for web) with OpenFreeMap/OSM tiles
- **Geocoding**: Photon (search-as-you-type), Nominatim (≤1 req/s, cached)
- **Routing**: OpenRouteService Matrix API for drive-time ETAs (via Edge Function)
- **Platform**: Android primary (dev build), Web for preview/testing

## Project Structure

```
/workspace
├── app/                      # Expo Router screens
├── src/
│   ├── components/           # Reusable UI components
│   ├── lib/                  # Core libraries (Supabase, theme)
│   ├── utils/                # Utilities (formatters, helpers)
│   ├── hooks/                # Custom React hooks
│   ├── stores/               # Zustand state stores
│   └── types/                # TypeScript types
├── supabase/
│   ├── migrations/           # Database schema, RLS, RPCs, triggers
│   ├── functions/            # Edge Functions (get-etas, notify)
│   ├── tests/                # pgTAP tests (RLS, rates, ledger, concurrency)
│   └── seed.sql              # Baguio sample data
├── docs/
│   ├── spec.md               # Feature spec (cleaned from canvas)
│   └── api.md                # API documentation
├── .env.example              # Environment variables template
├── package.json
├── eas.json                  # EAS Build configuration
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+ and npm
- Docker (for local Supabase)
- Supabase CLI (`npm install -g supabase`)
- Expo CLI (`npm install -g expo-cli` or `npx expo`)

### Local Development

1. **Clone and install dependencies:**

   ```bash
   git clone <repo-url>
   cd where-to-park
   npm install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   ```

   For local dev, use:
   ```
   EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<get from supabase status>
   ```

3. **Start local Supabase:**

   ```bash
   npm run db:start
   ```

   This pulls Docker images and starts:
   - Postgres (PostGIS enabled) on `localhost:54322`
   - Kong API Gateway on `localhost:54321`
   - Studio on `http://localhost:54323`
   - Realtime, Auth, Storage, etc.

   Get the anon key from `supabase status` and add it to `.env`.

4. **Apply migrations and seed data:**

   ```bash
   npm run db:reset
   ```

   This applies all migrations in `supabase/migrations/` and runs `supabase/seed.sql`.

5. **Run the app:**

   **Web (for preview):**
   ```bash
   npm run web
   ```
   Open http://localhost:8081 in your browser.

   **Android (dev build):**
   ```bash
   npm run android
   ```
   Requires Android SDK and a device/emulator. First run builds the dev client.

   **iOS (macOS only):**
   ```bash
   npm run ios
   ```

### Database Testing

Run pgTAP tests:

```bash
npm run test:db
```

This runs `supabase/tests/*.sql` including:
- RLS policy tests
- Rate resolution logic
- Folio balance and waiver calculations
- Last-space concurrency protection (claim_capacity with row locks)

### Edge Functions

Test locally:

```bash
npm run functions:serve
```

Then call:
- `POST http://localhost:54321/functions/v1/get-etas` - ETAs from OpenRouteService or straight-line estimates
- `POST http://localhost:54321/functions/v1/notify` - Create notifications

## Key Features (Phase 1 Scope)

### Implemented in Database/Backend

✅ **Complete schema** with PostGIS, RLS policies, triggers  
✅ **Core RPCs**: `search_nearby`, `quote_price`, `claim_capacity`, `release_capacity`, `start_walk_in`, `end_session`, `adjust_availability`, `verify_location`, `create_admin`  
✅ **Concurrency protection**: `claim_capacity` uses `SELECT ... FOR UPDATE` row locks, ensuring only one request wins the last space  
✅ **Rate resolution engine**: precedence (custom > default, dated > indefinite, slot > area > location, vehicle, days, priority, newest)  
✅ **Folio ledger**: charges, payments, waivers (negative charges); balance = charges - payments  
✅ **Waiver logic**: Staff can waive by default; Operators can restrict to Operator-only via `staff_can_waive`  
✅ **Edge Functions**: get-etas (OpenRouteService Matrix + cache + fallback), notify  
✅ **Seed data**: 4 sample operators, 4 locations in Baguio (SM City, Session Road, Casa Vallejo, Pine Ridge), rates, reviews, active session  
✅ **pgTAP tests**: RLS, rates, ledger, concurrency (50+ assertions)

### App Infrastructure

✅ Expo project with TypeScript, Expo Router, EAS build profiles  
✅ Supabase client, types, formatters (peso numeric(12,2), distance, duration, relative time)  
✅ Design tokens (colors, spacing, typography, shadows)  
✅ Base components (Button, AvailabilityBadge)  
✅ Environment config (.env.example)

### To Be Implemented (App Screens)

The following screens are defined in the spec but not yet implemented:

- **Auth**: Phone OTP, Google sign-in, profile, mode switch (Driver/Operator/Staff/Admin)
- **Driver Search**: Map with pins (count/status, stale warning), MapLibre clustering, results bottom sheet (@gorhom/bottom-sheet), sort & filters, tap pin/row → details, search state preservation
- **Location Detail**: Cover photo, rules, rates, ETA, Navigate button, reviews, chat, report
- **Operator Onboarding**: 5-step flow (space, capacity, rate, payments=cash, publish)
- **Location Setup**: Map pin picker, photo gallery (Storage), rules, tracking mode (Count default)
- **Availability Console**: Big +1/-1 buttons (staff home screen), Reserved/Unavailable steppers, realtime updates
- **Walk-in Check-in**: Vehicle type (required), plate (required), note (optional)
- **Active Sessions Board**: Active, Overdue (End/Extend), folio with ledger
- **End Session with Waiver**: Show charges, payments, balance; alert if balance > 0, require note, post waiver (staff_can_waive check)
- **Chat**: Driver→any listing, Operator/Staff→threads with sessions/reservations, text + images (Storage), system events
- **Admin Verification Queue**: New listings (Unverified badge), mark Verified, unpublish
- **Reviews & Ratings**: 1-5 stars, comment, operator reply, report
- **Vehicles Garage**: Add/edit, dimensions, default vehicle
- **Areas & Rates CRUD**: Named areas, rate types (Hourly default, Monthly, Daily, Flat-then-hourly), rate preview

See `docs/spec.md` for the complete Phase 1 scope and `docs/api.md` for RPC/Edge Function signatures.

## API

All actions go through documented Supabase RPCs or Edge Functions. See `docs/api.md` for:
- RPC signatures and roles
- Edge Function endpoints
- Error codes (e.g., `no_longer_available`)

## Testing

### Database Tests

```bash
npm run test:db
```

Runs all `supabase/tests/*.sql` (pgTAP format). Key tests:
- **RLS**: Users see only their own vehicles; search returns only published locations
- **Rates**: Quote hourly (40 * 3h = 120), flat-then-hourly, weekend rates, Monthly filter
- **Ledger**: Balance = charges - payments; waiver = negative charge; after waiver balance is 0
- **Concurrency**: First claim for last space succeeds, second gets `no_longer_available`; CHECK constraint prevents negative available_count

### Integration Tests (To Be Added)

- App → local Supabase RPC calls
- Search → get results → open detail → navigate
- Walk-in → start session → add charges → record cash → waive if balance remains → end

## Deployment

### Supabase Production

1. **Create Supabase project** (already exists: `pvxtdvyrqviuhhclbije`)
2. **Link repo**: `supabase link --project-ref pvxtdvyrqviuhhclbije`
3. **Push migrations**: `supabase db push`
4. **Deploy Edge Functions**:
   ```bash
   supabase functions deploy get-etas
   supabase functions deploy notify
   ```
5. **Set secrets**:
   ```bash
   supabase secrets set OPENROUTE_SERVICE_API_KEY=<ors-key>
   ```

### Android Build (EAS)

```bash
eas build --platform android --profile preview
```

Produces APK for internal testing (Google Play Console).

## Environment Variables

See `.env.example`:

- `EXPO_PUBLIC_SUPABASE_URL` - Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Public anon key
- `OPENROUTE_SERVICE_API_KEY` - (Edge Function secret) OpenRouteService API key for ETAs

## Notes

- **Money**: Always numeric(12,2) pesos, never floats
- **Coordinates**: PostGIS geography(Point), WGS84 (SRID 4326)
- **OSM Attribution**: Always shown on map (required by OpenFreeMap/OSM license)
- **Nominatim**: ≤1 req/s with identifying User-Agent, cached
- **Concurrency**: `claim_capacity` is the ONLY function that writes capacity; all check-ins/reservations call it
- **Waivers**: Recorded as negative folio_charges with note, who, when; excluded from revenue/payouts

## What's Next

**Immediate (complete Phase 1)**:
1. Implement app screens (search map, location detail, availability console, walk-in, chat, etc.)
2. Add MapLibre map components (native + web)
3. Wire Supabase RPCs to UI
4. Add Realtime subscriptions (availability, chat)
5. Implement image upload (Storage)
6. Add auth flows (phone OTP, Google)
7. Test on Android device with local Supabase

**Phase 2** (custom rates, slots, driver reviews):
- Slots mode with manual Reserved/Unavailable (slot-level locks)
- Custom rates editor with precedence preview
- Dimension-aware search (vehicle height/width/length vs. slot attributes)
- Operators review drivers (visible only in session/reservation context)

**Phase 3** (reservations):
- request_reservation RPC (calls claim_capacity, atomic hold)
- Approval flow (auto-confirm or operator approval)
- Reservation fee (15-min online hold or max_hold_min from booking for cash)
- Check-in, no-show auto-release, cancellation/refund policies

**Phase 4** (online payments):
- PaymentGateway interface + PayMongo adapter (GCash)
- Webhook Edge Function (idempotent, verified)
- Online reservation-fee checkout
- Manual payouts to Operator GCash

**Phase 5** (scale):
- Next.js operator web dashboard
- Google Maps adapter (optional, needs billing)
- iOS/App Store (if decided)
- Filipino language
- Analytics (PostHog), occupancy reports

## Support

For issues:
1. Check `supabase status` and Docker logs
2. Review migration errors in `supabase db reset` output
3. See test results in `npm run test:db`

---

**License**: Proprietary  
**Contact**: rj@wheretopark.ph
