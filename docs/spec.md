# Where To Park: Feature Specification

**Last Updated:** 30 Oct 2026

> **Revision colours:** 🟩 = added or changed on 30 Oct 2026 (preview 1.0.3–1.0.5 feedback). 🟦 = changed for preview 1.0.6 (30 Oct 2026, afternoon batch). 🟪 = changed for previews 1.0.7–1.0.8. 🟧 = changed after 1.0.8 (31 Oct 2026, not in a build yet).

## Overview

Where To Park is a mobile app for drivers in the Philippines to find parking with open space near them, and for Operators (from commercial lots to residents with vacant driveways) to publish their spaces, live availability, and rates, and to run day-to-day parking operations (walk-ins, chat, reservations, cash collection).

### Key Facts

- **Problem**: Drivers circle around not knowing which lots have space, fit their vehicle, or what they cost; Baguio's tight streets and tourist peaks make it worse.
- **Beta Market**: Baguio City
- **First Release Goal** (Phase 1, Android): Operators list spaces with photos, Monthly rates and a live slot count; drivers search on a map with a results sheet, sort and filter, see ETAs, navigate, read reviews and chat; staff run walk-in sessions paid in cash with the ledger, fees, overdue handling and chat.
- **Currency**: PHP (pesos, numeric(12,2))
- **Dimensions**: Centimeters
- **Language**: English only for now
- **Platforms**: Android first; web for preview; iOS deferred

## Architecture

- **App**: Expo (React Native + TypeScript), Expo Router
- **Backend**: Supabase (Postgres + PostGIS, Auth, Realtime, Storage, RPCs/Edge Functions)
- **Maps**: MapLibre (native: @rnmapbox/maps, web: maplibre-gl) on OpenFreeMap OSM tiles
- **Geocoding**: Photon (search-as-you-type), Nominatim (≤1 req/s, cached, with User-Agent)
- **Routing**: OpenRouteService Matrix API for drive-time ETAs (via Edge Function, cached, rate-limit aware, with straight-line fallback)
- **Payments (Phase 4)**: PayMongo (GCash), generic PaymentGateway interface
- **Principles**: API-first (every action is a documented RPC/Edge Function), cash-first, defaults tuned for hourly rates and slot counts, free map stack, one locked code path for every capacity change

## Account Types and Capabilities

| Account Type | How You Get It                                                                       | Can Do                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest        | No sign-in                                                                           | Search on map and results sheet, view locations, photos, rules, rates, reviews, see ETAs, tap Navigate                                                                                                                                                                                                                                                                                                                            |
| Driver       | Any signed-in user                                                                   | Save vehicles, review locations, report, start chat from any listing; reserve and see own balance (Phase 3)                                                                                                                                                                                                                                                                                                                       |
| Operator     | Creates an Operator profile (owner) or invited as manager                            | Locations, photos, rules, rates (incl. Monthly), fee presets, reservation settings, staff invites, payment/payout settings, waiver setting (Staff allowed or Operator-only), everything Staff can do                                                                                                                                                                                                                              |
| Staff        | Invited by Operator owner/manager; assigned to locations                             | For assigned locations: availability; mark Reserved/Unavailable; walk-in check-in; start/end overrides; end or extend; edit amount due; waive the remaining balance at close (with note), allowed by default unless the Operator restricts waivers to Operator-only; approve/decline reservations; record cash; add fees; review drivers; reply in chat threads for those locations. No rates, policies, payouts or staff invites |
| Admin        | Seeded first Admin is rj; only an existing Admin can create or promote another Admin | Verification queue (mark Verified), report and review moderation, hide chat messages, unpublish or suspend Operators, platform settings, payouts later, create or promote Admins                                                                                                                                                                                                                                                  |

**Operator Membership Roles**: owner, manager, staff (in `operator_members` table)  
**Admin**: Platform flag on `profiles.is_admin`, not an operator membership

## Core Features (Phase 1)

### F1. Operators, Locations, Areas, Availability

- Operators list spaces (commercial or residential) with exact map pin, address, optional rules
- Upload photo gallery (up to 10, reorder, pick cover; Storage)
- Name areas inside a location (B2, Left Wing) to group slots/rates
- Invite staff and assign them to locations
- Update availability in one tap: +1/-1, or mark Reserved/Unavailable

**Tracking Modes:**

| Mode            | Operator Updates                                                                                | Driver Sees                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Count (default) | +1/-1/set number; sessions adjust automatically; Reserved/Unavailable subtract from available   | N of M available + 'updated X ago' (warning style past threshold); pin shows N        |
| Open/Full       | One toggle                                                                                      | Open or Full + 'updated X ago' (warning style past threshold); pin shows Open or Full |
| Slots (Phase 2) | Each slot: available, occupied, or manually Reserved/Unavailable (optional note and until-time) | Count of slots that fit the selected vehicle, also on pin                             |

**Key Points:**

