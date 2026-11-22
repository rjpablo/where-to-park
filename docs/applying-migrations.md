# Applying database migrations

How to apply SQL files from `supabase/migrations/` to the hosted Supabase projects.
Use this when new migration files land on the branch and need to reach staging
(or, later, production).

**All documentation you ask the bot to create lives in this `docs/` folder.**
See [README.md](./README.md) for the index.

## Warnings (read first)

1. **Staging first.** Apply every new migration to staging, test the app against
   staging, then apply to prod only when you say so (after Play closed testing).
2. **Never apply `20241029000007_auth_uid.sql` to any hosted project** (staging or
   prod). It is for local Docker only. Skip it always.
3. **Prod is separate.** Prod ref `pvxtdvyrqviuhhclbije` stays untouched until you
   explicitly ask to update it. Pending prod work also includes Edge Functions,
   Vault secrets, and cron jobs — those are **not** in the migration files. See
   [push-notifications.md](./push-notifications.md).
4. **On failure, stop.** Do not hand-patch the database. Fix or revise the
   migration file, then re-apply cleanly.
5. **No secrets in this file.** Token values stay in environment variables or
   your password manager, never in the repo.

## Project refs

| | Staging | Production |
|---|---|---|
| Project name | Where To Park Staging | Where To Park |
| Ref | `ckspplijrygjlencrduw` | `pvxtdvyrqviuhhclbije` |
| URL | https://ckspplijrygjlencrduw.supabase.co | https://pvxtdvyrqviuhhclbije.supabase.co |
| Management API token (env var **name** only) | `SUPABASE_STAGING_ACCESS_TOKEN` | `SUPABASE_ACCESS_TOKEN` |

Create a personal access token at https://supabase.com/dashboard/account/tokens
(or use a token that already has access to the project). Put it in the matching
env var for the session; never commit it.

## Prerequisites (Windows PC)

Repo path: `C:\Development\where-to-park`

- Node.js 18+ and `npx` (for the optional Supabase CLI path)
- PowerShell 5+ (Windows built-in is fine)
- Git, on the branch that has the migrations:
  `cursor/where-to-park-android-50c5`
- A Supabase access token in an environment variable (name above)

