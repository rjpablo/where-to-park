# Google sign-in (rj t146u)

## Flow

1. The app calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } })` (or `linkIdentity` for **Link Google**). The client uses `flowType: 'pkce'`, so the URL carries a S256 code challenge and the verifier stays in the app's storage.
2. **Web:** full-page redirect to Supabase → Google → Supabase callback → `https://<host>/oauth-callback?code=…`. The `oauth-callback` route exchanges the code (`exchangeCodeForSession`), removes it from the address bar and routes on: a new account goes to onboarding (`/auth?complete=1`, name prefilled from Google), Link Google goes back to Profile, everyone else to Search.
3. **Android (dev build, preview/production APK):** `expo-web-browser` `openAuthSessionAsync(url, 'wheretopark://oauth-callback')` opens a Custom Tab. Google returns to the Supabase callback, which redirects to `wheretopark://oauth-callback?code=…`. The app exchanges the code. If Android also delivers the deep link to the router, `/oauth-callback` sees the pending session and just waits; a code is never exchanged twice. Expo Go is not supported (its `exp://` redirect isn't allow-listed).
4. **Account switching:** before Google sign-in (also from **Add account**) the current session is saved like the phone flow does, so the other accounts stay signed in and switching back is instant. The new session is saved as an account on success.

Code: `src/lib/googleAuth.ts` (start and finish), `src/lib/oauthCallback.ts` (pure URL parsing and error messages, unit tested), `app/oauth-callback.tsx`, `src/stores/authStore.ts` (`signInWithGoogle`, `completeOAuth`), `src/screens/AuthScreen.tsx` (button), `app/profile.tsx` (Link Google).

## Linking design ("link them")

- **Automatic (server, Supabase Auth):** a Google sign-in whose verified email matches an existing account's confirmed email lands in that account.
- **Existing phone accounts:** they have no auth email, and there is no profile email field. They use **Profile → Link Google** while signed in (Supabase manual linking). From then on, Continue with Google opens the same account.
- **Guard (0069, trigger on `auth.identities`):** an OAuth identity is refused when the provider didn't verify its email, when the email belongs to another account (auth email or another account's identity), or when the target account holds that email unconfirmed. An unverified email typed anywhere can't attract someone else's Google sign-in. This also closes the reported Supabase gap where a manually linked identity with an unverified email becomes an automatic-linking target.
- **Profile for new Google users:** Google name (confirmed in onboarding) and picture (`profiles.avatar_url`). No phone: `profiles.phone` is optional and nothing requires it.

Tests: `supabase/tests/google_sign_in.sql` (simulated GoTrue rows), `src/lib/oauthCallback.test.ts`.

## Configuration

Staging (`ckspplijrygjlencrduw`), set through the Management API `config/auth`:

- `external_google_enabled = true`
- `external_google_client_id` = the web client, then the Android client
- `external_google_secret` = the web client secret (never committed; kept on the dev box only)
- `uri_allow_list` += `wheretopark://**`, `https://where-to-park.expo.app/**`, `https://where-to-park--*.expo.app/**`, `http://localhost:19006/**`
- `security_manual_linking_enabled = true` (Link Google)

Prod checklist (not done):

1. Apply migration 0069.
2. Make the same config/auth change on prod; the prod callback is already a redirect URI on the web client.
3. Set `site_url` to `https://where-to-park.expo.app` (staging still has `http://localhost:3000`; it's only used when a redirect isn't allow-listed).
4. Publish the OAuth consent screen (Testing → In production). While it's in Testing, only listed test users can sign in. The `email profile` scopes are non-sensitive, so no Google verification is needed beyond branding.

Android: the browser flow uses the **web** client. The Android OAuth client (package + SHA-1) is only needed for a future native Google Sign-In (`signInWithIdToken`), and then each signing key's SHA-1 (preview and the Play app-signing key) needs its own client entry. The `wheretopark` scheme is already in `app.json`. Any APK built after this change includes it; `expo-web-browser` is already a dependency.
