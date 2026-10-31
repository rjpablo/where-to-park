import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { AvailabilityBadge } from '../../src/components/AvailabilityBadge';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';
import { formatPeso } from '../../src/utils/formatters';
import {
  deleteReviewPhoto,
  locationPhotoPublicUrl,
  reviewPhotoPublicUrl,
  uploadReviewPhoto,
} from '../../src/lib/storageUpload';
import {
  photosLeft,
  REVIEW_PHOTO_MAX,
  reviewPhotoError,
  reviewPhotoFilename,
  sortReviewPhotos,
} from '../../src/lib/reviewPhotos';
import { pickProcessedImage, processWebFile } from '../../src/utils/processImage';
import { theme } from '../../src/lib/theme';
import { embeddedOne } from '../../src/lib/embed';
import { useListingViewers } from '../../src/hooks/useListingViewers';
import { viewersLabel } from '../../src/lib/viewerPresence';
import { parseGeogPoint } from '../../src/lib/geog';
import { openNavigation } from '../../src/lib/openNavigation';
import { ImageCarousel, type CarouselImage } from '../../src/components/ImageCarousel';
import { DETAIL_TABS, gridCellSize, tabLabel, type DetailTab } from '../../src/lib/detailTabs';
import { formatListingRating } from '../../src/lib/rating';
import {
  collectionImages,
  FROM_REVIEW_LABEL,
  type CollectionImage,
} from '../../src/lib/photoCollection';
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
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { loadShortcuts, useShortcutsStore } from '../../src/stores/shortcutsStore';

const GRID_GAP = 4;

const collectionUrl = (source: string, path: string) =>
  source === 'review' ? reviewPhotoPublicUrl(path) : locationPhotoPublicUrl(path);