- Map pin picker with address search; stored as PostGIS geography(Point)
- Last status/count and 'updated X ago' always show; past Operator threshold (default 2h) styled as warning (e.g. amber)
- New listings publish as 'Unverified'; admins notified and verify after review
- Manual Reserved/Unavailable changes go through `claim_capacity` (same locked path as check-ins/reservations)
- 🟪 **Deleting a listing (app)**: The listing hub (My listings → a listing) shows a red **Delete listing** button at the bottom, for the operator's **owner** only (managers and staff don't see it). It opens a dialog that explains what deleting does, with a **Slide to delete** control and **Cancel**. Sliding to the end calls `delete_location`. If the listing still has active sessions or reservations, the dialog says so with the counts ('This listing still has 1 active parking session and 1 active reservation. End every active session and cancel every active reservation first, then try again.') and offers **Open the session board** for that listing (there is no reservations screen yet; Phase 3). On success the app goes to My listings and shows a green toast ''<name>' was deleted'. A deleted listing is gone from search, the map, My listings and the admin queue; opening it from an old link shows 'Listing not found' (details page and listing hub)
- 🟪 **Deleting a listing (server)**: `delete_location(p_location_id)` (SECURITY DEFINER, signed-in only). Only the operator's **owner** may delete (managers and staff get 'forbidden'). It takes the same row lock as `claim_capacity`, so it can't race a check-in, then refuses with `has_active` plus `active_sessions` / `active_reservations` counts while any session isn't ended or any reservation isn't finished (completed, cancelled, declined, expired, no-show; any other or future status counts as active). It is a **soft delete**: `deleted_at`/`deleted_by` are set and the listing is unpublished, but the row stays so sessions, folios, payments, reviews and chat keep their references. Deleted listings are left out of `search_nearby`, `get_etas`, the admin queue count and the My listings count in `get_sidebar_counts`, and the public read policy; `claim_capacity` refuses them (no new check-ins or reservations); owners/managers can't edit or un-delete them through the API. Operator members can still read the row, so names in their session and chat history still show

### F2. Parking Rates

- One default rate per location (editable, not deletable)
- Custom rates with any name, optional effective period, optional scope (area/slot/vehicle/days)
- Monthly rate alongside Hourly/Daily so drivers can filter by Monthly
- Rate preview tool shows which rate wins and why

**Rate Types:**

| Type                            | Operator Enters                            | Charged                                                             |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| Hourly (default)                | ₱ per hour                                 | Per started hour, minimum 1 hour                                    |
| Daily                           | ₱ per day                                  | Per started 24h from check-in                                       |
| Flat first N hours, then hourly | N hours, ₱ for them, ₱ per succeeding hour | Flat amount covers first N hours, then per started hour             |
| Monthly                         | ₱ per month                                | Shown on listing and used by Monthly filter; never prices a session |

**Rate Resolution Precedence:**

1. Custom beats default
2. Dated (effective period) beats indefinite
3. Slot > area > location scope
4. Vehicle-specific beats all vehicles
5. Specific days beat every day
6. Shorter period, higher priority, newest created

### F3. Driver Search, Map and Results Sheet

