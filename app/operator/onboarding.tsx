import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { FacilityPhotoField } from '../../src/components/FacilityPhotoField';
import { MapPinPicker } from '../../src/components/map/MapPinPicker';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';
import { PHOTO_UPLOAD_ERROR, uploadLocationPhoto } from '../../src/lib/storageUpload';
import { theme } from '../../src/lib/theme';
import {
  RATE_TYPES,
  RATE_TYPE_LABELS,
  defaultRateParams,
  describeDefaultRate,
  validateDefaultRate,
  type RateType,
} from '../../src/lib/rates';
import type { Coordinate } from '../../src/components/map/types';
import type { ProcessedImage } from '../../src/utils/processImage';
import { useBottomInset } from '../../src/hooks/useBottomInset';

type ListingType = 'commercial' | 'residential';

export default function OnboardingScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(0);
  const router = useRouter();
  const { user, initialize } = useAuthStore();
  // Synchronous guard: state updates are async, so a fast double tap could
  // otherwise start two create_location calls before `submitting` re-renders.
  const submitLock = React.useRef(false);
  const [step, setStep] = React.useState(1);
  const [locationName, setLocationName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [listingType, setListingType] = React.useState<ListingType>('commercial');
  const [pin, setPin] = React.useState<Coordinate>({ latitude: 16.412, longitude: 120.596 });
  const [capacity, setCapacity] = React.useState('10');
  const [rateType, setRateType] = React.useState<RateType>('hourly');
  const [rate, setRate] = React.useState('50.00');
  const [dailyRate, setDailyRate] = React.useState('');
  const [monthlyRate, setMonthlyRate] = React.useState('');
  const [firstHours, setFirstHours] = React.useState('3');
  const [firstAmount, setFirstAmount] = React.useState('');
  const [succeedingRate, setSucceedingRate] = React.useState('');
  const [rateSaved, setRateSaved] = React.useState(false);
  const [rules, setRules] = React.useState('');
  const [photo, setPhoto] = React.useState<ProcessedImage | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [createdLocationId, setCreatedLocationId] = React.useState<string | null>(null);
  const defaultRateIdRef = React.useRef<string | null>(null);
  const [photoError, setPhotoError] = React.useState<string | null>(null);

  const rateInput = {
    rateType,
    hourly: rate,
    daily: dailyRate,
    monthly: monthlyRate,
    firstHours,
    firstAmount,
    succeeding: succeedingRate,
  };

  const handleNext = () => {
    setError(null);
    if (step === 1 && (!locationName.trim() || !address.trim())) {
      setError('Name and address are required');
      return;
    }
    if (step === 3) {
      const cap = Number(capacity);
      if (!Number.isFinite(cap) || cap < 1) {
        setError('Capacity must be at least 1');
        return;
      }
      const rateError = validateDefaultRate(rateInput);
      if (rateError) {
        setError(rateError);
        return;
      }
    }
    if (step < 5) setStep(step + 1);
  };

  const handleBack = () => {
    setError(null);
    if (step > 1) setStep(step - 1);
  };

  const uploadCover = async (locationId: string) => {
    if (!photo) return true;
    const uploaded = await uploadLocationPhoto({
      locationId,
      filename: 'facility.jpg',
      base64: photo.base64,
      contentType: photo.contentType,
      isCover: true,
    });
    if (uploaded.error) {
      setPhotoError(uploaded.error || PHOTO_UPLOAD_ERROR);
      return false;
    }
    setPhotoError(null);
    return true;
  };

  const openListing = (locationId: string) => {
    // Replace the form in history so Back cannot return to a submitted form.
    router.replace(`/location/${locationId}`);
  };

  const handleFinish = async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setPhotoError(null);
    let navigated = false;
    try {
      let locationId = createdLocationId;
      if (!locationId) {
        const { data, error: rpcError } = await supabase.rpc('create_location', {
          p_name: locationName.trim(),
          p_address: address.trim(),
          p_lat: pin.latitude,
          p_lng: pin.longitude,
          p_capacity: Number(capacity),
          // create_location always seeds an hourly default; it is retyped below.
          p_hourly_amount: rateType === 'hourly' ? Number(rate) : 0,
          p_listing_type: listingType,
          p_rules: rules.trim() || null,
        });
        if (rpcError) throw rpcError;
        if (data?.error) {
          setError(String(data.error));
          return;
        }
        locationId = data.location_id as string;
        setCreatedLocationId(locationId);
        defaultRateIdRef.current = data.rate_id ?? null;
      }

      if (rateType !== 'hourly' && !rateSaved && locationId) {
        const { data: rateData, error: rateError } = await supabase.rpc('upsert_rate', {
          p_location_id: locationId,
          p_name: 'Standard Rate',
          p_rate_id: defaultRateIdRef.current,
          p_is_default: true,
          ...defaultRateParams(rateInput),
        });
        if (rateError || rateData?.error) {
          setError(
            `Listing created, but the ${RATE_TYPE_LABELS[rateType].toLowerCase()} rate was not saved: ${
              rateError?.message || String(rateData?.error)
            }. Tap Retry to save it.`
          );
          return;
        }
        setRateSaved(true);
      }

      if (user && user.account_type !== 'operator') {
        const { error: typeError } = await supabase
          .from('profiles')
          .update({ account_type: 'operator' })
          .eq('id', user.id);
        if (typeError) throw typeError;
        await initialize();
      }

      if (photo && locationId) {
        const uploaded = await uploadCover(locationId);
        if (!uploaded) {
          // Listing exists; let the operator retry the photo or continue without it.
          setSuccess(`Submitted ${locationName.trim()} for verification`);
          return;
        }
      }

      navigated = true;
      openListing(locationId!);
    } catch (err: any) {
      setError(err.message || 'Could not create location');
    } finally {
      if (!navigated) {
        submitLock.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="onboarding-ready"
    >
      <View style={styles.progress}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={[styles.progressDot, i <= step && styles.progressDotActive]} />
        ))}
      </View>

      <Text style={styles.stepTitle} testID="onboarding-step">
        Step {step} of 5
      </Text>

      {step === 1 && (
        <View style={styles.stepContent} testID="onboarding-step-1">
          <Text style={styles.stepHeading}>Basic Information</Text>

          <Text style={styles.label}>Location Name *</Text>
          <TextInput
            style={styles.input}
            value={locationName}
            onChangeText={setLocationName}
            placeholder="e.g., SM City Baguio Parking"
            testID="onboarding-name"
          />

          <Text style={styles.label}>Address *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={address}
            onChangeText={setAddress}
            placeholder="Full address"
            multiline
            numberOfLines={3}
            testID="onboarding-address"
          />

          <Text style={styles.label}>Listing type</Text>
          <View style={styles.row}>
            {(['commercial', 'residential'] as ListingType[]).map((type) => (
              <Button
                key={type}
                title={type === 'commercial' ? 'Commercial' : 'Residential'}
                variant={listingType === type ? 'primary' : 'outline'}
                size="small"
                onPress={() => setListingType(type)}
              />
            ))}
          </View>
        </View>
      )}

      {step === 2 && (
        <View style={styles.stepContent} testID="onboarding-step-2">
          <Text style={styles.stepHeading}>Drop a pin</Text>
          <Text style={styles.help}>Tap the map to set the exact entrance.</Text>
          <MapPinPicker initialCoordinate={pin} onCoordinateSelect={setPin} />
        </View>
      )}

      {step === 3 && (
        <View style={styles.stepContent} testID="onboarding-step-3">
          <Text style={styles.stepHeading}>Capacity and rate</Text>

          <Text style={styles.label}>Total Capacity *</Text>
          <TextInput
            style={styles.input}
            value={capacity}
            onChangeText={setCapacity}
            placeholder="10"
            keyboardType="numeric"
            testID="onboarding-capacity"
          />

          <Text style={styles.label}>Default rate type *</Text>
          <View style={styles.chips}>
            {RATE_TYPES.map((type) => (
              <Button
                key={type}
                title={RATE_TYPE_LABELS[type]}
                variant={rateType === type ? 'primary' : 'outline'}
                size="small"
                onPress={() => setRateType(type)}
                testID={`onboarding-rate-type-${type}`}
              />
            ))}
          </View>

          {rateType === 'hourly' && (
            <>
              <Text style={styles.label}>Hourly Rate (₱) *</Text>
              <TextInput
                style={styles.input}
                value={rate}
                onChangeText={setRate}
                placeholder="50.00"
                keyboardType="decimal-pad"
                testID="onboarding-rate"
              />
            </>
          )}
          {rateType === 'daily' && (
            <>
              <Text style={styles.label}>Daily Rate (₱) *</Text>
              <TextInput
                style={styles.input}
                value={dailyRate}
                onChangeText={setDailyRate}
                placeholder="300.00"
                keyboardType="decimal-pad"
                testID="onboarding-rate-daily"
              />
            </>
          )}
          {rateType === 'monthly' && (
            <>
              <Text style={styles.label}>Monthly Rate (₱) *</Text>
              <TextInput
                style={styles.input}
                value={monthlyRate}
                onChangeText={setMonthlyRate}
                placeholder="3500.00"
                keyboardType="decimal-pad"
                testID="onboarding-rate-monthly"
              />
            </>
          )}
          {rateType === 'flat_then_hourly' && (
            <>
              <Text style={styles.label}>First N hours *</Text>
              <TextInput
                style={styles.input}
                value={firstHours}
                onChangeText={setFirstHours}
                placeholder="3"
                keyboardType="numeric"
                testID="onboarding-rate-first-hours"
              />
              <Text style={styles.label}>Flat amount for the first N hours (₱) *</Text>
              <TextInput
                style={styles.input}
                value={firstAmount}
                onChangeText={setFirstAmount}
                placeholder="100.00"
                keyboardType="decimal-pad"
                testID="onboarding-rate-first-amount"
              />
              <Text style={styles.label}>Succeeding hourly rate (₱) *</Text>
              <TextInput
                style={styles.input}
                value={succeedingRate}
                onChangeText={setSucceedingRate}
                placeholder="30.00"
                keyboardType="decimal-pad"
                testID="onboarding-rate-succeeding"
              />
            </>
          )}

          <View style={styles.info}>
            <Text style={styles.infoText}>✓ Default rate type: {RATE_TYPE_LABELS[rateType]}</Text>
            <Text style={styles.infoText}>✓ You can add more rates later under Rates</Text>
            {rateType === 'hourly' || rateType === 'flat_then_hourly' ? (
              <Text style={styles.infoText}>✓ Billing is per started hour</Text>
            ) : null}
          </View>
        </View>
      )}

      {step === 4 && (
        <View style={styles.stepContent} testID="onboarding-step-4">
          <Text style={styles.stepHeading}>Rules and photo</Text>

          <Text style={styles.label}>House rules (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={rules}
            onChangeText={setRules}
            placeholder="Hours, height limit, overnight policy…"
            multiline
            numberOfLines={4}
            testID="onboarding-rules"
          />

          <Text style={styles.label}>Facility photo (optional)</Text>
          <FacilityPhotoField photo={photo} onChange={setPhoto} testID="onboarding-photo" />

          <View style={styles.info}>
            <Text style={styles.infoTitle}>Cash only (Phase 1)</Text>
            <Text style={styles.infoText}>✓ Accept cash at the location</Text>
            <Text style={styles.infoText}>✓ GCash/Maya come later — no commissions</Text>
          </View>
        </View>
      )}

      {step === 5 && (
        <View style={styles.stepContent} testID="onboarding-step-5">
          <Text style={styles.stepHeading}>Review & Submit</Text>

          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Location</Text>
            <Text style={styles.reviewValue}>{locationName}</Text>
          </View>
          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Address</Text>
            <Text style={styles.reviewValue}>{address}</Text>
          </View>
          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Type</Text>
            <Text style={styles.reviewValue}>{listingType}</Text>
          </View>
          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Pin</Text>
            <Text style={styles.reviewValue}>
              {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
            </Text>
          </View>
          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Capacity</Text>
            <Text style={styles.reviewValue}>{capacity} spaces</Text>
          </View>
          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Rate</Text>
            <Text style={styles.reviewValue}>{describeDefaultRate(rateInput)}</Text>
          </View>
          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Rules</Text>
            <Text style={styles.reviewValue}>{rules.trim() || 'None'}</Text>
          </View>
          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Photo</Text>
            {photo?.uri ? (
              <Image
                source={{ uri: photo.uri }}
                style={styles.reviewPhoto}
                testID="onboarding-photo-preview"
              />
            ) : (
              <Text style={styles.reviewValue}>None</Text>
            )}
          </View>
          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Payment</Text>
            <Text style={styles.reviewValue}>Cash only</Text>
          </View>

          <View style={styles.info}>
            <Text style={styles.infoText}>
              Your listing will be published as Unverified until an admin reviews it.
            </Text>
          </View>
        </View>
      )}

      {error ? (
        <Text style={styles.error} testID="onboarding-error">
          {error}
        </Text>
      ) : null}
      {success ? (
        <Text style={styles.success} testID="onboarding-success">
          {success}
        </Text>
      ) : null}
      {photoError && createdLocationId ? (
        <View style={styles.photoRetry} testID="onboarding-photo-failed">
          <Text style={styles.error}>{photoError}</Text>
          <Button
            title="Retry photo"
            variant="outline"
            onPress={handleFinish}
            loading={submitting}
            testID="onboarding-photo-retry"
          />
          <Button
            title="Continue without photo"
            variant="outline"
            onPress={() => openListing(createdLocationId)}
            disabled={submitting}
            testID="onboarding-skip-photo"
          />
        </View>
      ) : null}

      <View style={styles.navigation}>
        {step > 1 && !createdLocationId && (
          <Button title="Back" variant="outline" onPress={handleBack} disabled={submitting} />
        )}
        {createdLocationId ? (
          photoError ? null : (
            <>
              <Button
                title="Retry"
                onPress={handleFinish}
                loading={submitting}
                disabled={submitting}
                testID="onboarding-retry"
                style={{ flex: 1 }}
              />
              <Button
                title="Open listing"
                variant="outline"
                onPress={() => openListing(createdLocationId)}
                disabled={submitting}
                testID="onboarding-open-listing"
              />
            </>
          )
        ) : step < 5 ? (
          <Button
            title="Next"
            onPress={handleNext}
            testID="onboarding-next"
            style={{ flex: 1, marginLeft: step > 1 ? theme.spacing.md : 0 }}
          />
        ) : (
          <Button
            title="Submit for Verification"
            onPress={handleFinish}
            loading={submitting}
            disabled={submitting}
            testID="onboarding-submit"
            style={{ flex: 1, marginLeft: theme.spacing.md }}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  progress: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.lg,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.border,
  },
  progressDotActive: {
    backgroundColor: theme.colors.primary,
  },
  stepTitle: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  stepContent: {
    padding: theme.spacing.lg,
  },
  stepHeading: {
    ...theme.typography.h3,
    marginBottom: theme.spacing.md,
  },
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    fontSize: 16,
    backgroundColor: theme.colors.surface,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  help: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.md,
  },
  reviewPhoto: {
    width: '100%',
    height: 160,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceDark,
  },
  photoRetry: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  info: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceDark,
    borderRadius: theme.borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
  },
  infoTitle: {
    ...theme.typography.body,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  infoText: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
  },
  reviewItem: {
    marginBottom: theme.spacing.md,
  },
  reviewLabel: {
    ...theme.typography.caption,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  reviewValue: {
    ...theme.typography.body,
    fontWeight: '500',
  },
  navigation: {
    flexDirection: 'row',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  error: {
    ...theme.typography.body,
    color: theme.colors.danger,
    paddingHorizontal: theme.spacing.lg,
  },
  success: {
    ...theme.typography.body,
    color: theme.colors.success,
    paddingHorizontal: theme.spacing.lg,
    fontWeight: '600',
  },
});
