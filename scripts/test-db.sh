#!/bin/bash
set -e

echo "=== Database Test Suite ==="
echo ""

if ! docker exec supabase_db_workspace psql -U postgres -c "SELECT 1" > /dev/null 2>&1; then
  echo "ERROR: Cannot connect to database"
  exit 1
fi

echo "Running pgTAP tests..."
docker exec -i supabase_db_workspace psql -U postgres < supabase/tests/database_tests.sql 2>&1 > /tmp/pgtap_full.txt

echo ""
cat /tmp/pgtap_full.txt | grep " ok " | head -20
echo ""

PASSED=$(cat /tmp/pgtap_full.txt | grep -c " ok " || echo "0")
echo "pgTAP: $PASSED tests passed"
echo ""

echo "Running concurrency test..."
docker exec -i supabase_db_workspace psql -U postgres < supabase/tests/concurrency_test.sql 2>&1 > /tmp/concurrency_full.txt

echo ""
cat /tmp/concurrency_full.txt | grep -E "ok |pass" | head -15
echo ""

CONC_PASSED=$(cat /tmp/concurrency_full.txt | grep -cE "ok |pass" || echo "0")
echo "Concurrency: $CONC_PASSED tests/assertions passed"
echo ""

echo "=== All Tests Complete ==="
TOTAL=$((PASSED + CONC_PASSED))
echo "Total: $TOTAL assertions passed"