- Search around current location or a point on the map, no sign-in needed
- **Map pins**: Each shows available count (or Open/Full), net of held/reserved spaces; past stale threshold use warning style (e.g. amber outline); Full listings greyed
- 🟩 **Dense areas cluster**: Cluster bubble shows the **total available slots** of the listings inside it (sum of their counts; Open/Full listings add 0), not the number of listings, via MapLibre GeoJSON clustering with a summed cluster property. Tapping a cluster zooms in until all its pins are visible
- **Results sheet**: Same results as a list in a bottom sheet over the map, partly open by default (peek ~1/3 screen). Dragging the handle expands to nearly full screen or restores; map stays usable at peek
- 🟧 **Sheet title**: The results sheet is titled 'Search Result' (was 'Parking Locations')
- 🟩 **Results summary**: The top of the results sheet shows how many listings were found and their total available slots, e.g. '12 listings · 48 slots available' ('No listings found' when empty, 'Searching…' while loading). Open/Full listings count as listings but add no slots. It updates whenever the results change: filters, distance slider, sort, or 'Search this area'
- **List rows**: Cover photo, count/status, 'updated X ago' (warning style past threshold), starting rate, distance, ETA, rating, Residential/Unverified/Monthly tags
- 🟦 **Rating on cards**: Every result card shows the listing's rating as '★ 4.5 (12)' (average to one decimal, number of reviews); a listing with no reviews shows 'Not rated' in grey
- 🟩 **Stale indicator**: There is no 'Stale' text label anywhere (results list, listing details). A listing past its stale threshold shows only the warning style: the 'updated X ago' time turns amber (and the count badge and map pin turn amber)
- 🟩 **List row layout**: Nothing may run past the card on narrow screens. The status/details line wraps onto a second line when needed and ellipsizes (…) if it is still too long; the name and address are limited to 2 lines with an ellipsis
- **Sort**: distance (nearest first, default), price (starting rate for selected vehicle), rating, ETA, 🟪 'Open slots' (last; was 'Most slots' / 'availability'; most free first, behaviour unchanged)
- **Filters**: vehicle type, saved vehicle, 🟦 rate type (was the Monthly chip), Show Full
- 🟪 **Filter row layout**: left to right Vehicle, Rate, Show Full. The row wraps onto a second (or third) line on narrow screens so no chip is pushed offscreen; dropdown menus open normally from wrapped chips. Filtering behaviour unchanged
- 🟦 **Rate type dropdown**: The old 'Monthly' chip is now a 'Rate: All ▾' dropdown with 'All' plus every rate type in the `rate_type` enum: Hourly, Daily, Flat then hourly, Monthly. 'All' (default) means no rate-type filter; choosing a type shows only listings with an active rate of that type (search_nearby `p_rate_type`; the old `p_monthly_only` stays for older app builds). Choosing Monthly gives the same results as the old Monthly chip
- 🟦 **Vehicle dropdown**: The vehicle chip ('Vehicle: Car ▾') opens a list with 'All' plus each vehicle type (Car, SUV, Van, Motorcycle, Truck). It starts at the signed-in user's default vehicle's type, and at 'All' for guests or users without a default vehicle (re-applied on sign-in/out). 'All' means no vehicle filter. The chosen type is passed to search as the vehicle type (today that picks the rate used for the starting price)
- 🟧 **Filter pill text**: The Vehicle and Rate type pills no longer start with 'Vehicle:' / 'Rate:'. They show just the choice: 'All vehicles ▾' / 'All rate types ▾' when unfiltered (the 'All' option in each menu is named the same), or the picked value, e.g. 'Car ▾', 'Monthly ▾'. The menus keep their 'Vehicle' / 'Rate type' titles. Filtering is unchanged
- 🟦 **Full listings hidden by default**: Full listings (count 0, or Open/Full set to Full) are left out of results, pins and the summary by default. A 'Show Full' chip (off by default) includes them when turned on; it replaces the old 'Hide Full' chip. Note: 'hide full' keeps only count listings with spaces left and Open/Full listings set to Open, so Slots-mode listings (Phase 2) would also be hidden while Show Full is off
- 🟩 **Distance filter**: Slider from 0.5 km up to a max that follows the searched area: the distance from the search centre to the farthest corner of the visible map, rounded up to the next step (0.5 km steps below 10 km, then 1 km), never below 0.5 km and capped at 50 km. The max is recomputed every time a search runs, including 'Search this area'. 🟩 After every **new** search (the first search when the map opens, and 'Search this area', including after picking a place in the search box) the distance is set to the new max, so the whole visible map is searched; the driver can then slide it down. Changing filters or sort re-runs the same search and keeps the driver's value (lowered to the max if needed); only a new search resets it. Before the map reports its first viewport, the max is estimated from the opening zoom and the screen size. (3 km remains the starting value before the first search computes its max)
- 🟩 **Opening zoom**: The search map opens at zoom 13.25, just low enough that the farthest visible corner is at least 3 km from the centre on a typical phone (map area about 412×800 dp: ≈3.5 km), so the 3 km default distance is selectable at launch. On small phones (about 360×580 dp, ≈2.6 km) the max still rounds up to 3 km
- 🟩 **Current location**: The map shows a blue puck (dot with white ring and a soft halo) at the driver's current location, updated as they move (every ~10 m / 5 s). Location permission is asked once when the map first opens; if it is denied, a short dark message appears above the button for about 4 seconds ('Location permission denied. Tap ◎ to allow it…', or 'Turn it on in Settings' when Android won't ask again, or 'Can't get your location right now' when location is off) and the app keeps working around Baguio. A round ◎ button at the bottom-right of the map recenters the map on the driver (zoom 15, kept clear of the sheet); if permission isn't granted it asks again (or shows the message), and if the first fix isn't in yet it centers as soon as it arrives. Recentering doesn't search by itself: 'Search this area' appears so the driver can search there. The puck is drawn by our map abstraction (`userLocation` prop: a GeoJSON circle layer on Android MapLibre, a DOM marker on web), so another map provider only has to draw the same prop
- 🟦 **◎ button and the sheet**: The ◎ button never shows over the results sheet. It sits 16 dp above the sheet's top edge and moves with the sheet while it is dragged; when the sheet is raised so far that there is no room between the place search box and the sheet (e.g. expanded), the button fades out and ignores taps until the sheet comes back down. The location message, when shown, sits just above the button
- **Tapping** pin or list row opens listing details
- **State preservation**: Coming back from details restores camera, results, filters, sort, sheet position and list scroll; details open as stacked screen over mounted search screen; search-state store (e.g. Zustand) keeps state even if screen rebuilds

