const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

console.log('Testing Supabase queries...\n');
console.log('URL:', supabaseUrl);

async function testAnon() {
  console.log('\n=== ANON CLIENT ===');
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  // Test 1: search_nearby
  console.log('\n1. Testing search_nearby RPC...');
  try {
    const { data, error } = await supabase.rpc('search_nearby', {
      p_lat: 16.4023,
      p_lng: 120.5960,
      p_radius_meters: 5000,
      p_vehicle_type: 'car'
    });
    
    if (error) {
      console.error('  ✗ Error:', error.message);
      console.error('  Details:', error);
    } else {
      console.log(`  ✓ Success: ${data?.length || 0} locations`);
      if (data && data.length > 0) {
        console.log('  First result:', {
          id: data[0].id,
          name: data[0].name,
          lat: data[0].lat,
          lng: data[0].lng,
          available: data[0].available_count
        });
      }
    }
  } catch (e) {
    console.error('  ✗ Exception:', e.message);
  }
  
  // Test 2: location detail
  console.log('\n2. Testing location detail query...');
  try {
    const { data, error } = await supabase
      .from('locations')
      .select(`
        *,
        rates (
          id,
          vehicle_type,
          rate_type,
          hourly_amount,
          daily_amount,
          monthly_amount,
          flat_amount,
          time_from,
          time_until,
          effective_from,
          effective_until
        )
      `)
      .eq('id', '30000000-0000-0000-0000-000000000001')
      .single();
    
    if (error) {
      console.error('  ✗ Error:', error.message);
      console.error('  Details:', error);
    } else if (!data) {
      console.log('  ⚠ No data returned');
    } else {
      console.log('  ✓ Success:', {
        name: data.name,
        rates_count: data.rates?.length || 0,
        lat: typeof data.geog,
        published: data.published,
        verified: data.verification_status
      });
    }
  } catch (e) {
    console.error('  ✗ Exception:', e.message);
  }
}

async function testAuth() {
  console.log('\n\n=== AUTHENTICATED CLIENT ===');
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  // Sign in as operator/staff
  console.log('\nAttempting sign-in...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'operator@test.com',
    password: 'password123'
  });
  
  if (authError) {
    console.error('  ✗ Sign-in failed:', authError.message);
    return;
  }
  
  console.log('  ✓ Signed in as:', authData.user?.email);
  
  // Test 3: availability query
  console.log('\n3. Testing availability query...');
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .limit(1)
      .single();
    
    if (error) {
      console.error('  ✗ Error:', error.message);
      console.error('  Details:', error);
    } else if (!data) {
      console.log('  ⚠ No locations found');
    } else {
      console.log('  ✓ Success:', {
        id: data.id,
        name: data.name,
        capacity: data.capacity,
        available: data.available_count
      });
      
      // Test recent sessions
      console.log('\n4. Testing recent sessions...');
      const { data: sessions, error: sessError } = await supabase
        .from('parking_sessions')
        .select('*, created_at')
        .eq('location_id', data.id)
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (sessError) {
        console.error('  ✗ Error:', sessError.message);
      } else {
        console.log(`  ✓ Found ${sessions?.length || 0} sessions`);
      }
    }
  } catch (e) {
    console.error('  ✗ Exception:', e.message);
  }
}

async function main() {
  await testAnon();
  await testAuth();
  console.log('\n✓ Tests complete\n');
}

main().catch(console.error);
