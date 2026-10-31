import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../../src/components/Button';
import { FacilityPhotoField } from '../../../src/components/FacilityPhotoField';
import { MapPinPicker } from '../../../src/components/map/MapPinPicker';
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
  const id = firstParam(useLocalSearchParams<{ id: string | string[] }>().id);
  const [name, setName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [rules, setRules] = React.useState('');
  const [capacity, setCapacity] = React.useState('');
  const [pin, setPin] = React.useState<Coordinate>({ latitude: 16.412, longitude: 120.596 });
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
          .select('name, address, rules, capacity, location_photos(storage_path, is_cover)')
          .eq('id', id)
          .single();
        if (fetchError) throw fetchError;
        setName(data.name);
        setAddress(data.address);
        setRules(data.rules || '');
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
          setPin({ latitude: Number(match.lat), longitude: Number(match.lng) });
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load location');
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
      const { data, error: rpcError } = await supabase.rpc('update_location', {
        p_location_id: id,
        p_name: name.trim(),
        p_address: address.trim(),
        p_lat: pin.latitude,
        p_lng: pin.longitude,
        p_capacity: Number(capacity),
        p_rules: rules,
      });
      if (rpcError) throw rpcError;
      if (data?.error) {
        setError(String(data.error));
        return;
      }
      setSuccess('Location updated');
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
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="edit-ready">
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} testID="edit-name" />

      <Text style={styles.label}>Address</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={address}
        onChangeText={setAddress}
        multiline
        testID="edit-address"
      />

      <Text style={styles.label}>Capacity</Text>
      <TextInput
        style={styles.input}
        value={capacity}
        onChangeText={setCapacity}
        keyboardType="numeric"
      />

      <Text style={styles.label}>Rules</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={rules}
        onChangeText={setRules}
        multiline
        testID="edit-rules"
      />

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
      <MapPinPicker initialCoordinate={pin} onCoordinateSelect={setPin} />

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
              if (uploaded) setSuccess('Location updated');
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