**Acceptance**: search_nearby works with anonymous key, returns results within radius ordered by distance in <500ms for a city-sized dataset; Monthly filter returns only listings with active Monthly rate; every pin shows its count or Open/Full and stale pins carry warning style; default list order is nearest first; changing sort/filters updates pins and list together; opening five listings in a row and returning keeps same camera/filters/sort/sheet position/scroll without new search

### F3b. Navigation and ETA

- **Navigate button** on listing details (and in pin card): opens Google Maps, Waze, or device's default maps app with destination coordinates; if several installed, driver picks once and can change in settings
- 🟦 **One Navigate button**: Listing details show a single button instead of separate Google Maps and Waze buttons. It uses the map app chosen on the Profile screen (`profiles.preferred_nav_app`, set only there; the details page never writes it): Google Maps → 'Navigate with Google Maps' (Google Maps directions URL, opens the app when installed); Waze → 'Navigate with Waze' (Waze URL); Phone default, not set, or guest → 'Navigate', which opens the phone's default map app with a `geo:LAT,LNG?q=LAT,LNG(Listing name)` URI on Android (the system chooser appears if there is no default), Apple Maps on iOS and Google Maps on the web. If nothing can open the link it falls back to the Google Maps URL
- 🟦 **Navigate goes to the listing's pin**: The destination is the listing's own coordinates (read from `locations.geog`, which arrives as hex EWKB). Before 1.0.6 the details page couldn't read that format and always sent drivers to a fixed point in central Baguio
- **ETA**: Drive time from driver's location shows on pins (on tap), list rows and details; ETAs from OpenRouteService Matrix API (free, OSM-based) through an Edge Function (key server-side)
- **Cost control**: ETAs fetched only for visible pins and top 20 list rows, batched into one matrix call, cached per origin (rounded to ~200m) and listing for 10min, refreshed when driver moves >500m
- **Rate limits**: On quota/rate-limit response, back off and show distance with straight-line estimate ('~6min'); sorting by ETA uses estimates where real ETAs missing
- **Out of scope**: In-app turn-by-turn navigation (possible future item, Phase 5)

**Acceptance**: Navigate opens chosen maps app at exact pin; ETAs appear for visible results within 2s on normal connection; panning map does not call routing >1x per 2s; hitting rate limit never blocks search, shows estimates instead

### F4. Saved Vehicles

- Drivers save vehicles: nickname, plate (optional), type, height, width, length; mark one as default
- Selecting a vehicle filters search: type must match; in slots mode, slot max clearance/width/length must be ≥ vehicle's (Phase 2)
- Locations without slot attributes show 'size limits not listed' rather than hidden
- Guests pick vehicle type for current search only

### F5. Sessions, Walk-ins and Additional Fees

- **Walk-in check-in**: Vehicle type (required; can determine applicable rate), plate (required), optional note. No driver account needed. Clock starts now, count drops by one; if last space just taken, see 'no longer available'
- **Scheduled end**: Can set expected end for walk-in; reservations bring their own
- **Start/end overrides**: Operator/staff can override session's start or end time (e.g. driver arrived earlier); each override records who, when, why; fee recalculated
- **Overdue**: At scheduled end, Operator and staff get notification, session shows as Overdue; stays occupied until someone taps End or Extend. Active sessions never released automatically
- **Overdue time**: Calculated and shown (e.g. 'Overdue 1h 20m, +₱50 if billed'), but amount due still runs to scheduled end. Operator/staff can move billed end time or edit amount due, with reason
- **Extend**: Sets new scheduled end after checking no collision with upcoming reservation for that space
- **Fee presets**: Save presets (e.g. 'Overnight parking ₱100', 'Lost ticket ₱50'), apply to session/reservation with editable amount, or add one-off fee
- **Ending session**: Shows fee, extra charges, payments so far, balance, with cash prefilled for collection. Closing with balance still owed shows alert and requires note; remaining amount posted as Waived ledger entry (amount, note, who, when), balance becomes ₱0

**Acceptance**: Nothing frees an active session's space automatically; ending session in count mode adds one back; fee preset can be reused; every charge/override in audit log; overdue time never raises amount due unless staff change end time or amount; closing with non-zero balance without note is blocked; after waiver folio balance is exactly ₱0.00 and waiver shows who and when

### F6. Reservations (Phase 3)

[Deferred to Phase 3 - see full spec in repo]

### F7. Payments and Ledger (Cash First)

