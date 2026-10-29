import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { Button } from '../../src/components/Button';
import { theme } from '../../src/lib/theme';

export default function OnboardingScreen() {
  const [step, setStep] = React.useState(1);
  const [locationName, setLocationName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [capacity, setCapacity] = React.useState('10');
  const [rate, setRate] = React.useState('50.00');

  const handleNext = () => {
    if (step < 5) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFinish = async () => {
    // Submit operator and location creation
    console.log('Creating location...');
  };

  return (
    <ScrollView style={styles.container}>
      {/* Progress indicator */}
      <View style={styles.progress}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={[styles.progressDot, i <= step && styles.progressDotActive]}
          />
        ))}
      </View>

      <Text style={styles.title}>List Your Parking Space</Text>
      <Text style={styles.stepTitle}>Step {step} of 5</Text>

      {/* Step 1: Basic Info */}
      {step === 1 && (
        <View style={styles.stepContent}>
          <Text style={styles.stepHeading}>Basic Information</Text>
          
          <Text style={styles.label}>Location Name *</Text>
          <TextInput
            style={styles.input}
            value={locationName}
            onChangeText={setLocationName}
            placeholder="e.g., SM City Baguio Parking"
          />

          <Text style={styles.label}>Address *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={address}
            onChangeText={setAddress}
            placeholder="Full address"
            multiline
            numberOfLines={3}
          />

          <View style={styles.info}>
            <Text style={styles.infoText}>✓ Default tracking mode: Count-only (you update available spaces)</Text>
            <Text style={styles.infoText}>✓ You can change this later to slot tracking or open/full mode</Text>
          </View>
        </View>
      )}

      {/* Step 2: Capacity */}
      {step === 2 && (
        <View style={styles.stepContent}>
          <Text style={styles.stepHeading}>Capacity</Text>
          
          <Text style={styles.label}>Total Capacity *</Text>
          <TextInput
            style={styles.input}
            value={capacity}
            onChangeText={setCapacity}
            placeholder="10"
            keyboardType="numeric"
          />

          <View style={styles.info}>
            <Text style={styles.infoText}>✓ How many vehicles can you accommodate at once?</Text>
            <Text style={styles.infoText}>✓ You can adjust this later</Text>
          </View>
        </View>
      )}

      {/* Step 3: Rates */}
      {step === 3 && (
        <View style={styles.stepContent}>
          <Text style={styles.stepHeading}>Set Your Rate</Text>
          
          <Text style={styles.label}>Hourly Rate (₱) *</Text>
          <TextInput
            style={styles.input}
            value={rate}
            onChangeText={setRate}
            placeholder="50.00"
            keyboardType="decimal-pad"
          />

          <View style={styles.info}>
            <Text style={styles.infoText}>✓ Default rate type: Hourly</Text>
            <Text style={styles.infoText}>✓ You can add daily, monthly, and custom rates later</Text>
            <Text style={styles.infoText}>✓ Billing is per started hour</Text>
          </View>
        </View>
      )}

      {/* Step 4: Payment */}
      {step === 4 && (
        <View style={styles.stepContent}>
          <Text style={styles.stepHeading}>Payment Method</Text>
          
          <View style={styles.info}>
            <Text style={styles.infoTitle}>Cash Only (Default)</Text>
            <Text style={styles.infoText}>✓ Accept cash payments at your location</Text>
            <Text style={styles.infoText}>✓ You can add GCash/Maya later</Text>
            <Text style={styles.infoText}>✓ No commissions for Phase 1</Text>
          </View>
        </View>
      )}

      {/* Step 5: Review */}
      {step === 5 && (
        <View style={styles.stepContent}>
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
            <Text style={styles.reviewLabel}>Capacity</Text>
            <Text style={styles.reviewValue}>{capacity} spaces</Text>
          </View>

          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Rate</Text>
            <Text style={styles.reviewValue}>₱{rate}/hour</Text>
          </View>

          <View style={styles.reviewItem}>
            <Text style={styles.reviewLabel}>Payment</Text>
            <Text style={styles.reviewValue}>Cash only</Text>
          </View>

          <View style={styles.info}>
            <Text style={styles.infoText}>Your listing will be submitted for admin verification before going live.</Text>
          </View>
        </View>
      )}

      {/* Navigation */}
      <View style={styles.navigation}>
        {step > 1 && (
          <Button
            title="Back"
            variant="outline"
            onPress={handleBack}
          />
        )}
        {step < 5 ? (
          <Button
            title="Next"
            onPress={handleNext}
            style={{ flex: 1, marginLeft: step > 1 ? theme.spacing.md : 0 }}
          />
        ) : (
          <Button
            title="Submit for Verification"
            onPress={handleFinish}
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
  title: {
    ...theme.typography.h2,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg,
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
    marginBottom: theme.spacing.lg,
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
});