export default function LocationDetailScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(0);
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { user, initialize } = useAuthStore();
  const shortcutItems = useShortcutsStore((s) => s.items);
  const addShortcut = useShortcutsStore((s) => s.add);
  const removeShortcutFor = useShortcutsStore((s) => s.remove);
  const [shortcutBusy, setShortcutBusy] = useState(false);
  const [shortcutNotice, setShortcutNotice] = useState<string | null>(null);
  const [location, setLocation] = useState<any>(null);
  // Live count of people on this page (including me), via Realtime Presence; joins once
  // the listing has loaded (not for 'Listing not found').
  const viewers = useListingViewers(location?.id ?? null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>('overview');
  const { width: windowWidth } = useWindowDimensions();
  const [collection, setCollection] = useState<CollectionImage[] | null>(null);
  // Open photo viewer: which photos and the one tapped.
  const [carousel, setCarousel] = useState<{ images: CarouselImage[]; start: number } | null>(null);
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
  // Photos picked in the review form, uploaded when the review is submitted.
  const [stagedPhotos, setStagedPhotos] = useState<
    { key: string; uri: string; base64: string; contentType: string }[]
  >([]);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    type: 'location' | 'review';
    id: string;
  } | null>(null);
  const [reportReason, setReportReason] = useState('Inaccurate rates');
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  useEffect(() => {
    initialize();
    setTab('overview');
    loadLocation();
    // Reload when the route id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const submitReview = async () => {
    setReviewNotice(null);
    setReviewBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('submit_location_review', {
        p_location_id: id,
        p_rating: rating,
        p_comment: comment.trim() || null,
      });
      if (rpcError || data?.error) {
        setReviewNotice(rpcError?.message || String(data?.error));
        return;
      }
      let photoError: string | null = null;
      const now = Date.now();
      const left: typeof stagedPhotos = [];
      for (let i = 0; i < stagedPhotos.length; i++) {
        const photo = stagedPhotos[i];
        const res = await uploadReviewPhoto({
          reviewId: data.review_id,
          filename: reviewPhotoFilename(i, now, Math.random().toString(36).slice(2)),
          base64: photo.base64,
          contentType: photo.contentType,
        });
        if (res.error) {
          photoError = reviewPhotoError(res.code);
          left.push(photo);
        }
      }
      setStagedPhotos(left);
      const saved = data.booked_via_app ? 'Review saved · Booked via app' : 'Review saved';
      setReviewNotice(photoError ? `${saved} · ${photoError}` : saved);
      await loadLocation();
    } finally {
      setReviewBusy(false);
    }
  };

  const stagePhoto = (p: { uri: string; base64: string; contentType: string }) =>
    setStagedPhotos((prev) => [...prev, { ...p, key: `s-${Date.now()}-${prev.length}` }]);

  const addReviewPhoto = async () => {
    setReviewNotice(null);
    try {
      if (Platform.OS === 'web') {
        const input = document.querySelector(
          '[data-testid="review-photo-file"]'
        ) as HTMLInputElement | null;
        input?.click();
        return;
      }
      const processed = await pickProcessedImage();
      if (processed) stagePhoto(processed);
    } catch (err: any) {
      setReviewNotice(err.message || 'Could not add the photo');
    }
  };

  const onReviewFiles = async (files: File[], room: number) => {
    for (const file of files.slice(0, room)) {
      try {
        stagePhoto(await processWebFile(file));
      } catch (err: any) {
        setReviewNotice(err.message || 'Could not read the photo. Try another image.');
      }
    }
    if (files.length > room) setReviewNotice(`A review can have up to ${REVIEW_PHOTO_MAX} photos`);
  };

  const removeSavedPhoto = async (photo: { id: string; storage_path: string }) => {
    setReviewNotice(null);
    const res = await deleteReviewPhoto(photo);
    if (res.error) setReviewNotice(res.error);
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
          reviews(*, public_profiles(display_name), review_photos(id, storage_path, sort_order)),
          location_rating_stats(review_count, avg_rating)
        `
        )
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();

      if (fetchError) throw fetchError;
      // Derived photo collection (listing_photo_collection view, migration 0037).
      const { data: photoRows, error: photoError } = await supabase
        .from('listing_photo_collection')
        .select(
          'id, source, storage_path, review_id, source_rank, cover_rank, sort_order, created_at'
        )
        .eq('location_id', id);
      setCollection(photoError ? null : collectionImages(photoRows, collectionUrl));
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
  const userId = user?.id ?? null;

  useEffect(() => {
    loadShortcuts(userId);
  }, [userId]);

  const hasShortcut = !!listingId && shortcutItems.some((s) => s.locationId === listingId);
  const toggleShortcut = async () => {
    if (!location || shortcutBusy) return;
    setShortcutBusy(true);
    setShortcutNotice(null);
    try {
      const err = hasShortcut
        ? await removeShortcutFor(location.id)
        : await addShortcut({ id: location.id, name: location.name });
      setShortcutNotice(
        err || (hasShortcut ? 'Shortcut removed' : 'Added to Shortcuts in the menu')
      );
    } finally {
      setShortcutBusy(false);
    }
  };
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

  // A review's photos for its thumbnails and carousel, in upload order.
  const reviewImages = (review: any): CarouselImage[] =>
    sortReviewPhotos<any>(review?.review_photos)
      .map((p: any) => ({ key: `rv-${p.id}`, uri: reviewPhotoPublicUrl(p.storage_path) || '' }))
      .filter((img) => !!img.uri);

  // The listing's photo collection (operator photos + review photos) for the gallery
  // strip and the carousel. Until the collection loads (or if the view is missing),
  // the operator photos alone.
  const galleryImages: CollectionImage[] =
    collection ??
    collectionImages(
      (location?.location_photos ?? []).map((p: any) => ({ ...p, source: 'listing' })),
      collectionUrl
    );

  const ratingStats = Array.isArray(location?.location_rating_stats)
    ? location.location_rating_stats[0]
    : location?.location_rating_stats;
  const reviewCount = Number(ratingStats?.review_count ?? location?.reviews?.length ?? 0);
  const ratingText = formatListingRating(ratingStats?.avg_rating, reviewCount);
  // Photos tab grid: 3 square cells across the content width (screen minus padding).
  const gridSize = gridCellSize(Math.min(windowWidth, 900) - theme.spacing.lg * 2, 3, GRID_GAP);

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
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="location-ready"
    >
      {/* Photo Gallery or Placeholder */}
      {galleryImages.length > 0 ? (
        <ScrollView horizontal style={styles.photoGallery}>
          {galleryImages.map((img, i) => (
            <TouchableOpacity
              key={img.key}
              onPress={() => setCarousel({ images: galleryImages, start: i })}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Photo ${i + 1} of ${galleryImages.length}`}
              testID={`listing-photo-${i}`}
            >
              <Image source={{ uri: img.uri }} style={styles.photo} />
              {img.fromReview ? (
                <Text style={styles.fromReview} testID={`listing-photo-from-review-${i}`}>
                  {FROM_REVIEW_LABEL}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderText}>📷 No photos available</Text>
        </View>
      )}

      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{location.name}</Text>
          <TouchableOpacity
            onPress={() => setTab('reviews')}
            accessibilityRole="button"
            accessibilityLabel={`${ratingText}. Show reviews`}
            style={styles.headerRating}
            testID="header-rating"
          >
            <Text style={[styles.headerRatingText, !reviewCount && styles.headerNotRated]}>
              {ratingText}
            </Text>
          </TouchableOpacity>
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

          {/* Listing actions: shortcut for everyone. */}
          <View style={styles.listingActions}>
            <TouchableOpacity
              onPress={toggleShortcut}
              disabled={shortcutBusy}
              style={[styles.actionChip, hasShortcut && styles.actionChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: hasShortcut }}
              testID="shortcut-toggle"
            >
              <Text style={[styles.actionChipText, hasShortcut && styles.actionChipTextOn]}>
                {hasShortcut ? '★ Remove shortcut' : '☆ Add shortcut'}
              </Text>
            </TouchableOpacity>
          </View>
          {shortcutNotice ? (
            <Text style={styles.shortcutNotice} testID="shortcut-notice">
              {shortcutNotice}
            </Text>
          ) : null}
        </View>

        <View style={styles.tabs} accessibilityRole="tablist" testID="details-tabs">
          {DETAIL_TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.key }}
              testID={`tab-${t.key}`}
            >
              <Text
                style={[styles.tabText, tab === t.key && styles.tabTextActive]}
                numberOfLines={1}
              >
                {tabLabel(t.key, reviewCount, galleryImages.length)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'overview' ? (
          <View testID="tab-panel-overview">
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
                        {rate.name || rate.rate_type}{' '}
                        {rate.vehicle_type && `(${rate.vehicle_type})`}
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

            {/* Contact */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Contact</Text>
              <Text style={styles.contactText}>{location.contact || 'No contact provided'}</Text>
            </View>
          </View>
        ) : null}

        {tab === 'reviews' ? (
          <View testID="tab-panel-reviews">
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
                <View
                  key={review.id}
                  style={styles.reviewItem}
                  testID={`review-${review.author_id}`}
                >
                  <Text style={styles.reviewAuthor}>
                    {embeddedOne<any>(review.public_profiles)?.display_name || 'Anonymous'}
                  </Text>
                  {review.session_id || review.reservation_id ? (
                    <Text style={styles.bookedLabel} testID="booked-via-app">
                      Booked via app
                    </Text>
                  ) : null}
                  <Text style={styles.reviewRating}>{'⭐'.repeat(review.rating)}</Text>
                  {(() => {
                    const images = reviewImages(review);
                    if (!images.length) return null;
                    return (
                      <View style={styles.thumbRow} testID={`review-photos-${review.id}`}>
                        {images.map((img, i) => (
                          <TouchableOpacity
                            key={img.key}
                            onPress={() => setCarousel({ images, start: i })}
                            accessibilityRole="imagebutton"
                            accessibilityLabel={`Review photo ${i + 1} of ${images.length}`}
                            testID={`review-photo-${review.id}-${i}`}
                          >
                            <Image
                              source={{ uri: img.uri }}
                              style={styles.thumb}
                              resizeMode="cover"
                            />
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  })()}
                  {review.comment ? <Text style={styles.reviewText}>{review.comment}</Text> : null}
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
                  {(() => {
                    const mine = location.reviews?.find((r: any) => r.author_id === user.id);
                    const saved = sortReviewPhotos<any>(mine?.review_photos);
                    const room = photosLeft(saved.length, stagedPhotos.length);
                    return (
                      <View style={styles.formPhotos} testID="review-form-photos">
                        {saved.length + stagedPhotos.length > 0 ? (
                          <View style={styles.thumbRow}>
                            {saved.map((p: any) => (
                              <View key={p.id}>
                                <Image
                                  source={{ uri: reviewPhotoPublicUrl(p.storage_path) || '' }}
                                  style={styles.thumb}
                                  resizeMode="cover"
                                />
                                <TouchableOpacity
                                  style={styles.thumbRemove}
                                  onPress={() => removeSavedPhoto(p)}
                                  accessibilityLabel="Remove photo"
                                  testID={`review-photo-remove-${p.id}`}
                                >
                                  <Text style={styles.thumbRemoveText}>✕</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                            {stagedPhotos.map((p) => (
                              <View key={p.key}>
                                <Image
                                  source={{ uri: p.uri }}
                                  style={[styles.thumb, styles.thumbStaged]}
                                  resizeMode="cover"
                                />
                                <TouchableOpacity
                                  style={styles.thumbRemove}
                                  onPress={() =>
                                    setStagedPhotos((prev) => prev.filter((x) => x.key !== p.key))
                                  }
                                  accessibilityLabel="Remove photo"
                                  testID="review-photo-unstage"
                                >
                                  <Text style={styles.thumbRemoveText}>✕</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        {Platform.OS === 'web' ? (
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            data-testid="review-photo-file"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const files = Array.from(e.target.files || []);
                              e.target.value = '';
                              onReviewFiles(files, room);
                            }}
                          />
                        ) : null}
                        <Button
                          title={`Add photos (${saved.length + stagedPhotos.length}/${REVIEW_PHOTO_MAX})`}
                          size="small"
                          variant="outline"
                          onPress={addReviewPhoto}
                          disabled={room === 0 || reviewBusy}
                          testID="review-add-photo"
                        />
                        {stagedPhotos.length > 0 ? (
                          <Text style={styles.formPhotosHint}>
                            Photos are added when you submit the review
                          </Text>
                        ) : null}
                      </View>
                    );
                  })()}
                  <Button
                    title={reviewBusy ? 'Saving…' : 'Submit review'}
                    onPress={submitReview}
                    disabled={reviewBusy}
                    testID="review-submit"
                  />
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
          </View>
        ) : null}

        {tab === 'photos' ? (
          <View testID="tab-panel-photos">
            {galleryImages.length ? (
              <View style={styles.grid}>
                {galleryImages.map((img, i) => (
                  <TouchableOpacity
                    key={img.key}
                    onPress={() => setCarousel({ images: galleryImages, start: i })}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Photo ${i + 1} of ${galleryImages.length}${img.fromReview ? ', from a review' : ''}`}
                    testID={`grid-photo-${i}`}
                  >
                    <Image
                      source={{ uri: img.uri }}
                      style={[styles.gridImage, { width: gridSize, height: gridSize }]}
                      resizeMode="cover"
                    />
                    {img.fromReview ? <Text style={styles.gridFromReview}>Review</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.placeholderText} testID="photos-empty">
                No photos yet
              </Text>
            )}
          </View>
        ) : null}
      </View>
      <ImageCarousel
        images={carousel?.images ?? []}
        startIndex={carousel ? carousel.start : null}
        onClose={() => setCarousel(null)}
      />
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
  headerRating: { alignSelf: 'flex-start', marginBottom: theme.spacing.xs },
  headerRatingText: {
    ...theme.typography.bodySmall,
    color: theme.colors.warning,
    fontWeight: '600',
  },
  headerNotRated: { color: theme.colors.text.tertiary, fontWeight: '400' },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    marginBottom: theme.spacing.lg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: theme.colors.primary },
  tabText: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  tabTextActive: { color: theme.colors.primary, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridImage: { backgroundColor: theme.colors.surfaceDark },
  gridFromReview: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    color: '#fff',
    fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  fromReview: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    color: '#fff',
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
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
  listingActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  actionChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  actionChipOn: { borderColor: theme.colors.primary, backgroundColor: '#eff6ff' },
  actionChipText: {
    ...theme.typography.bodySmall,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  actionChipTextOn: { color: theme.colors.primary },
  shortcutNotice: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
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
  // Square thumbnails (cover-cropped) above a review's text.
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginVertical: theme.spacing.xs,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceDark,
    overflow: 'hidden',
  },
  thumbStaged: { opacity: 0.7 },
  thumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  formPhotos: { marginBottom: theme.spacing.sm, alignItems: 'flex-start' },
  formPhotosHint: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    marginTop: theme.spacing.xs,
  },
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
