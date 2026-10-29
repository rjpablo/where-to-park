import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { AvailabilityBadge } from '../../src/components/AvailabilityBadge';
import { supabase } from '../../src/lib/supabase';
import { formatPeso, formatDistance } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';

export default function LocationDetailScreen() {
  const { id } = useLocalSearchParams();
  const [location, setLocation] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLocation();
  }, [id]);

  const loadLocation = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select(
          `
          *,
          location_photos(*),
          location_policies(*),
          rates(*),
          reviews(*, profiles(display_name))
        `
        )
        .eq('id', id)
        .single();

      if (error) throw error;
      setLocation(data);
    } catch (error) {
      console.error('Load location error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = () => {
    if (!location) return;

    // Extract coordinates from geography
    const lat = location.geog ? parseFloat(location.geog.coordinates[1]) : 16.4120;
    const lng = location.geog ? parseFloat(location.geog.coordinates[0]) : 120.5960;
    
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    Linking.openURL(url);
  };

  if (loading || !location) {
    return (
      <View style={styles.loading}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Photo Gallery or Placeholder */}
      {location.location_photos?.length > 0 ? (
        <ScrollView horizontal style={styles.photoGallery}>
          {location.location_photos.map((photo: any) => (
            <Image key={photo.id} source={{ uri: photo.url }} style={styles.photo} />
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
          <Text style={styles.address}>{location.address}</Text>

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

        {/* Navigate Button */}
        <Button
          title="Navigate"
          onPress={handleNavigate}
          style={{ marginBottom: theme.spacing.lg }}
        />

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
          <Text style={styles.sectionTitle}>Reviews ({location.rating_count || 0})</Text>
          {location.rating_avg && (
            <View style={styles.ratingDisplay}>
              <Text style={styles.ratingNumber}>{location.rating_avg.toFixed(1)}</Text>
              <Text style={styles.ratingStars}>⭐</Text>
            </View>
          )}

          {location.reviews?.slice(0, 3).map((review: any) => (
            <View key={review.id} style={styles.reviewItem}>
              <Text style={styles.reviewAuthor}>
                {review.profiles?.display_name || 'Anonymous'}
              </Text>
              <Text style={styles.reviewRating}>{'⭐'.repeat(review.rating)}</Text>
              <Text style={styles.reviewText}>{review.comment}</Text>
            </View>
          ))}
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
});
