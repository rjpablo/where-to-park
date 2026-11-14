#!/usr/bin/env bash
# Dependable local reset: drop/recreate public, apply migrations + seed with ON_ERROR_STOP.
# Use this until `supabase db reset` works in this environment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${DB_CONTAINER:-supabase_db_workspace}"

if ! docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  echo "ERROR: $CONTAINER is not accepting connections. Start the DB first (supabase start)."
  exit 1
fi

echo "=== Recreating public schema ==="
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
SQL

echo "=== Applying migrations ==="
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  -> $(basename "$f")"
  docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$f"
done

echo "=== Seeding ==="
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$ROOT"/supabase/seed.sql

echo "=== pgTAP extension ==="
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgtap;'

echo "=== Verifying ==="
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT name, verification_status FROM locations ORDER BY name;
SELECT COUNT(*) AS user_count FROM auth.users;
SELECT COUNT(*) AS member_count FROM operator_members;
SQL

echo "=== reset-local-db.sh complete ==="
