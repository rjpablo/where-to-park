# Push notifications (Android, FCM V1)

🟧 Added for rj t173u (Nov 3, 2026). How push works in Where To Park, every step that was
taken to set it up, the real identifiers used, how to redo it for prod, and how to test it.

> **Secrets are not in this file** (it lives in the GitHub repo). For each secret this file
> says only where it lives. The values are in a private file rj keeps on his laptop
> (`push-credentials-private.txt`, see [Secrets](#secrets-where-they-live)).

## How it works

```
any RPC / trigger inserts a row into public.notifications
  └─ AFTER INSERT trigger  notifications_push  → public.push_dispatch_notification()
       (only if the recipient has a row in push_tokens)
       └─ public.push_webhook_post({notification_id})  → pg_net  net.http_post
            URL    = Vault secret  push_function_url
            header = x-push-secret: <Vault secret push_webhook_secret>
            └─ Edge Function  send-push  (verify_jwt = false, checks x-push-secret)
                 reads the row + the recipient's tokens with the service role (server only)
                 └─ POST https://exp.host/--/api/v2/push/send  (Expo push service)
                      └─ Firebase Cloud Messaging HTTP v1 (key uploaded to EAS) → device
                 sets notifications.pushed_at; deletes DeviceNotRegistered tokens;
                 saves ok tickets in push_tickets
pg_cron  push-receipts  (*/15)  → send-push {action:'receipts'} → Expo getReceipts
                                   → deletes DeviceNotRegistered tokens
pg_cron  refresh-overdue (every minute) → refresh_overdue() → "Scheduled end reached" rows
```

The app only registers / removes this device's **Expo push token** and handles taps.
It never sends pushes and never holds a service-role key.

## Types, recipients and switches (🟧 rj t176u, migrations 0073–0074)

rj's picks from the list of possible pushes (numbers are his). Each type has a switch on
**Admin › Push notifications** (table `push_settings`). Off = the in-app notification is still
created, only the push is skipped. A type with no row in `push_settings` (`fee_paid`,
`new_listing`, `approval_required`, `overdue`) is never pushed.

| # | Type | Event (where the row is made) | Recipients | Push default | Tap opens |
|---|---|---|---|---|---|
| 1 | `session_ended` | `end_session` → `notify_session_staff` | listing staff (owners, managers, staff on all listings or this one) | on | Session page |
| 2 | `session_extended` | `extend_session` → `notify_session_staff` | listing staff | on | Session page |
| 3 | `scheduled_end` | `refresh_overdue()` (cron `refresh-overdue`, every minute) | listing staff | **off** (not picked; switch kept) | Session page |
| 4 | `verification_needed` | `create_location` | every admin | on | Verification queue |
| 5 | `contact_submission` | `submit_contact` | every admin | on | the contact message |
| 6 | `chat_message` | trigger `chat_messages_notify` (people's text/photo messages; not system events) | driver writes → listing staff; staff writes → the driver. Never the sender | on | the chat thread |
| 7 | `reservation_request` | trigger `reservations_notify`: status becomes `pending_approval` | listing staff (not the driver) | on | the listing's hub |
| 9 | `no_show` | trigger `reservations_notify`: status becomes `no_show` | listing staff and the driver | on | staff: listing hub; driver: Location details |
| 10 | `report` | trigger `reports_notify`: a report on a **listing** | listing owner(s) and managers (the reporter isn't named; not the reporter) | on | the listing's hub |
| 11 | `listing_reviewed` | trigger `locations_notify_reviewed`: verified, or rejected | listing owner(s) (not the admin who did it) | on | My listings |
| 12 | `session_ending_soon` | cron `session-ending-soon` (every minute) → `notify_sessions_ending_soon()` | the driver linked to the session (`parking_sessions.driver_id`) | on | Location details |
| 13 | `reservation_decision` | trigger `reservations_notify`: status becomes `confirmed` or `declined` | the driver | on | Location details |
| 16 | `staff_added` | trigger `operator_members_notify`: a new manager/staff membership (`invite_staff`) | the person added | on | My listings |

Rules and decisions:

- **Chat burst control (6)**: a message makes a notification only if the recipient has no
  *unread* chat notification for that thread from the last **10 minutes**. A burst of messages
  is one push; a reply after 10 minutes (or after they opened the thread) pushes again.
  Opening a thread (`mark_thread_read`) now also marks its chat notifications read, so the
  Notifications count doesn't stay up for messages already read. Chat notifications also show
  in the Notifications list.
- **Ending soon (12)**: sent when an **active, started** session with a linked driver is within
  30 minutes of its End, once per End time (`data.end_epoch`). If the session is extended, the
  new End gets its own reminder when it is 30 minutes away. A session created with an End less
  than 30 minutes away is reminded at once. Sessions with no linked driver (all walk-ins today)
  get nothing.
- **Reservations (7, 9, 13)** are triggers on the `reservations` table. Nothing in the app
  writes that table yet (Phase 3), so these never fire today; they were tested by writing rows
  directly. Staff "reservations" (future-start sessions) have no request / confirm / decline
  / no-show step.
- **Recipients "listing staff"** = `listing_staff_ids(location)`: owners, managers, and staff
  assigned to all listings or to that listing (the same people `notify_session_staff` uses).
- Every row's `data` has `location_id` (where there is one) and `audience` (`driver` /
  `operator`), which `src/lib/notificationRoute.ts` uses to pick the screen.

Admin screen: `app/admin/push.tsx` (sidebar › Admin › **Push notifications**, admins only).
RPCs `admin_push_settings()` and `admin_set_push_setting(type, enabled)` refuse non-admins;
RLS lets only admins read `push_settings`; nobody writes it directly.

## Identifiers used (staging and the Android app)

| What | Value |
|---|---|
| Firebase / Google Cloud project ID | `where-to-park-513416` (the existing GCP project; Firebase added to it) |
| Firebase project number (FCM sender ID) | `556547607795` |
| Google Analytics for Firebase | Off |
| Firebase Android app | nickname "Where To Park Android", package `com.thebadcompany.wheretopark` |
| Firebase Android App ID | `1:556547607795:android:ff1fa32bdd4dc6ed9ebb86` |
| Cloud Messaging | Firebase Cloud Messaging API (V1) **Enabled**; Legacy API **Disabled** |
| Service account (FCM V1 key) | `firebase-adminsdk-fbsvc@where-to-park-513416.iam.gserviceaccount.com` |
| Service account key file (downloaded) | `where-to-park-513416-firebase-adminsdk-fbsvc-cf4f3797ba.json` (private; see Secrets) |
| `google-services.json` | committed at the repo root (no secret in it; Expo's docs commit it) |
| `app.json` | `expo.android.googleServicesFile: "./google-services.json"`; `expo-notifications` plugin (color `#2563eb`); permission `POST_NOTIFICATIONS` |
| Expo account / project | `the-bad-company` / `@the-bad-company/where-to-park`, project ID `811e8d6d-6c98-4307-9cca-f82f0c767a1a` |
| EAS credential | Android › `com.thebadcompany.wheretopark` › **Push Notifications (FCM V1): Google Service Account Key** = the service account above (uploaded Nov 3, 2026) |
| Supabase staging project | `ckspplijrygjlencrduw` (https://ckspplijrygjlencrduw.supabase.co) |
| Migrations | `20241029000072_push_delivery.sql`, 🟧 `20241029000073_push_settings.sql`, `20241029000074_push_events.sql` (applied to **staging only**) |
| Edge Function | **`send-push`** — `supabase/functions/send-push/` (`index.ts`, `lib.ts`), URL `https://ckspplijrygjlencrduw.supabase.co/functions/v1/send-push`, deployed with `--no-verify-jwt` (`[functions.send-push] verify_jwt = false` in `supabase/config.toml`) |
| Function secret | `PUSH_WEBHOOK_SECRET` (optional: `EXPO_ACCESS_TOKEN`, only if Expo "Enhanced push security" is ever turned on; not set) |
| Vault secrets | `push_webhook_secret` (same value as `PUSH_WEBHOOK_SECRET`), `push_function_url` (the function URL above; not secret) |
| Trigger | `notifications_push` AFTER INSERT ON `public.notifications` → `push_dispatch_notification()` (🟧 0073: only when the type's `push_settings` switch is on) |
| pg_cron jobs | `refresh-overdue` `* * * * *` → `SELECT public.refresh_overdue()`; `push-receipts` `*/15 * * * *` → `SELECT public.push_webhook_post('{"action":"receipts"}')`; 🟧 `session-ending-soon` `* * * * *` → `SELECT public.notify_sessions_ending_soon()` (0074) |
| Tables | `push_tokens` (0025; one row per device token, PK = token), `push_tickets` (0072; Expo tickets waiting for a receipt; RLS on, no client access) |
| RPCs | `register_push_token(p_token, p_platform)` (0025), `unregister_push_token(p_token)` (0072) |
| Extensions | `pg_net` (schema `extensions`, created by 0072), `pg_cron` (already on), `supabase_vault` (already on) |
| Android channel | id `default`, name "Notifications", importance HIGH |

## Secrets (where they live)

Never commit or paste these. Values: rj's private file `push-credentials-private.txt`
(made on the shared box at `/workspace/push-credentials-private.txt`, mode 600, for copying
to rj's laptop).

| Secret | Where it lives |
|---|---|
| Firebase service account private key (JSON) | Box: `/workspace/.fcm-service-account.json` (mode 600; the Downloads copy was deleted). EAS: uploaded as the FCM V1 key (EAS stores it; it can't be downloaded back). Google Cloud: IAM › Service accounts › `firebase-adminsdk-fbsvc@…` › Keys (key id starts `cf4f3797ba`). rj's private file |
| Push webhook secret (64 hex chars) | Box: `/workspace/.push-webhook-secret` (mode 600). Supabase staging: Edge Function secret `PUSH_WEBHOOK_SECRET` and Vault secret `push_webhook_secret`. rj's private file |
| Supabase service-role key | Only inside the Edge Function runtime (`SUPABASE_SERVICE_ROLE_KEY`, injected by Supabase). Not in the app, not in this repo |
| Expo robot token (`EXPO_TOKEN`), Supabase access tokens | Environment of the build box only (as before) |

## Steps taken (staging)

1. **Firebase project** (Firebase console, in the box browser, signed in with the Google
   account that owns GCP project `where-to-park-513416`): *Add project* → picked the existing Google Cloud
   project `where-to-park-513416` → Google Analytics **off**. Project number `556547607795`.
2. **Android app**: Project settings › *Add app* › Android → package
   `com.thebadcompany.wheretopark`, nickname "Where To Park Android" → App ID
   `1:556547607795:android:ff1fa32bdd4dc6ed9ebb86`. Downloaded `google-services.json`.
   (No SHA-1 is needed for FCM.)
3. **Cloud Messaging**: Project settings › Cloud Messaging: FCM API (V1) is Enabled; the
   Legacy API stays Disabled.
4. **Service account key**: Project settings › Service accounts › *Generate new private
   key* for `firebase-adminsdk-fbsvc@where-to-park-513416.iam.gserviceaccount.com`. Moved it
   to `/workspace/.fcm-service-account.json` (chmod 600) and deleted the Downloads copy.
5. **Upload the key to EAS** (Expo's push service uses it to talk to FCM):
   `EXPO_TOKEN=… npx -y eas-cli@latest credentials -p android` → build profile
   `production` → *Google Service Account* → *Manage your Google Service Account Key for
   Push Notifications (FCM V1)* → *Set up a Google Service Account Key for Push
   Notifications (FCM V1)* → path `/workspace/.fcm-service-account.json`. Result:
   "Uploaded Google Service Account Key. Google Service Account Key assigned to
   com.thebadcompany.wheretopark for FCM V1". The command is interactive only, so it was
   driven with a small `pexpect` script; the key is per application id, so every build
   profile of this package uses it.
6. **App config**: `google-services.json` committed at the repo root;
   `android.googleServicesFile: "./google-services.json"` in `app.json` (commit `7dbd9b1`).
7. **Webhook secret**: `openssl rand -hex 32 > /workspace/.push-webhook-secret` (mode 600).
   Set as the staging Edge Function secret `PUSH_WEBHOOK_SECRET` via the Management API
   (`POST /v1/projects/ckspplijrygjlencrduw/secrets`, body built from the file with `jq`,
   never echoed).
8. **Edge Function**: `SUPABASE_ACCESS_TOKEN=<staging token> npx -y supabase@2 functions
   deploy send-push --project-ref ckspplijrygjlencrduw --no-verify-jwt --use-api`
   (supabase CLI v3 refuses this repo's `config.toml` because of the old `[inbucket]`
   section, so v2 was used).
9. **Migration 0072** applied to staging with `/workspace/apply-mig-staging.sh` (records it
   in `supabase_migrations.schema_migrations`). It creates `pg_net`, `push_tickets`,
   `push_webhook_post`, the `notifications_push` trigger, `unregister_push_token`, the
   two cron jobs, and rewrites `notify_session_staff` so it no longer returns other staff
   members' push tokens to the app (it returns `push_tokens: []`, so 1.0.12 and older
   builds, which still try to send a push themselves, now send nothing).
10. **Vault** (SQL through the Management API, value read from the file, never printed):
    `vault.create_secret('<webhook secret>', 'push_webhook_secret', …)` and
    `vault.create_secret('https://ckspplijrygjlencrduw.supabase.co/functions/v1/send-push',
    'push_function_url', …)`. Until both exist the trigger does nothing (the inbox still
    works).
11. **App code** (commit `758e58a`): `src/lib/push.ts` (channel, permission, register /
    unregister), `src/components/PushNotificationsBridge.tsx` (taps, foreground refresh),
    `src/lib/notificationRoute.ts` (where a tap goes), `authStore` (unregister on sign-out,
    switch account, continue as guest). The client-side `sendExpoPush` /
    `deliverReturnedPush` calls in `app/staff/session.tsx` and `app/staff/sessions.tsx`
    were removed (commit `4c0aa49`).

## Push payload

```json
{
  "to": "ExponentPushToken[…]",
  "title": "<notifications.title>",
  "body": "<notifications.body>",
  "channelId": "default",
  "priority": "high",
  "sound": "default",
  "data": { "...notifications.data": "…", "notification_id": "…", "type": "scheduled_end",
            "ref_type": "session", "ref_id": "<uuid>" }
}
```

Session notifications also carry `data.location_id`. Where a tap goes
(`src/lib/notificationRoute.ts`): `ref_type = session` → `/staff/session?id=…`;
`contact_submission` → `/admin/contact-item?id=…`; `verification_needed` / `new_listing` /
`approval_required` → `/admin/verify`; `report` → `/admin/reports`; `chat_message` →
`/chat/<location_id>[?driverId=…]` (or `/operator/inbox`); `ref_type = location` →
`/location/<id>`; anything else → `/notifications`.

## When the app asks for permission

Once someone is **signed in** (the root layout calls `registerPushToken()` when the signed-in
user id changes). Guests are never asked. If the user picked "Don't allow" and Android says
it can't ask again, the app doesn't ask again (they can turn it on in Android settings; the
next sign-in / app start then registers the token). On Android 13+ the `default` channel is
created first, so the system prompt can show.

## Redo it for prod (`pvxtdvyrqviuhhclbije`) — only when rj says

Firebase, `google-services.json` and the EAS FCM key are per **app**, not per database, so
they are already done for prod. For the prod database:

1. Apply migrations 0034–0071 that prod is missing (see `docs/eas-build.md`), then
   `20241029000072_push_delivery.sql`, `…073_push_settings.sql` and `…074_push_events.sql`.
2. Make a **new** webhook secret for prod (`openssl rand -hex 32`); keep it out of git.
3. `supabase secrets set PUSH_WEBHOOK_SECRET=… --project-ref pvxtdvyrqviuhhclbije` (or the
   Management API secrets endpoint).
4. `npx -y supabase@2 functions deploy send-push --project-ref pvxtdvyrqviuhhclbije
   --no-verify-jwt --use-api`.
5. In the prod SQL editor:
   `select vault.create_secret('<prod secret>', 'push_webhook_secret');`
   `select vault.create_secret('https://pvxtdvyrqviuhhclbije.supabase.co/functions/v1/send-push', 'push_function_url');`
6. Check: `select jobname, schedule from cron.job;` shows `refresh-overdue`,
   `push-receipts` and `session-ending-soon`.
7. Switch the `production` profile in `eas.json` back to prod and build (push only reaches
   builds made after this feature — 1.0.13 or later).

## Testing

**Done on staging (Nov 3, 2026):**

- `send-push` refuses calls without / with a wrong `x-push-secret` (401), returns 404 for an
  unknown notification id, and `{action:'receipts'}` returns 200.
- End to end without a phone: inserted a test `push_tokens` row with a made-up Expo token
  and a test notification. The trigger → pg_net → `send-push` → Expo path ran:
  `net._http_response` = 200 `{"sent":1,"tickets":0,"removed_tokens":1}`,
  `notifications.pushed_at` was set, and the made-up token was **deleted** because Expo
  answered DeviceNotRegistered. Test rows were removed afterwards.
- `refresh-overdue` cron runs every minute (`cron.job_run_details` status `succeeded`).
- `register_push_token` → `unregister_push_token` removes the token; clients can't call
  `push_webhook_post` or read `push_tickets`.
- Unit tests: `supabase/functions/send-push/lib.test.ts`, `src/lib/notificationRoute.test.ts`
  (`npm run test:unit`). pgTAP: `supabase/tests/push_delivery.sql` (local DB).

🟧 **Per-type check (Nov 3, 2026, staging, rj t176u)**: with made-up tokens for sarah, juan,
ana and rj.admin re-added before each step, each event was triggered as the right test account
(or by writing `reservations` rows directly, since no flow writes them). A row was created for
every type with the expected recipients, and `pushed_at` was set (push sent to Expo) for every
type whose switch was on: session ended/extended (juan, ana), new listing (admin), contact
(admin), chat (sarah's 2 quick messages → one each for juan and ana; juan's reply → sarah),
reservation request (juan, ana), confirmed and declined (sarah), no-show (juan, ana, sarah),
report (juan), verified and rejected (juan), ending soon (sarah; a second run made none; +5 min
on the End made a new one), added as staff (sarah). With a switch off (scheduled end by default;
chat turned off for one message) the row was created and nothing was pushed. Non-admins get
"Permission denied" from both admin RPCs and see no `push_settings` rows. All test data was
removed afterwards (`/workspace/qa-sql/push_verify.py`, `push_cleanup.py` on the box).

**Needs a new Android build (not done; no build was requested):**

1. Build 1.0.13+ (`eas build -p android --profile production` or `preview`), install, sign
   in → the app asks to allow notifications → allow.
2. Check the token arrived: `select profile_id, platform, updated_at from push_tokens;`.
3. Send one: `insert into notifications (recipient_id, type, title, body) values
   ('<your profile id>', 'verification_needed', 'Test push', 'Hello');` — a banner should
   appear within seconds (app closed or open). Or use https://expo.dev/notifications with the
   token. Tap it → the Verification queue opens.
4. Session flow: as staff, extend a session → owners/managers/staff of that listing get
   "Session extended"; let a session pass its End → "Scheduled end reached" within a minute.
5. Sign out → the token row is gone; sign in as another account → the row moves to it.
6. Debug: `select status_code, content, error_msg from net._http_response order by created
   desc limit 5;` and the function logs (Supabase dashboard › Edge Functions › send-push).