- Every reservation and walk-in session has one folio: charges (parking fee, additional fees, adjustments, waivers as negative entries) and payments (cash or online, refunds as negatives). Balance = charges − payments
- In every payment step, Operator/staff can tap 'Record cash' with any amount; partial payments allowed, balance updates
- Reservation fee can be recorded as cash instead of waiting for online 'paid' webhook; online and cash can be mixed on one folio
- Marking reservation paid records cash entry for the amount and stops its maximum-hold timer
- Editing amount due posts adjustment charge with reason, so ledger keeps history
- **Closing with non-zero balance**: UI alerts and requires note, then posts 'Waived' entry for exactly the remaining amount with note, who waived, when. Balance becomes ₱0, folio settled. Waivers not revenue, excluded from collections and payouts
- **Who can waive**: Staff by default; each Operator can restrict waivers to Operator-only. When restricted, Staff see 'Ask an Operator to waive' and session stays open
- **First release**: Cash only; listings show 'Cash'. Folio and PaymentGateway interface (createPayment, getPayment, refund, verifyWebhook, parseWebhookEvent) are provider-agnostic, so PayMongo adapter for GCash plugs in at Phase 4 without schema changes
- **Online payments (Phase 4)**: Platform collects, 0% beta commission, manual payouts to each Operator's GCash number, webhooks verified and processed idempotently by event id
- **All amounts**: numeric(12,2) pesos; only percentage results rounded (half up, to centavo)
- **Shift cash summary** per staff: cash recorded, refunds, sessions closed, waivers (count, total, notes)

**Acceptance**: Folio balance always = charges - payments; recording ₱100 cash against ₱235 folio leaves ₱135 due; each cash entry stores who/when; closing with balance without note rejected; waiver equals remaining balance exactly, can't exceed it; waivers never appear as cash; with waivers restricted, Staff waiver attempt refused; replaying webhook (Phase 4) changes nothing

### F8. Reviews (Locations and Drivers)

- Any signed-in user rates a location 1–5 stars with optional comment; one review per user per location (editable)
- Reviews tied to completed reservation/session show 'Booked via app' label
- Operators reply publicly once; anyone signed in can report a review; Operators and their staff cannot review their own locations
- Operators and staff rate a driver 1–5 with optional comment, tied to reservation/session with linked driver account
- Driver's reviews, from all operators, readable only through an open/recent reservation/session with that driver; no driver list, profile page or search
- Rate limits on new reviews; reported reviews go to Admin queue and can be hidden

**Acceptance**: Guest must sign in before reviewing; location average updates immediately, ignores hidden reviews; no endpoint returns driver reviews without a reservation/session id the caller's operator owns

### F9. Operator–Driver Chat

