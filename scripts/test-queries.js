const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54400';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

function report(label, { data, error }) {
  if (error) {
    console.log(`  ✗ ${label}: ${error.message}`);
    if (error.details) console.log(`    details: ${error.details}`);
    return false;
  }
  const n = Array.isArray(data) ? data.length : data ? 1 : 0;
  console.log(`  ✓ ${label}: ${n} row(s)`);
  if (Array.isArray(data) && data[0]) {
    console.log('    sample:', JSON.stringify(data[0]).slice(0, 240));
  } else if (data) {
    console.log('    sample:', JSON.stringify(data).slice(0, 240));
  }
  return true;
}

async function asAnon() {
  console.log('\n=== ANON ===');
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  let ok = true;
  ok = report('search_nearby', await supabase.rpc('search_nearby', {
    p_lat: 16.4023,
    p_lng: 120.5960,
    p_radius_m: 5000,
    p_vehicle_type: 'car',
  })) && ok;
  ok = report('location detail', await supabase
    .from('locations')
    .select('id, name, available_count, capacity, rates(hourly_amount), location_policies(*)')
    .eq('id', '30000000-0000-0000-0000-000000000001')
    .single()) && ok;
  ok = report('folios (expect 0)', await supabase.from('folios').select('id')) && ok;
  return ok;
}

async function asUser(email, password, label) {
  console.log(`\n=== ${label} (${email}) ===`);
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) {
    console.log(`  ✗ sign-in: ${authError.message}`);
    return false;
  }
  console.log(`  ✓ signed in ${auth.user?.id}`);
  let ok = true;
  ok = report('locations', await supabase.from('locations').select('id, name').limit(5)) && ok;
  ok = report('operator_members', await supabase.from('operator_members').select('operator_id, role, profile_id')) && ok;
  ok = report('parking_sessions', await supabase.from('parking_sessions').select('id, plate, status').limit(5)) && ok;
  ok = report('availability SM', await supabase
    .from('locations')
    .select('id, name, available_count, capacity')
    .eq('id', '30000000-0000-0000-0000-000000000001')
    .single()) && ok;
  return ok;
}

async function main() {
  console.log('URL', supabaseUrl);
  const results = [
    await asAnon(),
    await asUser('juan@wheretopark.local', 'password123', 'OPERATOR Juan'),
    await asUser('staff@wheretopark.local', 'password123', 'STAFF Ana'),
    await asUser('admin@wheretopark.local', 'password123', 'ADMIN'),
  ];
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} client roles succeeded`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
