import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Alert } from 'react-native';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';

export default function CheckInScreen() {
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<'car' | 'suv' | 'van' | 'motorcycle' | 'truck'>('car');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCheckIn = async () => {
    if (!plate.trim()) {
      Alert.alert('Error', 'Plate number is required');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('start_walk_in', {
        p_location_id: 'location-id-here',
        p_vehicle_type: vehicleType,
        p_plate: plate.trim(),
        p_note: note.trim() || null,
        p_scheduled_end_at: null,
      });

      if (error) {
        if (error.message === 'no_longer_available') {
          Alert.alert('No Space Available', 'This space was just taken by another booking');
        } else {
          throw error;
        }
        return;
      }

      Alert.alert('Success', 'Walk-in checked in successfully');
      setPlate('');
      setNote('');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Walk-In Check-In</Text>
        <Text style={styles.subtitle}>Session Road Park n Ride</Text>
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

        <Button
          title="Check In"
          onPress={handleCheckIn}
          loading={loading}
        />
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
