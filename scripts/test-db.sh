#!/bin/bash
set -euo pipefail

CONTAINER="${DB_CONTAINER:-supabase_db_workspace}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Database Test Suite ==="

if ! docker exec "$CONTAINER" psql -U postgres -c "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to database"
  exit 1
fi

docker exec "$CONTAINER" psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pgtap" >/dev/null

run_tap() {
  local file="$1"
  echo ""
  echo "--- $(basename "$file") ---"
  local out
  out="$(docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$file")"
  printf '%s\n' "$out"
  if printf '%s\n' "$out" | grep -q "not ok"; then
    echo "FAIL: $(basename "$file") reported a failed TAP assertion"
    exit 1
  fi
}

run_tap "$ROOT/supabase/tests/database_tests.sql"
run_tap "$ROOT/supabase/tests/rls_operator_staff.sql"
run_tap "$ROOT/supabase/tests/staff_waiver.sql"
run_tap "$ROOT/supabase/tests/location_crud.sql"
run_tap "$ROOT/supabase/tests/rates_crud.sql"
run_tap "$ROOT/supabase/tests/staff_management.sql"
run_tap "$ROOT/supabase/tests/fee_presets.sql"
run_tap "$ROOT/supabase/tests/phone_otp.sql"

echo ""
echo "Running parallel concurrency test..."
"$ROOT/scripts/parallel-concurrency-test.sh"

echo ""
echo "=== All Tests Complete ==="