Optional: [Supabase CLI](https://supabase.com/docs/guides/cli) via `npx supabase`
(no global install required). CLI v3 may refuse this repo’s older
`supabase/config.toml` (`[inbucket]` section); if that happens, use
`npx -y supabase@2 …` or the Management API method below.

## Migration files

Path: `supabase/migrations/`

Files are named `YYYYMMDDHHMMSS_snake_name.sql` and must be applied **in
filename order**. Skip `20241029000007_auth_uid.sql` on hosted projects.

History of what has been applied on a project is stored in:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

`version` is the numeric prefix (for example `20241029000084`).
`name` is the rest of the filename without `.sql`
(for example `driver_reservation_requests`).

## Method A — Management API (what the bot uses)

This is the method already used on staging. It posts the SQL to the Supabase
Management API `database/query` endpoint, expects **HTTP 201**, then records the
version in `supabase_migrations.schema_migrations`.

### 1. Open PowerShell and set the token (staging example)

```powershell
cd C:\Development\where-to-park
git checkout cursor/where-to-park-android-50c5
git pull --ff-only

# Paste the token when prompted; it stays in this session only
$env:SUPABASE_STAGING_ACCESS_TOKEN = Read-Host "Staging Supabase access token"
$ProjectRef = "ckspplijrygjlencrduw"
```

For production later, use `$env:SUPABASE_ACCESS_TOKEN` and
`$ProjectRef = "pvxtdvyrqviuhhclbije"` instead — only when you intend to update prod.

### 2. See which migrations are already applied

```powershell
$headers = @{
  Authorization = "Bearer $env:SUPABASE_STAGING_ACCESS_TOKEN"
  "Content-Type" = "application/json"
}
$body = @{
  query = "select version, name from supabase_migrations.schema_migrations order by version;"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
  -Headers $headers `
  -Body $body
```

A **401 Invalid access token** means the token is missing, expired, or for the
wrong account — create a new one and set the env var again. Do not fall back to
another project’s token.

### 3. Find files not yet applied

Compare `supabase/migrations/*.sql` (sorted) to the `version` list from step 2.
Skip `*00007_auth_uid*`. Apply only the missing ones, oldest first.

### 4. Apply one migration file

```powershell
$File = "supabase/migrations/20241029000084_driver_reservation_requests.sql"
$Base = [IO.Path]::GetFileNameWithoutExtension($File)   # 20241029000084_driver_reservation_requests
$Version = ($Base -split "_", 2)[0]                     # 20241029000084
$Name = ($Base -split "_", 2)[1]                        # driver_reservation_requests

if ($Base -match "00007_auth_uid") { throw "REFUSING 0007 — never apply to hosted" }

$sql = Get-Content -Raw -Path $File
$applyBody = @{ query = $sql } | ConvertTo-Json -Depth 5

# Run the SQL
$apply = Invoke-WebRequest `
  -Method Post `
  -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
  -Headers $headers `
  -Body $applyBody

if ($apply.StatusCode -ne 201) {
  throw "Apply failed for $Base : HTTP $($apply.StatusCode) $($apply.Content)"
}

# Record it in migration history (same as the bot’s apply-mig-staging.sh)
$recordSql = @"
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(
  version text primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations(version, name)
values ('$Version', '$Name')
on conflict (version) do nothing;
"@
$recordBody = @{ query = $recordSql } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
  -Headers $headers `
  -Body $recordBody

Write-Host "applied $Base"
```

Repeat step 4 for each remaining file in order.

### 5. Verify

Re-run the `select version, name …` query from step 2 and confirm the new
versions appear. Then smoke-test the related RPCs or tables in the app (or with
a small SQL check).

### On failure

- The Management API response body usually contains the Postgres error.
- Stop. Do not run follow-up “fix” SQL by hand unless you are deliberately
  writing a new numbered migration.
- If the SQL ran but the history insert failed, fix the history insert only
  (same `insert … on conflict do nothing`); do not re-run a non-idempotent
  migration blindly.

## Method B — Supabase CLI (alternative)

Useful if you prefer `supabase link` + `db push`. Still **skip 0007** on hosted
projects.

```powershell
cd C:\Development\where-to-park

# Staging
$env:SUPABASE_ACCESS_TOKEN = Read-Host "Staging Supabase access token"
# The CLI reads SUPABASE_ACCESS_TOKEN (one name). Use the staging token here
# only while linked to staging.
npx -y supabase@2 link --project-ref ckspplijrygjlencrduw

# Preview what would run (recommended)
npx -y supabase@2 db push --dry-run

# Push — but first ensure 0007 will not run. If the dry-run lists
# 20241029000007_auth_uid.sql, mark it applied without executing, then push:
#   npx -y supabase@2 migration repair 20241029000007 --status applied
npx -y supabase@2 db push
```

Notes:

- `migration repair … --status applied` tells the CLI “this version is already
  accounted for” without executing the file. Use that **only** for `0007` on
  hosted projects (or for a version you know was applied outside the CLI).
- For production later: link to `pvxtdvyrqviuhhclbije` with the prod token, dry-run,
  repair `0007` if needed, then `db push` — only when you have decided to update prod.
- If CLI v3 errors on `config.toml`, keep using `supabase@2` as above (same
  workaround used when deploying the `send-push` Edge Function).

## Edge Functions, Vault, and cron (not migrations)

Some features need more than SQL:

- Edge Function deploy (for example `send-push`)
- Function secrets
- Vault secrets
- `pg_cron` job schedules

Those steps are documented in [push-notifications.md](./push-notifications.md)
and are separate from applying migration files. Apply the SQL first when a
migration depends on a function URL or secret that already exists; otherwise
deploy the function / set secrets, then apply.

## After migrations (app)

Staging web app: redeploy so the UI matches the new RPCs/tables
(see the deploy steps in chat / `eas-build.md`). Android needs a new EAS build
only when you ask for one — migrations alone do not require a version bump.

## Quick checklist

- [ ] On branch with the new files; `git pull --ff-only`
- [ ] Token set for **staging** (`SUPABASE_STAGING_ACCESS_TOKEN` / Method A)
- [ ] Listed applied versions from `schema_migrations`
- [ ] Skipped `20241029000007_auth_uid.sql`
- [ ] Applied only missing files, in order; each returned HTTP 201
- [ ] Recorded each version in `schema_migrations`
- [ ] Verified with a follow-up `select` / app smoke test
- [ ] Prod: do nothing until you explicitly choose to
