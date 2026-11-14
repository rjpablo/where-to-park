# Where To Park — documentation

All documentation asked for during development lives in this folder
(`docs/` in the repo). On a Windows checkout that is
`C:\Development\where-to-park\docs`. Copies are sometimes also placed under
`C:\Users\RJ\Downloads\where-to-park-docs` for quick reading without opening the repo.

| File | What it is |
|---|---|
| [spec.md](./spec.md) | App product/spec. Changes since 1.0.8 are marked 🟧. |
| [api.md](./api.md) | Server calls (RPCs, tables, policies) the app uses. |
| [eas-build.md](./eas-build.md) | EAS project, build profiles, staging vs prod env, package id, keystore notes. |
| [google-sign-in.md](./google-sign-in.md) | Google OAuth clients, redirect URLs, auth config on staging/prod. |
| [push-notifications.md](./push-notifications.md) | Push setup steps and the Firebase / EAS / Supabase identifiers used. Secrets stay off the repo. |
| [applying-migrations.md](./applying-migrations.md) | How to apply `supabase/migrations/` to staging (and later prod): Management API method used by the bot, CLI alternative, 0007 exclusion, verification and failure rules. |

## Related (not in this folder)

- Repo root [README.md](../README.md) — project overview and local Docker setup.
- Private credentials file on the laptop (not in git):
  `C:\Users\RJ\Downloads\push-credentials-private.txt`
  (FCM service account JSON path notes, webhook secret, etc.).

## Environments (short)

| | Staging | Production |
|---|---|---|
| Ref | `ckspplijrygjlencrduw` | `pvxtdvyrqviuhhclbije` |
| Web | https://where-to-park.expo.app | — |
| Token env var (name only) | `SUPABASE_STAGING_ACCESS_TOKEN` | `SUPABASE_ACCESS_TOKEN` |

Testing and writes go to staging. Never apply migration
`20241029000007_auth_uid.sql` to a hosted project. Prod migrations and push
setup wait until Play closed testing is done and you say to proceed.
