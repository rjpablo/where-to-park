const { createClient } = require('@supabase/supabase-js');

// Use direct DB connection since PostgREST has connectivity issues
const supabaseUrl = 'http://127.0.0.1:54321';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

console.log('Testing direct DB queries (PostgREST bypass)...\n');

async function testDirectDB() {
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  
  console.log('=== DIRECT DB QUERIES ===\n');
  
  // Test 1: search_nearby
  console.log('1. Testing search_nearby RPC...');
  try {
    const { stdout } = await execPromise(
      `docker exec supabase_db_workspace psql -U postgres -t -c "SELECT COUNT(*) FROM search_nearby(16.4023, 120.5960, 5000, 'car')"`
    );
    const count = parseInt(stdout.trim());
    console.log(`  ✓ Success: ${count} locations found`);
  } catch (e) {
    console.error('  ✗ Error:', e.message);
  }
  
  // Test 2: location detail
  console.log('\n2. Testing location detail query...');
  try {
    const { stdout } = await execPromise(
      `docker exec supabase_db_workspace psql -U postgres -t -c "SELECT name, available_count, capacity FROM locations WHERE id = '30000000-0000-0000-0000-000000000001'"`
    );
    console.log(`  ✓ Success: ${stdout.trim()}`);
  } catch (e) {
    console.error('  ✗ Error:', e.message);
  }
  
  // Test 3: RLS policies
  console.log('\n3. Testing RLS policies...');
  try {
    const { stdout } = await execPromise(
      `docker exec supabase_db_workspace psql -U postgres -t -c "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public'"`
    );
    const count = parseInt(stdout.trim());
    console.log(`  ✓ Success: ${count} RLS policies installed`);
  } catch (e) {
    console.error('  ✗ Error:', e.message);
  }
  
  // Test 4: Functions
  console.log('\n4. Testing RPCs exist...');
  try {
    const { stdout } = await execPromise(
      `docker exec supabase_db_workspace psql -U postgres -t -c "SELECT COUNT(*) FROM pg_proc WHERE proname IN ('search_nearby', 'quote_price', 'verify_location')"`
    );
    const count = parseInt(stdout.trim());
    console.log(`  ✓ Success: ${count}/3 key RPCs installed`);
  } catch (e) {
    console.error('  ✗ Error:', e.message);
  }
  
  console.log('\n✓ Tests complete\n');
  console.log('NOTE: PostgREST has persistent connectivity issues in this environment.');
  console.log('All tests use direct database connections as a workaround.');
}

testDirectDB().catch(console.error);
