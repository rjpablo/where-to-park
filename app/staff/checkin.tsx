import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { WorkspaceNav } from '../../src/components/WorkspaceNav';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';

export default function CheckInScreen() {
  const locationId = firstParam(
    useLocalSearchParams<{ locationId?: string | string[] }>().locationId
  );
  const [locationName, setLocationName] = useState('Listing');
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<'car' | 'suv' | 'van' | 'motorcycle' | 'truck'>(
    'car'
  );
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) return;
    supabase
      .from('locations')
      .select('name')
      .eq('id', locationId)
      .single()
      .then(({ data }) => {
        if (data?.name) setLocationName(data.name);
      });
  }, [locationId]);

  const handleCheckIn = async () => {
    if (!plate.trim()) {
      setError('Plate number is required');
      return;
    }
    if (!locationId) {
      setError('Pick a listing from My listings');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('start_walk_in', {
        p_location_id: locationId,
        p_vehicle_type: vehicleType,
        p_plate: plate.trim(),
        p_note: note.trim() || null,
        p_scheduled_end_at: null,
      });

      if (rpcError) throw rpcError;
      if (data?.error) {
        if (data.error === 'no_longer_available') {
          setError('No space available — this space was just taken');
        } else {
          setError(String(data.error));
        }
        return;
      }

      setSuccess(`Checked in ${plate.trim()}`);
      setPlate('');
      setNote('');
    } catch (err: any) {
      setError(err.message || 'Check-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} testID="checkin-ready">
      <WorkspaceNav listingId={locationId} />
      <View style={styles.header}>
        <Text style={styles.title}>Walk-In Check-In</Text>
        <Text style={styles.subtitle}>{locationName}</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Vehicle Type *</Text>
        <View style={styles.vehicleTypes}>
          {['car', 'suv', 'van', 'motorcycle', 'truck'].map((type) => (
            <Button
              key={type}
              title={type.toUpperCase()}
              variant={vehicleType === type ? 'primary' : 'outline'}
              size="small"
              onPress={() => setVehicleType(type as any)}
            />
          ))}
        </View>

        <Text style={styles.label}>Plate Number *</Text>
        <TextInput
          style={styles.input}
          value={plate}
          onChangeText={setPlate}
          placeholder="ABC 1234"
          autoCapitalize="characters"
          testID="checkin-plate"
        />

        <Text style={styles.label}>Note (Optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={note}
          onChangeText={setNote}
          placeholder="e.g., Visitor, VIP guest"
          multiline
          numberOfLines={3}
        />

        {error ? (
          <Text style={styles.errorText} testID="checkin-error">
            Error: {error}
          </Text>
        ) : null}
        {success ? (
          <Text style={styles.successText} testID="checkin-success">
            {success}
          </Text>
        ) : null}

        <TouchableOpacity testID="checkin-submit">
          <Button title="Check In" onPress={handleCheckIn} loading={loading} />
        </TouchableOpacity>
      </View>

      <View style={styles.info}>
        <Text style={styles.infoTitle}>Check-In Details</Text>
        <Text style={styles.infoText}>• Clock starts immediately</Text>
        <Text style={styles.infoText}>• Vehicle type determines applicable rate</Text>
        <Text style={styles.infoText}>• Available count will decrease by 1</Text>
        <Text style={styles.infoText}>• No driver account needed</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
  },
  title: {
    ...theme.typography.h2,
    color: '#fff',
  },
  subtitle: {
    ...theme.typography.body,
    color: '#fff',
    opacity: 0.9,
    marginTop: theme.spacing.xs,
  },
  form: {
    padding: theme.spacing.lg,
  },
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  vehicleTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
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
  errorText: {
    ...theme.typography.body,
    color: theme.colors.danger,
    marginVertical: theme.spacing.md,
  },
  successText: {
    ...theme.typography.body,
    color: theme.colors.success,
    marginVertical: theme.spacing.md,
  },
  info: {
    margin: theme.spacing.lg,
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
});
