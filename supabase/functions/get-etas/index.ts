import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ETARequest {
  origin: { lat: number; lng: number };
  locations: Array<{ id: string; lat: number; lng: number }>;
}

interface ETAResponse {
  etas: Array<{
    location_id: string;
    duration_s: number;
    distance_m: number;
    source: 'ors' | 'estimate';
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { origin, locations }: ETARequest = await req.json();

    if (!origin || !locations || locations.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Round origin to ~200m grid cell for caching
    const originCell = `${Math.round(origin.lat * 200) / 200},${Math.round(origin.lng * 200) / 200}`;

    // Check cache first
    const locationIds = locations.map((l) => l.id);
    const { data: cachedETAs } = await supabaseClient
      .from('eta_cache')
      .select('*')
      .eq('origin_cell', originCell)
      .in('location_id', locationIds)
      .gte('fetched_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()); // 10 min TTL

    const cachedMap = new Map(cachedETAs?.map((e) => [e.location_id, e]) || []);

    const etas: ETAResponse['etas'] = [];
    const locationsToFetch: typeof locations = [];

    // Use cached values where available
    for (const location of locations) {
      const cached = cachedMap.get(location.id);
      if (cached) {
        etas.push({
          location_id: location.id,
          duration_s: cached.duration_s,
          distance_m: cached.distance_m,
          source: cached.source as 'ors' | 'estimate',
        });
      } else {
        locationsToFetch.push(location);
      }
    }

    // Fetch ETAs for non-cached locations
    if (locationsToFetch.length > 0) {
      const orsApiKey = Deno.env.get('OPENROUTE_SERVICE_API_KEY');

      if (orsApiKey) {
        try {
          // Call OpenRouteService Matrix API
          const coordinates = [
            [origin.lng, origin.lat],
            ...locationsToFetch.map((l) => [l.lng, l.lat]),
          ];

          const orsResponse = await fetch(
            'https://api.openrouteservice.org/v2/matrix/driving-car',
            {
              method: 'POST',
              headers: {
                Authorization: orsApiKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                locations: coordinates,
                sources: [0], // Origin
                metrics: ['duration', 'distance'],
              }),
            }
          );

          if (orsResponse.ok) {
            const orsData = await orsResponse.json();
            const durations = orsData.durations?.[0] || [];
            const distances = orsData.distances?.[0] || [];

            for (let i = 0; i < locationsToFetch.length; i++) {
              const location = locationsToFetch[i];
              const duration_s = Math.round(durations[i + 1] || 0);
              const distance_m = Math.round(distances[i + 1] || 0);

              etas.push({
                location_id: location.id,
                duration_s,
                distance_m,
                source: 'ors',
              });

              // Cache the result
              await supabaseClient.from('eta_cache').upsert({
                origin_cell: originCell,
                location_id: location.id,
                duration_s,
                distance_m,
                source: 'ors',
                fetched_at: new Date().toISOString(),
              });
            }
          } else {
            // ORS failed, use estimates
            throw new Error('ORS API error');
          }
        } catch (error) {
          console.error('ORS error, falling back to estimates:', error);
          // Fall back to straight-line estimates
          for (const location of locationsToFetch) {
            const eta = estimateETA(origin, location);
            etas.push(eta);

            // Cache the estimate
            await supabaseClient.from('eta_cache').upsert({
              origin_cell: originCell,
              location_id: location.id,
              duration_s: eta.duration_s,
              distance_m: eta.distance_m,
              source: 'estimate',
              fetched_at: new Date().toISOString(),
            });
          }
        }
      } else {
        // No API key, use estimates
        for (const location of locationsToFetch) {
          const eta = estimateETA(origin, location);
          etas.push(eta);

          // Cache the estimate
          await supabaseClient.from('eta_cache').upsert({
            origin_cell: originCell,
            location_id: location.id,
            duration_s: eta.duration_s,
            distance_m: eta.distance_m,
            source: 'estimate',
            fetched_at: new Date().toISOString(),
          });
        }
      }
    }

    return new Response(JSON.stringify({ etas }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function estimateETA(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): { location_id: string; duration_s: number; distance_m: number; source: 'estimate' } {
  // Haversine distance
  const R = 6371000; // Earth radius in meters
  const φ1 = (origin.lat * Math.PI) / 180;
  const φ2 = (destination.lat * Math.PI) / 180;
  const Δφ = ((destination.lat - origin.lat) * Math.PI) / 180;
  const Δλ = ((destination.lng - origin.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance_m = Math.round(R * c);

  // Estimate 30 km/h average in Baguio (hilly, narrow streets)
  const duration_s = Math.round((distance_m / 30000) * 3600);

  return {
    location_id: (destination as any).id,
    duration_s,
    distance_m,
    source: 'estimate',
  };
}
