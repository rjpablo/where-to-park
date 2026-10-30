# EAS preview builds (Android)

How the Where To Park Android preview APK is built with EAS Build, starting
with 1.0.3. Earlier previews (1.0.0–1.0.2) were Gradle builds made on a cloud
agent; EAS uses the same signing key, so new builds install over them.

> No secrets live in this file. The Expo token, the keystore and its password
> are referred to by name and location only.

## Prerequisites

- Node.js (built on Node 24 with npm 11) and the repo dependencies installed (`npm ci`).
- `eas-cli` via `npx -y eas-cli@latest` (27.2.0 was used for 1.0.3). No global install is needed.
- An Expo account with access to the **the-bad-company** account. Builds are made
  non-interactively with an Expo access token in the `EXPO_TOKEN` environment
  variable (a robot token with the Admin role). Never commit or print it.
- Only to upload signing credentials again: the preview keystore and its password
  (see [Signing](#signing-credentials)).

## EAS project

| | |
|---|---|
| Owner (Expo account) | `the-bad-company` |
| Project | `@the-bad-company/where-to-park` |
| Project ID | `811e8d6d-6c98-4307-9cca-f82f0c767a1a` |
| Android package | `com.wheretopark.app` |

## Config changes

`app.json`:

- `expo.owner`: `"the-bad-company"`, needed because the build runs under a robot token.
- `expo.version`: `"1.0.3"` is the Android versionName.
- `expo.android.versionCode`: `4` (1.0.1 was 2 and 1.0.2 was 3).
- `expo.extra.eas.projectId`: `"811e8d6d-6c98-4307-9cca-f82f0c767a1a"` replaces the old
  placeholder `"where-to-park"`, which was not a valid EAS project ID.

`android/` is not committed (Continuous Native Generation), so EAS runs
`expo prebuild` and takes the version from `app.json`.

`eas.json`:

```json
{
  "cli": { "version": ">= 5.9.0", "appVersionSource": "local" },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "https://pvxtdvyrqviuhhclbije.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<public anon key, committed in eas.json>",
        "PUPPETEER_SKIP_DOWNLOAD": "1"
      }
    }
  }
}
```

- `appVersionSource: "local"` means the version and versionCode come from `app.json`, not EAS remote versioning.
- `distribution: internal` with `buildType: apk` produces an installable APK with an
  install link and QR code, not a Play Store bundle.
- `PUPPETEER_SKIP_DOWNLOAD=1` stops `npm ci` on the build server from downloading
  Chrome for the dev-only screenshot tooling.

`.gitignore` adds `credentials.json`, so local EAS credentials can never be committed.

## Environment variables

`app.config.js` reads `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
and the optional `EXPO_PUBLIC_MAP_STYLE_URL` into `expo.extra`. `src/lib/supabase.ts`
reads them from there or from `process.env`. For EAS builds they come from the
`env` block of the `preview` profile in `eas.json`:

- `EXPO_PUBLIC_SUPABASE_URL` is the hosted project, `https://pvxtdvyrqviuhhclbije.supabase.co`.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` is the hosted project's public anon key (JWT role `anon`). It is
  public by design and is embedded in every APK; row-level security protects the data.
  Do not put the service-role key, the Supabase access token or any other secret here,
  because `EXPO_PUBLIC_*` values are compiled into the app.
- `EXPO_PUBLIC_MAP_STYLE_URL` is unset, so the map uses OpenFreeMap liberty.

No EAS dashboard environment variables are used. The build log shows
"No environment variables … found for the preview environment on EAS".

## Signing credentials

The APK is signed with the existing preview keystore so it installs over 1.0.1 and 1.0.2.

| | |
|---|---|
| Type | PKCS12 |
| Key alias | `wheretopark-preview` |
| SHA-1 | `B4:03:43:93:6C:AC:95:EB:7E:DB:BA:36:EA:B2:C1:26:94:60:FF:68` |
| SHA-256 | `49:3E:FE:0F:CD:7C:72:3A:F4:D8:B9:B2:00:DC:48:1B:E0:CB:87:3A:63:85:EE:28:C4:77:E8:EC:42:45:B2:25` |
| Certificate | `CN=Where To Park Preview, OU=Preview, O=WhereToPark, L=Baguio, ST=Benguet, C=PH`, valid until 2054-03-16 |
| Keystore file | Agent store `bc-57ea3263-8c5a-51d2-acd9-44d1320450c5`, `keystore/where-to-park-preview.keystore` (on the shared box: `/cursor/stores/bc-57ea3263-8c5a-51d2-acd9-44d1320450c5/keystore/where-to-park-preview.keystore`). The bot's assets folder has a copy. |
| Password | `keystore/storepass.txt` in the same store folder. The store password and key password are the same. |
| On EAS | Uploaded as the Android build credentials **`where-to-park-preview` (Default)** for `com.wheretopark.app` |

The same SHA-1 must be registered on the Android OAuth client when Google sign-in is added.

### How the credentials were set up

The keystore was **uploaded to EAS**, so builds use remote credentials and nobody
needs the keystore file to rebuild:

1. A temporary `credentials.json` (git-ignored, file mode 600) was written in the project root:

   ```json
   {
     "android": {
       "keystore": {
         "keystorePath": "/cursor/stores/bc-57ea3263-8c5a-51d2-acd9-44d1320450c5/keystore/where-to-park-preview.keystore",
         "keystorePassword": "<from storepass.txt>",
         "keyAlias": "wheretopark-preview",
         "keyPassword": "<from storepass.txt>"
       }
     }
   }
   ```

2. `npx -y eas-cli@latest credentials -p android`, then:
   - Build profile: **preview**.
   - **credentials.json: Upload/Download credentials between EAS servers and your local json**.
   - **Upload credentials from credentials.json to EAS**.
   - Name: `where-to-park-preview`.

   The CLI answered "Keystore updated". The command is interactive, so it was driven by a small
   pexpect script; running it by hand works the same way.
3. `credentials.json` was deleted straight away.
4. To check: run `npx -y eas-cli@latest credentials -p android`, choose **preview**, and confirm that the
   configuration `where-to-park-preview (Default)` shows the alias and the SHA-1/SHA-256 above.

The keystore's alias and fingerprints were read with Python `cryptography`
(`pkcs12.load_pkcs12`), because the box has no `keytool`.
`keytool -list -v -keystore where-to-park-preview.keystore` shows the same values.

## Commands run for 1.0.3

All commands were run from the repo root with `EXPO_TOKEN` set in the environment.

```bash
npx -y eas-cli@latest --version          # eas-cli/27.2.0
npx -y eas-cli@latest whoami             # robot user, account the-bad-company (Admin)

# app.json: owner, version 1.0.3, versionCode 4, and the invalid projectId removed
npx -y eas-cli@latest init --non-interactive --force
#   created project 811e8d6d-6c98-4307-9cca-f82f0c767a1a. It could not write app.config.js
#   (dynamic config), so the projectId was added to app.json by hand, then:
npx -y eas-cli@latest init --non-interactive   # "Project already linked"
npx -y eas-cli@latest project:info             # @the-bad-company/where-to-park

# eas.json preview env + credentials.json (temporary), then the upload described above
npx -y eas-cli@latest credentials -p android

git commit …   # EAS archives the git working tree, so commit first
npx -y eas-cli@latest build -p android --profile preview --non-interactive --no-wait
```

The build log confirms "Using remote Android credentials (Expo server)" and
"Using Keystore from configuration: where-to-park-preview (default)".

## Bumping the version and rebuilding

1. In `app.json`, raise `expo.version` (for example `1.0.4`) and **always** raise
   `expo.android.versionCode` by 1 (to `5`, and so on). Android refuses an update with the same
   or a lower versionCode.
2. Commit the change.
3. Run `npx -y eas-cli@latest build -p android --profile preview --non-interactive --no-wait`
   with `EXPO_TOKEN` set, or log in with `npx eas-cli login` and drop `--non-interactive`.
4. Follow the build at the printed `expo.dev/.../builds/<id>` URL, or run
   `npx -y eas-cli@latest build:list -p android --limit 5`. A build usually takes 10–25 minutes,
   depending on the free-tier queue.

You don't need to touch the credentials again. EAS signs every preview build with
`where-to-park-preview`.

## Installing on the phone

Expo Go is not needed; this is a standalone APK.


- On the phone, open the build page
  (`https://expo.dev/accounts/the-bad-company/projects/where-to-park/builds/<id>`),
  sign in to Expo with an account that has access to `the-bad-company` if asked,
  and tap **Install**. You can also scan the build page's QR code with the phone camera.
- The **Expo app** (the Expo dashboard app for Android) lists the project's builds under
  the account. Open the build and tap **Install** to download the APK.
- Android asks you to allow installs from the browser or app the first time.
  Because the signing key matches, the APK installs **over** 1.0.2 and keeps your
  sign-in and data.

## Build history

| Version | versionCode | EAS build | Notes |
|---|---|---|---|
| 1.0.3 | 4 | [0f4441a0-abd3-43c4-b380-1f694510c367](https://expo.dev/accounts/the-bad-company/projects/where-to-park/builds/0f4441a0-abd3-43c4-b380-1f694510c367) | First EAS build, from commit `0748102`. Signed with `wheretopark-preview`. The universal APK is about 119 MB because it includes all ABIs. |
