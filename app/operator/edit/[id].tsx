import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Switch } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../../src/components/Button';
import { FacilityPhotoField } from '../../../src/components/FacilityPhotoField';
import { MapPinPicker } from '../../../src/components/map/MapPinPicker';
import { getGeocoder, resolveListingAddress } from '../../../src/lib/geocoding';
import { reservationErrorMessage } from '../../../src/lib/reservations';
import { supabase } from '../../../src/lib/supabase';
import { firstParam } from '../../../src/lib/params';
import {
  PHOTO_UPLOAD_ERROR,
  locationPhotoPublicUrl,
  uploadLocationPhoto,
} from '../../../src/lib/storageUpload';
import { theme } from '../../../src/lib/theme';
import type { Coordinate } from '../../../src/components/map/types';
import type { ProcessedImage } from '../../../src/utils/processImage';
import { useBottomInset } from '../../../src/hooks/useBottomInset';

export default function EditLocationScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const id = firstParam(useLocalSearchParams<{ id: string | string[] }>().id);
  const [pageScroll, setPageScroll] = React.useState(true);
  const [name, setName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [addressDerived, setAddressDerived] = React.useState(false);
  const [rules, setRules] = React.useState('');
  const [allowReservations, setAllowReservations] = React.useState(false);
  const [capacity, setCapacity] = React.useState('');
  const [pin, setPin] = React.useState<Coordinate>({ latitude: 16.412, longitude: 120.596 });
  // The pin as last saved (null until loaded); 'Restore saved pin' goes back here.
  const [savedPin, setSavedPin] = React.useState<Coordinate | null>(null);
  const [photo, setPhoto] = React.useState<ProcessedImage | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const [photoDirty, setPhotoDirty] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fetchError } = await supabase
          .from('locations')
          .select(
            'name, address, rules, capacity, location_photos(storage_path, is_cover), location_policies(reservations_enabled)'
          )
          .eq('id', id)
          .single();
        if (fetchError) throw fetchError;
        setName(data.name);
        setAddress(data.address);
        setRules(data.rules || '');
        const policy = Array.isArray(data.location_policies)
          ? data.location_policies[0]
          : data.location_policies;
        setAllowReservations(policy?.reservations_enabled === true);
        setCapacity(String(data.capacity));
        const cover =
          (data.location_photos || []).find((p: any) => p.is_cover) || data.location_photos?.[0];
        const coverUrl = locationPhotoPublicUrl(cover?.storage_path);
        if (coverUrl) {
          setPhoto({
            uri: coverUrl,
            base64: '',
            contentType: 'image/jpeg',
            filename: 'facility.jpg',
          });
          setPhotoDirty(false);
        }

        const { data: geo } = await supabase.rpc('search_nearby', {
          p_lat: 16.412,
          p_lng: 120.596,
          p_radius_m: 20000,
        });
        const match = (geo || []).find((row: any) => row.id === id);
        if (match) {
          const loaded = { latitude: Number(match.lat), longitude: Number(match.lng) };
          setPin(loaded);
          setSavedPin(loaded);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load the listing');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const uploadCover = async () => {
    if (!id || !photo?.base64 || !photoDirty) return true;
    const uploaded = await uploadLocationPhoto({
      locationId: id,
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
    setPhotoDirty(false);
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    setPhotoError(null);
    try {
      const listingAddress = await resolveListingAddress(address, pin, (coordinate) =>
        getGeocoder().reverseAddress(coordinate)
      );
      if (listingAddress !== address) setAddress(listingAddress);
      const { data, error: rpcError } = await supabase.rpc('update_location', {
        p_location_id: id,
        p_name: name.trim(),
        p_address: listingAddress,
        p_lat: pin.latitude,
        p_lng: pin.longitude,
        p_rules: rules,
      });
      if (rpcError) throw rpcError;
      if (data?.error) {
        setError(String(data.error));
        return;
      }
      const { data: flagData, error: flagError } = await supabase.rpc('set_reservation_requests', {
        p_location_id: id,
        p_enabled: allowReservations,
      });
      if (flagError || flagData?.error) {
        setError(flagError?.message || reservationErrorMessage(flagData?.error));
        return;
      }
      setSuccess('Listing updated');
      setSavedPin(pin);
      if (photo?.base64 && photoDirty) {
        const uploaded = await uploadCover();
        if (!uploaded) return;
      }
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="edit-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      // Off while a finger is on the map pin picker, so the map pans / zooms (not the page).
      scrollEnabled={pageScroll}
      // Taps on place-search suggestions work with the keyboard open.
      keyboardShouldPersistTaps="handled"
      testID="edit-ready"
    >
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} testID="edit-name" />

      {/* rj t139u: spots and vehicle types are set per area (Main and any others). */}
      <Text style={styles.label}>Spots</Text>
      <Text style={styles.areasNote} testID="edit-spots-note">
        {capacity} counted spots. Total spots, vehicle types and monitoring are set per area.
      </Text>
      <Button
        title="Manage areas"
        variant="outline"
        size="small"
        onPress={() => router.push({ pathname: '/operator/areas', params: { locationId: id! } })}
        testID="edit-manage-areas"
        style={{ alignSelf: 'flex-start', marginBottom: theme.spacing.md }}
      />

      <Text style={styles.label}>Rules</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={rules}
        onChangeText={setRules}
        multiline
        testID="edit-rules"
      />

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Allow reservation requests</Text>
          <Text style={styles.switchHint}>
            Drivers can ask for a future stay. You approve or reject each request.
          </Text>
        </View>
        <Switch
          value={allowReservations}
          onValueChange={setAllowReservations}
          accessibilityLabel="Allow reservation requests"
          testID="edit-reservations"
        />
      </View>

      <Text style={styles.label}>Facility photo</Text>
      <FacilityPhotoField
        photo={photo}
        onChange={(next) => {
          setPhoto(next);
          setPhotoDirty(!!next?.base64);
          setPhotoError(null);
        }}
        error={photoError}
        testID="edit-photo"
      />

      <Text style={styles.label}>Map pin</Text>
      <MapPinPicker
        initialCoordinate={pin}
        onCoordinateSelect={setPin}
        onMapGestureChange={(active) => setPageScroll(!active)}
        savedCoordinate={savedPin}
        address={address}
        onAddressChange={setAddress}
        addressDerived={addressDerived}
        onAddressDerivedChange={setAddressDerived}
        addressTestID="edit-address"
      />

      {error ? (
        <Text style={styles.error} testID="edit-error">
          {error}
        </Text>
      ) : null}
      {success ? (
        <Text style={styles.success} testID="edit-success">
          {success}
        </Text>
      ) : null}
      {photoError ? (
        <Button
          title="Retry photo"
          variant="outline"
          onPress={async () => {
            setSaving(true);
            setPhotoError(null);
            try {
              const uploaded = await uploadCover();
              if (uploaded) setSuccess('Listing updated');
            } finally {
              setSaving(false);
            }
          }}
          loading={saving}
          testID="edit-photo-retry"
        />
      ) : null}

      <Button title="Save changes" onPress={handleSave} loading={saving} testID="edit-save" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  switchLabel: { ...theme.typography.body, fontWeight: '600', color: theme.colors.text.primary },
  switchHint: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: 2,
  },
  areasNote: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
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
  error: {
    ...theme.typography.body,
    color: theme.colors.danger,
    marginVertical: theme.spacing.md,
  },
  success: {
    ...theme.typography.body,
    color: theme.colors.success,
    marginVertical: theme.spacing.md,
    fontWeight: '600',
  },
});