- Drivers can start chat from any listing before booking (one thread per location and driver)
- 🟧 Operators and staff (members of the listing's operator) can reply once the driver has written in the thread, or at any time when that driver has a reservation/session at one of their locations; they can't send the first message to a driver without one (was: replies needed a reservation/session too, so pre-booking questions got 'Permission denied'). Same rule for text and images (`operator_can_message_thread`)
- Chat replaces showing contact number or Request info button
- Text and image messages; images go to private Storage bucket, resized and EXIF-stripped, visible only to thread members
- **In Phase 1**: History shows session system events inline (session started, extended or ended, payment recorded, fee added, balance waived)
- **Reservation events** (made, approved, declined, fee paid) added when reservations ship in Phase 3
- Push notification and unread badge for new messages; report a message/image to Admin queue
- 🟧 **Messages list rows**: Each row shows the other person (driver's display name for operators, listing name for drivers; before, operators saw 'Driver' for everyone and review authors showed as 'Anonymous', because the name came back as a list the screens didn't read), a one-line preview of the newest message ('You: …' for my own, '📷 Photo' for images), and the listing · time. The name and preview are **bold only while the thread has unread messages for me** (same rule as the unread badge: not read yet, not a system event or hidden, sent by someone else, and on the operator side sent by the driver); otherwise both are normal weight. Opening the thread marks it read, and the row turns normal on the next refresh (every 2 s)
- Operators still cannot browse or search drivers; they only see threads that already exist (driver-started from listing, or auto-created when reservation/session links that driver)

**Acceptance**: Only thread members can read messages/images; driver signed in can start thread from any published listing; Operator/staff cannot send first message to driver with no reservation/session; each relevant state change appears in thread once, in order; reported image can be hidden by Admin

### Verification, Trust and Notifications

- New listings publish as Unverified (visible with badge); notification to every admin (push and email), listing enters verification queue
- Admin reviews pin, photos, details and marks Verified, or unpublishes. Changing pin or listing type later sets back to Unverified
- 🟩 **Reject from the queue**: Each queue card has Verify and Reject. Reject opens an optional reason (max 500 characters, shown to the operator) and a Confirm reject button. Rejecting unpublishes the listing, records who/when/why (`reject_location` RPC, admins only) and removes it from the queue at once. The operator's My listings shows a red 'Rejected' badge with the reason and a 'Resubmit for verification' button (owners/managers); resubmitting publishes it again, clears the rejection and puts it back in the queue. Verifying always clears an earlier rejection
- Drivers report listing as 'actually full', 'closed', 'doesn't exist', 'unsafe', 'wrong info'; several reports in short window flag it and notify Operator
- Notifications are rows in notifications table plus push: new listing (admins), reservation request, fee paid, scheduled end and overdue, no-show released, reports, chat messages

## Last-Space Protection (Concurrency)

Two drivers cannot reserve the last space at the same time. Every capacity change goes through one database function that takes a row lock, so concurrent requests run one after another and only the first can take the last space.

### Steps

1. **One function**: `claim_capacity(location, slot?, start, end, kind)` is the ONLY way to take capacity. `request_reservation`, `start_walk_in`, `check_in_reservation`, `set_manual_counts`, `set_slot_status` all call it; app never writes counts directly
2. **Lock first**: Inside one transaction it runs `SELECT ... FOR UPDATE` on the location availability row (count mode) or slot row (slots mode). Second request for same location/slot waits until first commits or rolls back
3. **Check capacity**: Free = capacity − active sessions − overlapping holds and reservations (awaiting_payment, pending_approval, confirmed) − manual Reserved − Unavailable. In slots mode, slot must be available and have no overlapping hold
4. **Create hold or session**: If free ≥ 1, insert reservation/session in same transaction and commit. Otherwise raise 'no_longer_available'; app shows 'This space was just taken' and refreshes results
5. **Excluded immediately**: New hold counts against availability for everyone (search, pins, walk-ins, other reservations) until it is paid, converted to session, cancelled, declined, or hold expires. `release_capacity` runs under same lock
6. **Backstops**: CHECK constraint keeps available ≥ 0 in count mode; in slots mode an exclusion constraint on (slot_id, time range) for active holds makes overlapping insert fail even if code path forgot lock

**Acceptance**: 50 parallel request_reservation calls for one remaining space produce exactly 1 hold and 49 'no_longer_available'; walk-in and reservation racing for last space yield exactly one success; manual Unavailable mark never makes available negative; search never shows held space as available

## Data Model Summary

**Key Tables:**

- `profiles` (extends auth.users): display_name, phone, is_admin, preferred_nav_app
- `operators`: display_name, status, staff_can_waive (default true)
- `operator_members`: operator_id, profile_id, role (owner/manager/staff), location_ids[]
- `locations`: geog Point (PostGIS), address, tracking_mode, capacity, available_count (CHECK ≥ 0), availability_updated_at, stale_after_min, published, verification_status
- `location_photos`: storage_path, is_cover, sort_order
- `areas`, `slots` (Phase 2), `rates`: is_default, rate_type, amounts, effective period, scope, priority
- `vehicles`: driver_id, nickname, plate, vehicle_type, dimensions, is_default
- `parking_sessions`: location_id, driver_id?, plate, vehicle_type, started_at, scheduled_end_at, ended_at, status, rate_snapshot
- `reservations` (Phase 3): location_id, driver_id, vehicle_id, start_at, end_at, status, hold/max_hold expires_at, quote_amount, fee_due_amount, rules_ack_at
- `folios`: operator_id, location_id, session_id?, reservation_id?, status (open/settled)
- `folio_charges`: folio_id, type (parking_fee/additional_fee/adjustment/waiver), amount (negative for waiver), note (required for waiver), added_by, created_at
- `payments`: folio_id, direction (payment/refund), amount, method (cash/gcash/...), recorded_by
- `chat_threads`, `chat_messages`: thread_id, sender_id?, kind (text/image/system), body, image_path, event_type, hidden
- `eta_cache`: origin_cell (~200m grid), location_id, duration_s, distance_m, source (ors/estimate), fetched_at (10-min TTL)
- `notifications`, `reports`, `platform_settings`, `availability_events`, `booking_events`
- 🟩 `attention_triggers`: key, enabled (default true), description — which conditions light the sidebar badge (edited in SQL only); `locations.review_seen_at` (owner saw the verify/reject outcome), `locations.rejected_at/rejected_by/rejection_reason`; `chat_messages.read_at` is now set when the recipient opens the thread

**Money**: Always numeric(12,2) pesos, never floats  
**Balance**: Computed from ledger: charges (waivers are negative) − payments

## Onboarding and UI Defaults

**Operator Onboarding (5 steps):**

1. Your space: name, listing type, exact pin on map, optional photo gallery and rules
2. How many spaces: Count mode preselected (enter capacity once); Open/Full and Slots are secondary options
3. Your rate: Hourly preselected (one '₱ per hour' field); Daily, Monthly, 'Flat first N hours, then hourly' behind 'Other rate types'; adding Monthly rate is enough for driver Monthly filter
4. Payments: Cash preselected (only option in first release); no setup needed
5. Publish: Goes live as Unverified; reservations stay off until switched on, approval defaults to auto-confirm when they are

**UI Defaults:**

- 🟧 **No repeated screen titles**: The header bar (title next to Back) is the only title. Screens no longer repeat it as a big heading in the body: Messages (also drops the 'Signed in as …' line), Saved vehicles (also drops 'Signed in as …'), Notifications, My listings, List your space, Edit location, Areas and rates, Fee presets, Staff, Availability, Check in, Active sessions, Verification queue and Moderation. Useful lines under the old heading stay (listing or operator name, 'N pending', 'N active', 'Step N of 5', 'Spaces you own or staff', sign-in prompts). Body headings that name something else (a listing's name on its details and hub screens, the listing name in a chat, your name on Profile) stay
- 🟪 **Slide to confirm**: A reusable `SlideToConfirm` control for destructive actions: a rounded track with a label ('Slide to delete ››') and a round knob the user drags all the way to the right. Releasing at 90% or more of the track confirms (the knob snaps to the end and shows ✓, or a spinner while the request runs); releasing earlier springs it back. A parent ScrollView can't steal the drag. Screen readers get an 'activate' action instead of dragging. The screen that uses it always offers Cancel next to it
- **Availability console**: Big +1/-1 buttons and count front and center; staff home screen
- **Reserved/Unavailable**: Two small steppers under count in count mode, or long-press on slot in slots mode
- **Check in walk-in**: Vehicle type and plate required, note optional; starts now; rate follows vehicle type
- **End session**: Shows started hours × hourly rate, extra fees, balance; 'Record cash' primary button with full balance prefilled and editable for partial payments. Overdue time shown separately and only billed if staff change end time or amount. If balance remains, alert requires note before End succeeds, remainder shown as 'Waive ₱X' (Staff allowed by default)
- **Any payment prompt**: Defaults to Cash with balance prefilled
- **Driver side**: Search opens on map with results sheet at peek, sorted nearest first; pins show counts; last count always shows with 'updated X ago', turning amber past threshold on list and pins
- 🟩 **Back to exit (Android)**: On a root screen (nothing to go back to), the first hardware Back shows a 'Press back again to close the app' toast; a second Back within 2 seconds closes the app. Screens with history keep normal Back navigation
- **Chat**: Message button on every location detail for signed-in drivers; Operators see inbox of existing threads only
- 🟦 **Messages screen**: No navigation button bar at the top (the old 'My listings'/'Listing'/'Home' buttons); the header Back and the sidebar handle navigation
- 🟦 **Conversation cards**: Each card in Messages has no 'Open' button; tapping anywhere on the card opens that conversation
- 🟩 **Sidebar (menu)**: 🟦 A ☰ toggle in the screen header, left of the 'Find Parking' title (not floating on the map), opens a collapsible drawer from the left (about 85% of the screen, max 320 dp). It closes with ✕, a tap on the dimmed backdrop, Android Back, or by choosing an item. It replaces the buttons that used to be on the Profile screen (and the 'My listings'/'Profile'/'Sign in' links in the results sheet). Items, role-appropriate, in this order:
  - Guest: **Sign in** only
  - Signed in: **My profile**, **Messages** (chat threads; drivers see their threads by listing name, operators by driver), **Notifications**, then **My listings** (operator accounts, members of an operator and admins) or **List your parking space** (everyone else; switches the account to operator and opens onboarding), **Saved vehicles**; admins also get an **Admin** section with **Verify listings** and **Moderation queue**; **Sign out** is pinned at the bottom
  - **Each item shows its own count** as a pill (hidden at 0, '99+' above 99): Messages = unread messages for me, Notifications = unread notifications, My listings = unseen verify/reject outcomes when there are any, otherwise the number of listings I own or staff, Saved vehicles = number of vehicles, Verify listings = queue size, Moderation queue = pending reports, My profile = '!' when the profile is incomplete. A pill is red when its count is one of the enabled badge triggers below, grey when it is just informational
- 🟩 **Attention badge**: The ☰ toggle in the header shows a red dot when anything needs attention: unread messages, unread notifications, pending verifications (admins), one of my listings was verified or rejected and I have not seen it yet (seen = I opened My listings after the outcome; owners/managers only), or my profile is incomplete (display name blank, 'New user', my phone number or an email address). Which of these light the badge is configured **in the database only** (table `attention_triggers`, one row per trigger with `enabled`, all enabled by default; no UI): e.g. `update attention_triggers set enabled = false where key = 'unread_notifications'`. Keys: `unread_messages`, `unread_notifications`, `pending_verifications`, `listing_reviewed`, `profile_incomplete`. Counts come from one RPC, `get_sidebar_counts()`, refreshed when the map gains focus, on sign-in/out, every 60 s while the map is on screen, when the drawer opens, and right after something is read (opening a chat thread marks its messages read via `mark_thread_read`; 'Mark read' on a notification; opening My listings marks outcomes seen via `mark_listing_reviews_seen`)
- 🟩 **Profile screen**: Shows name, account type, phone and admin flag, a **Your name** field with Save (a red hint appears while the profile is incomplete) and the preferred maps app; everything else lives in the sidebar
- 🟦 **Maps app setting**: On the Profile screen the preferred maps app is a dropdown ('Maps app: Google Maps ▾') with Phone default, Google Maps and Waze (same dropdown component as the vehicle and rate filters), replacing the three buttons. Picking an option saves `profiles.preferred_nav_app` right away ('Preferred maps app saved'); this is the only place it is set
- **Lost the race**: If reservation/check-in loses race for last space, screen says 'This space was just taken' and refreshes
- **Custom rates, slots, reservations, fee presets**: Reachable but never block basic setup

## Implementation Plan

### Phase 0: Project Skeleton (Completed)

- ✅ Expo + TypeScript app, Expo Router, lint/format, EAS Android build profiles
- ✅ Link Supabase project pvxtdvyrqviuhhclbije; CLI migrations in repo, local dev stack, seed script with Baguio sample data
- ✅ CI: typecheck, tests, migration check, API contract tests on every PR
- ✅ Design tokens, base components, peso formatter for numeric(12,2) values, English only
- ✅ Sentry, env config, feature flags for later-phase features
- ✅ MapProvider + Geocoder: MapLibre (@maplibre/maplibre-react-native, Expo Android dev build) on OpenFreeMap OSM tiles, Photon/Nominatim, OSM attribution
- ✅ API conventions: every action is an RPC or Edge Function, documented in docs/api.md, with generated TypeScript types
- ✅ Account types and RLS helpers: Driver, Operator, Staff, Admin; seed rj as first Admin

### Phase 1: First Release (Android)

**Goal**: Operators list spaces with photos, Monthly rates and a live slot count; drivers search on a map with a results sheet, see drive-time ETAs, navigate and chat; staff run walk-in sessions paid in cash with the ledger, fees, overdue handling and chat.

**Tasks (1.1–1.22)**: Auth, operator profile, staff, location CRUD with photos, verification, areas, availability, rates CRUD, vehicle garage, search_nearby RPC, location detail, reviews and ratings, walk-in sessions, folio ledger, fees, overdue, operator–driver chat, notifications, admin moderation, RLS/API tests, claim_capacity concurrency, search map UI (pins, clustering, bottom sheet), navigation and ETA Edge Function

**Milestone**: M2 Run the lot in cash, with chat (first release); Baguio closed beta on Play internal testing

### Phase 2: Precise Fit and Pricing

Custom rates, slots, dimension-aware search, driver reviews

### Phase 3: Reservations

request_reservation, approval, reservation fee, check-in, no-show, cancellation/refunds

### Phase 4: Online Payments

PayMongo (GCash), webhooks, online reservation-fee checkout, manual payouts

### Phase 5: Scale

Next.js web dashboard, Google Maps adapter (optional), iOS/App Store (if decided), Filipino language, analytics, occupancy reports, gate/sensor integrations

## Risks and Mitigations

| Risk                                           | Mitigation                                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stale availability erodes trust                | Last update time always shown, warning style past threshold on list and pins, driver reports, one-tap staff console                                                                                        |
| Spaces stay 'occupied' because nobody taps End | Overdue list, repeated reminders, overdue time shown for staff to bill, count freshness warnings                                                                                                           |
| Unpaid reservations tie up spaces              | Operator-set maximum hold from booking with auto-cancel; no-shows released automatically                                                                                                                   |
| No operators yet in Baguio                     | Hands-on onboarding; residential listings widen supply; free for operators in beta                                                                                                                         |
| Fake or misleading listings                    | Unverified badge until admin review, reports, reviews, unpublish/suspend; facility photos help reviewers                                                                                                   |
| Safety of residential hosts with exact pins    | No public phone numbers, optional rules, approval-required option, report 'unsafe', chat instead of public contact                                                                                         |
| Cash handling errors or leakage                | Every cash entry tied to staff member; shift cash summary; voids, amount-due edits and waivers (amount, note, who, when) audited, never deleted                                                            |
| Waivers used to hide pocketed cash             | Required note, waivers listed per staff in shift summary, Operator can restrict waivers to Operator-only (Staff allowed by default)                                                                        |
| Double booking the last space                  | Every capacity change through claim_capacity with SELECT ... FOR UPDATE; CHECK and exclusion constraints as backstops; concurrency tests in CI                                                             |
| Review abuse                                   | One review per account, rate limits, reporting, 'Booked via app', driver reviews only in context                                                                                                           |
| Chat abuse or unsafe images                    | Members-only threads, report message, rate limits, admin hide, EXIF stripping; Operators cannot cold-message drivers                                                                                       |
| Routing quota or outage (ORS free tier)        | ETAs only for visible/top 20, one batched matrix call, 10-min cache, debounce on pan, back-off on rate limits, straight-line estimate fallback; self-host OSRM if volume grows                             |
| ETA accuracy in Baguio traffic                 | Label as drive time without live traffic; Navigate hands off to apps with live traffic                                                                                                                     |
| Map clutter and slow rendering with many pins  | Clustering, virtualized list, pins rendered from one GeoJSON source                                                                                                                                        |
| Data Privacy Act (RA 10173)                    | Privacy notice, minimal location retention, consent, EXIF stripping, driver reviews access-limited, chat images private to thread members; ETA origins rounded to ~200m and kept only in short-lived cache |

---

**For complete implementation details, see README.md and docs/api.md. All Phase 1 database migrations, RLS policies, RPCs, tests, and Edge Functions are in the `supabase/` directory.**
