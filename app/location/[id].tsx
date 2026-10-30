import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { AvailabilityBadge } from '../../src/components/AvailabilityBadge';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';
import { formatPeso } from '../../src/utils/formatters';
import { locationPhotoPublicUrl } from '../../src/lib/storageUpload';
import { theme } from '../../src/lib/theme';
import { embeddedOne } from '../../src/lib/embed';
import { useListingViewers } from '../../src/hooks/useListingViewers';
import { viewersLabel } from '../../src/lib/viewerPresence';
import { parseGeogPoint } from '../../src/lib/geog';
import { openNavigation } from '../../src/lib/openNavigation';
import { useSearchStore } from '../../src/stores/searchStore';
import { formatDistance, formatDuration } from '../../src/utils/formatters';
import {
  distanceEtaLabel,
  etaFor,
  pickEtaOrigin,
  straightLineMeters,
  type Eta,
  type LatLng,
} from '../../src/lib/listingEta';
import * as ExpoLocation from 'expo-location';
import { navigateLabel, preferredNavApp } from '../../src/lib/navigation';

export default function LocationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { user, initialize } = useAuthStore();
  const [location, setLocation] = useState<any>(null);
  // Live count of people on this page (including me), via Realtime Presence; joins once
  // the listing has loaded (not for 'Listing not found').
  const viewers = useListingViewers(location?.id ?? null);
  const [loading, setLoading] = useState(true);
  // Distance + drive time, from the same origin as the results list (the search
  // centre); my current location only when no search has run. Never prompts.
  const searchOrigin = useSearchStore((s) => s.searchOrigin);
  // The row's own distance (search_nearby, from the search centre) when this listing
  // is in the current results, so details show exactly what the row showed.
  const rowDistanceM = useSearchStore((s) =>
    Number(s.results.find((r) => r.id === id)?.distance_m ?? NaN)
  );
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [eta, setEta] = useState<Eta | null>(null);
  const origin = pickEtaOrigin(searchOrigin, userLocation);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    type: 'location' | 'review';
    id: string;
  } | null>(null);
  const [reportReason, setReportReason] = useState('Inaccurate rates');
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  useEffect(() => {
    initialize();
    loadLocation();
    // Reload when the route id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const submitReview = async () => {
    setReviewNotice(null);
    const { data, error: rpcError } = await supabase.rpc('submit_location_review', {
      p_location_id: id,
      p_rating: rating,
      p_comment: comment.trim() || null,
    });
    if (rpcError || data?.error) {
      setReviewNotice(rpcError?.message || String(data?.error));
      return;
    }
    setReviewNotice(data.booked_via_app ? 'Review saved · Booked via app' : 'Review saved');
    await loadLocation();
  };

  const submitReport = async () => {
    if (!reportTarget) return;
    setReportNotice(null);
    const { data, error: rpcError } = await supabase.rpc('submit_report', {
      p_target_type: reportTarget.type,
      p_target_id: reportTarget.id,
      p_reason: reportReason.trim(),
    });
    if (rpcError || data?.error) {
      setReportNotice(rpcError?.message || String(data?.error));
      return;
    }
    setReportNotice('Report sent');
    setReportTarget(null);
  };

  const loadLocation = async () => {
    if (!id) {
      setError('No location ID provided');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('locations')
        .select(
          `
          *,
          location_photos(*),
          location_policies(*),
          rates(*),
          reviews(*, public_profiles(display_name)),
          location_rating_stats(review_count, avg_rating)
        `
        )
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();

      if (fetchError) throw fetchError;
      // Deleted (or never existing) listings: show 'Listing not found', not an error.
      setLocation(data || null);
    } catch (err: any) {
      console.error('Load location error:', err);
      setError(err.message || 'Failed to load location');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (searchOrigin) return;
    let cancelled = false;
    (async () => {
      try {
        const perm = await ExpoLocation.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return; // denied / not asked: no origin, nothing shown
        const pos =
          (await ExpoLocation.getLastKnownPositionAsync().catch(() => null)) ??
          (await ExpoLocation.getCurrentPositionAsync({
            accuracy: ExpoLocation.Accuracy.Balanced,
          }));
        if (!cancelled && pos)
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // Location unavailable: leave the line out.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchOrigin]);

  const listingId: string | undefined = location?.id;
  const originLat = origin?.lat;
  const originLng = origin?.lng;
  useEffect(() => {
    setEta(null);
    if (!listingId || originLat == null || originLng == null) return;
    let cancelled = false;
    // Same RPC as the results list; on failure the line keeps the straight-line distance.
    supabase
      .rpc('get_etas', { p_lat: originLat, p_lng: originLng, p_location_ids: [listingId] })
      .then(({ data, error: etaError }) => {
        if (!cancelled && !etaError) setEta(etaFor(data?.etas, listingId));
      })
      .then(undefined, () => {});
    return () => {
      cancelled = true;
    };
  }, [listingId, originLat, originLng]);

  const listingPoint = parseGeogPoint(location?.geog);
  const distanceLine = distanceEtaLabel(
    origin?.kind === 'search' && Number.isFinite(rowDistanceM)
      ? rowDistanceM
      : origin && listingPoint
        ? straightLineMeters(origin, listingPoint)
        : null,
    eta,
    origin?.kind,
    { distance: formatDistance, duration: formatDuration }
  );

  const coords = () => {
    // geog arrives as hex EWKB from PostgREST; the old GeoJSON-only read always
    // fell back to the default point.
    return parseGeogPoint(location?.geog) ?? { lat: 16.412, lng: 120.596 };
  };

  // One Navigate button: the map app chosen on the Profile screen (the only
  // place it's set), or the phone's default map app for guests / no choice.
  const navApp = preferredNavApp(user?.preferred_nav_app);
  const openNav = async () => {
    const { lat, lng } = coords();
    await openNavigation(navApp, { lat, lng, name: location?.name });
  };

  if (loading) {
    return (
      <View style={styles.loading} testID="location-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.loading} testID="location-error">
        <Text style={styles.errorText}>Error: {error}</Text>
        <TouchableOpacity onPress={loadLocation} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!location) {
    return (
      <View style={styles.loading} testID="location-not-found">
        <Text style={styles.errorText}>Listing not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="location-ready">
      {/* Photo Gallery or Placeholder */}
      {location.location_photos?.length > 0 ? (
        <ScrollView horizontal style={styles.photoGallery}>
          {location.location_photos.map((photo: any) => {
            const uri = photo.url || locationPhotoPublicUrl(photo.storage_path);
            if (!uri) return null;
            return <Image key={photo.id} source={{ uri }} style={styles.photo} />;
          })}
        </ScrollView>
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderText}>📷 No photos available</Text>
        </View>
      )}

      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{location.name}</Text>
          <Text style={styles.address}>{location.address}</Text>
          {distanceLine ? (
            <Text style={styles.distance} numberOfLines={2} testID="listing-distance">
              {distanceLine}
            </Text>
          ) : null}
          <Text
            style={styles.viewers}
            accessibilityLabel={`${viewers} ${viewers === 1 ? 'person' : 'people'} viewing now`}
            accessibilityLiveRegion="polite"
            testID="listing-viewers"
          >
            {viewersLabel(viewers)}
          </Text>

          <View style={styles.availability}>
            <AvailabilityBadge
              trackingMode={location.tracking_mode}
              availableCount={location.available_count}
              capacity={location.capacity}
              openStatus={location.open_status}
              updatedAt={location.availability_updated_at}
              staleThresholdMin={location.stale_after_min}
            />
          </View>
        </View>

        <Button
          title={navigateLabel(navApp)}
          onPress={openNav}
          testID="navigate"
          style={{ marginBottom: theme.spacing.sm }}
        />
        <Button
          title="Message"
          variant="outline"
          onPress={() => router.push(`/chat/${id}`)}
          testID="location-message"
          style={{ marginBottom: theme.spacing.sm }}
        />
        {user ? (
          <Button
            title="Report listing"
            variant="outline"
            onPress={() => {
              setReportTarget({ type: 'location', id: String(id) });
              setReportReason('Inaccurate rates');
            }}
            testID="report-listing"
            style={{ marginBottom: theme.spacing.lg }}
          />
        ) : null}
        {reportNotice ? (
          <Text style={styles.reviewNotice} testID="report-sent">
            {reportNotice}
          </Text>
        ) : null}
        {reportTarget ? (
          <View style={styles.reviewForm} testID="report-form">
            <Text style={styles.sectionTitle}>
              Report {reportTarget.type === 'location' ? 'listing' : 'review'}
            </Text>
            <TextInput
              style={styles.input}
              value={reportReason}
              onChangeText={setReportReason}
              testID="report-reason"
            />
            <Button title="Send report" onPress={submitReport} testID="report-submit" />
          </View>
        ) : null}

        {/* Rates */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rates</Text>
          {location.rates?.filter((r: any) => r.active).length > 0 ? (
            location.rates
              .filter((r: any) => r.active)
              .map((rate: any) => (
                <View key={rate.id} style={styles.rateItem}>
                  <Text style={styles.rateType}>
                    {rate.name || rate.rate_type} {rate.vehicle_type && `(${rate.vehicle_type})`}
                  </Text>
                  <Text style={styles.ratePrice}>
                    {rate.rate_type === 'hourly' && rate.hourly_amount
                      ? `${formatPeso(rate.hourly_amount)}/h`
                      : rate.rate_type === 'daily' && rate.daily_amount
                        ? `${formatPeso(rate.daily_amount)}/day`
                        : rate.rate_type === 'monthly' && rate.monthly_amount
                          ? `${formatPeso(rate.monthly_amount)}/mo`
                          : 'Contact for rates'}
                  </Text>
                </View>
              ))
          ) : (
            <Text style={styles.placeholderText}>Contact location for rates</Text>
          )}
        </View>

        {/* Rules & Policies */}
        {location.location_policies?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rules & Policies</Text>
            {location.location_policies.map((policy: any) => (
              <Text key={policy.id} style={styles.policyText}>
                • {policy.label}: {policy.value_text}
              </Text>
            ))}
          </View>
        )}

        {/* Reviews */}
        <View style={styles.section}>
          {(() => {
            const stats = Array.isArray(location.location_rating_stats)
              ? location.location_rating_stats[0]
              : location.location_rating_stats;
            const count = Number(stats?.review_count ?? location.reviews?.length ?? 0);
            const avg = Number(stats?.avg_rating ?? 0);
            return (
              <>
                <Text style={styles.sectionTitle} testID="reviews-heading">
                  Reviews ({count})
                </Text>
                {count > 0 && avg > 0 ? (
                  <View style={styles.ratingDisplay} testID="reviews-average">
                    <Text style={styles.ratingNumber}>{avg.toFixed(1)}</Text>
                    <Text style={styles.ratingStars}>⭐</Text>
                  </View>
                ) : null}
              </>
            );
          })()}

          {location.reviews?.map((review: any) => (
            <View key={review.id} style={styles.reviewItem} testID={`review-${review.author_id}`}>
              <Text style={styles.reviewAuthor}>
                {embeddedOne<any>(review.public_profiles)?.display_name || 'Anonymous'}
              </Text>
              {review.session_id || review.reservation_id ? (
                <Text style={styles.bookedLabel} testID="booked-via-app">
                  Booked via app
                </Text>
              ) : null}
              <Text style={styles.reviewRating}>{'⭐'.repeat(review.rating)}</Text>
              <Text style={styles.reviewText}>{review.comment}</Text>
              {user ? (
                <Button
                  title="Report review"
                  size="small"
                  variant="outline"
                  onPress={() => {
                    setReportTarget({ type: 'review', id: review.id });
                    setReportReason('Inappropriate');
                  }}
                  testID={`report-review-${review.id}`}
                />
              ) : null}
            </View>
          ))}

          {user ? (
            <View style={styles.reviewForm} testID="review-form">
              <Text style={styles.sectionTitle}>Write a review</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button
                    key={n}
                    title={`${n}`}
                    size="small"
                    variant={rating === n ? 'primary' : 'outline'}
                    onPress={() => setRating(n)}
                    testID={`review-rating-${n}`}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={comment}
                onChangeText={setComment}
                placeholder="How was parking here?"
                testID="review-comment"
              />
              <Button title="Submit review" onPress={submitReview} testID="review-submit" />
              {reviewNotice ? <Text style={styles.reviewNotice}>{reviewNotice}</Text> : null}
            </View>
          ) : (
            <Button
              title="Sign in to review"
              variant="outline"
              onPress={() => router.push('/auth')}
            />
          )}
        </View>

        {/* Contact */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact</Text>
          <Text style={styles.contactText}>{location.contact || 'No contact provided'}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoGallery: {
    height: 240,
  },
  photo: {
    width: 300,
    height: 240,
    marginRight: theme.spacing.sm,
  },
  content: {
    padding: theme.spacing.lg,
  },
  header: {
    marginBottom: theme.spacing.lg,
  },
  title: {
    ...theme.typography.h2,
    marginBottom: theme.spacing.xs,
  },
  address: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  distance: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  viewers: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.md,
  },
  availability: {
    marginTop: theme.spacing.sm,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    ...theme.typography.h3,
    marginBottom: theme.spacing.md,
  },
  rateItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  rateType: {
    ...theme.typography.body,
  },
  ratePrice: {
    ...theme.typography.body,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  policyText: {
    ...theme.typography.body,
    marginBottom: theme.spacing.sm,
  },
  ratingDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: theme.spacing.md,
  },
  ratingNumber: {
    ...theme.typography.h1,
    fontSize: 48,
    marginRight: theme.spacing.sm,
  },
  ratingStars: {
    fontSize: 24,
  },
  reviewItem: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  reviewAuthor: {
    ...theme.typography.body,
    fontWeight: '600',
    marginBottom: theme.spacing.xs,
  },
  reviewRating: {
    fontSize: 14,
    marginBottom: theme.spacing.xs,
  },
  reviewText: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
  },
  bookedLabel: {
    ...theme.typography.caption,
    color: theme.colors.secondary,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  reviewForm: { marginTop: theme.spacing.md },
  ratingRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  reviewNotice: {
    ...theme.typography.bodySmall,
    color: theme.colors.success,
    marginTop: theme.spacing.sm,
  },
  contactText: {
    ...theme.typography.body,
  },
  placeholderText: {
    ...theme.typography.body,
    color: theme.colors.text.tertiary,
    fontStyle: 'italic',
  },
  photoPlaceholder: {
    height: 240,
    backgroundColor: theme.colors.surfaceDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholderText: {
    ...theme.typography.h3,
    color: theme.colors.text.tertiary,
  },
  errorText: {
    ...theme.typography.body,
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    marginTop: theme.spacing.md,
  },
  retryButtonText: {
    ...theme.typography.button,
    color: '#fff',
  },
});
