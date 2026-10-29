#!/usr/bin/env bash
# Parallel concurrency test for claim_capacity

set -euo pipefail

DB_CONTAINER="supabase_db_workspace"
TEST_LOC_ID="cccccccc-0000-0000-0000-000000000001"
TEST_OP_ID="cccccccc-0000-0000-0000-000000000002"
CONCURRENT_REQUESTS=50
RESULTS_FILE="/tmp/concurrency_results.txt"

echo "=== Parallel Concurrency Test ==="
echo "Testing $CONCURRENT_REQUESTS concurrent requests on 1-capacity location"

rm -f "$RESULTS_FILE"
touch "$RESULTS_FILE"

echo "Setting up test location..."
docker exec -i "$DB_CONTAINER" psql -U postgres <<EOFSQL >/dev/null 2>&1
DO \$\$
BEGIN
  DELETE FROM reservations WHERE location_id = '$TEST_LOC_ID';
  DELETE FROM parking_sessions WHERE location_id = '$TEST_LOC_ID';
  DELETE FROM locations WHERE id = '$TEST_LOC_ID';
  DELETE FROM operators WHERE id = '$TEST_OP_ID';
  
  INSERT INTO operators (id, display_name) VALUES ('$TEST_OP_ID', 'Test Op');
  INSERT INTO locations (id, operator_id, name, listing_type, geog, address, tracking_mode, capacity, available_count, published)
  VALUES ('$TEST_LOC_ID', '$TEST_OP_ID', 'Test', 'commercial',
    ST_SetSRID(ST_MakePoint(120.596, 16.412), 4326)::GEOGRAPHY,
    'Test', 'count', 1, 1, true);
END \$\$;
EOFSQL

echo "Spawning $CONCURRENT_REQUESTS parallel connections..."

for i in $(seq 1 $CONCURRENT_REQUESTS); do
  {
    RESULT=$(docker exec -i "$DB_CONTAINER" psql -U postgres -t -A <<EOFSQL 2>&1
BEGIN;
DO \$\$
DECLARE
  v_result JSONB;
BEGIN
  v_result := claim_capacity(
    '$TEST_LOC_ID'::UUID,
    NULL,
    NOW(),
    NOW() + INTERVAL '2 hours',
    'reservation'
  );
  
  IF (v_result->>'success')::BOOLEAN THEN
    INSERT INTO reservations (location_id, start_at, end_at, status, quote_amount, fee_due_amount)
    VALUES ('$TEST_LOC_ID', NOW(), NOW() + INTERVAL '2 hours', 'confirmed', 100, 0);
    RAISE NOTICE 'success';
  ELSE
    RAISE NOTICE 'error: %', v_result->>'error';
  END IF;
END \$\$;
COMMIT;
EOFSQL
)
    
    if echo "$RESULT" | grep -q 'NOTICE:  success'; then
      echo "success" >> "$RESULTS_FILE"
    elif echo "$RESULT" | grep -q 'NOTICE:  error: no_longer_available'; then
      echo "no_longer_available" >> "$RESULTS_FILE"
    else
      echo "unknown" >> "$RESULTS_FILE"
    fi
  } &
done

wait

echo ""
echo "=== Results ==="
SUCCESS_COUNT=$(grep -c "^success$" "$RESULTS_FILE" || true)
FAILURE_COUNT=$(grep -c "^no_longer_available$" "$RESULTS_FILE" || true)
UNKNOWN_COUNT=$(grep -c "^unknown$" "$RESULTS_FILE" || true)
TOTAL_COUNT=$(wc -l < "$RESULTS_FILE")

echo "Total: $TOTAL_COUNT"
echo "Successes: $SUCCESS_COUNT"
echo "Failures: $FAILURE_COUNT"
echo "Unknown: $UNKNOWN_COUNT"

docker exec -i "$DB_CONTAINER" psql -U postgres <<EOFSQL >/dev/null 2>&1
DELETE FROM reservations WHERE location_id = '$TEST_LOC_ID';
DELETE FROM locations WHERE id = '$TEST_LOC_ID';
DELETE FROM operators WHERE id = '$TEST_OP_ID';
EOFSQL

if [ "$SUCCESS_COUNT" -eq 1 ]; then
  echo "✓ PASS: Exactly 1 success"
  exit 0
else
  echo "✗ FAIL: Expected 1 success, got $SUCCESS_COUNT"
  exit 1
fi
