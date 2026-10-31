import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { rateErrorMessage } from '../../src/lib/rates';
import {
  NEW_RATE,
  formFromRate,
  rateDatesError,
  rateUpsertPayload,
  type RateFormValues,
  WEEK_DAYS,
  toggleDay,
} from '../../src/lib/rateForm';

const RATE_TYPES = ['hourly', 'daily', 'flat_then_hourly', 'monthly'] as const;

// New rate / Edit rate (its own page). Saving returns to the Rates list.
export default function RateEditScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    locationId?: string | string[];
    rateId?: string | string[];
  }>();
  const locationId = firstParam(params.locationId);
  const rateId = firstParam(params.rateId);
  const [v, setV] = React.useState<RateFormValues>(NEW_RATE);
  const [existing, setExisting] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(!!rateId);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [locationName, setLocationName] = React.useState('');

  const set = <K extends keyof RateFormValues>(k: K, x: RateFormValues[K]) =>
    setV((cur) => ({ ...cur, [k]: x }));

  React.useEffect(() => {
    navigation.setOptions({ title: rateId ? 'Edit rate' : 'New rate' });
  }, [navigation, rateId]);

  React.useEffect(() => {
    if (!locationId) {
      setError('Pick a listing from My listings');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [loc, rate] = await Promise.all([
        supabase.from('locations').select('name').eq('id', locationId).single(),
        rateId
          ? supabase
              .from('rates')
              .select('*')
              .eq('id', rateId)
              .eq('location_id', locationId)
              .single()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      if (loc.data?.name) setLocationName(loc.data.name);
      if (rateId) {
        if (rate.error || !rate.data) setError('Rate not found');
        else {
          setExisting(rate.data);
          setV(formFromRate(rate.data));
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, rateId]);

  const backToRates = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/operator/rates', params: { locationId: locationId! } });
  };

  const save = async () => {
    if (!locationId) return;
    setError(null);
    const dateErr = rateDatesError(v);
    if (dateErr) return setError(dateErr);
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc(
      'upsert_rate',
      rateUpsertPayload(locationId, v, existing ?? undefined)
    );
    setSaving(false);
    if (rpcError || data?.error) {
      setError(rpcError?.message || rateErrorMessage(data?.error));
      return;
    }
    backToRates();
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="rate-edit-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="rate-edit-ready"
    >
      {locationName ? <Text style={styles.subtitle}>{locationName}</Text> : null}
      {existing?.is_default ? (
        <Text style={styles.meta}>This is the listing's default rate.</Text>
      ) : null}
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={v.name}
        onChangeText={(x) => set('name', x)}
        testID="rate-name"
      />

      <Text style={styles.label}>Type</Text>
      <View style={styles.types}>
        {RATE_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            onPress={() => set('rateType', type)}
            style={[styles.typeChip, v.rateType === type && styles.typeChipOn]}
            testID={`rate-type-${type}`}
          >
            <Text style={[styles.typeChipText, v.rateType === type && styles.typeChipTextOn]}>
              {type === 'flat_then_hourly' ? 'flat then hourly' : type}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {v.rateType === 'hourly' && (
        <>
          <Text style={styles.label}>Hourly amount (₱)</Text>
          <TextInput
            style={styles.input}
            value={v.hourly}
            onChangeText={(x) => set('hourly', x)}
            keyboardType="decimal-pad"
          />
        </>
      )}
      {v.rateType === 'daily' && (
        <>
          <Text style={styles.label}>Daily amount (₱)</Text>
          <TextInput
            style={styles.input}
            value={v.daily}
            onChangeText={(x) => set('daily', x)}
            keyboardType="decimal-pad"
          />
        </>
      )}
      {v.rateType === 'monthly' && (
        <>
          <Text style={styles.label}>Monthly amount (₱)</Text>
          <TextInput
            style={styles.input}
            value={v.monthly}
            onChangeText={(x) => set('monthly', x)}
            keyboardType="decimal-pad"
          />
        </>
      )}
      {v.rateType === 'flat_then_hourly' && (
        <>
          <Text style={styles.label}>First N hours</Text>
          <TextInput
            style={styles.input}
            value={v.firstHours}
            onChangeText={(x) => set('firstHours', x)}
            keyboardType="numeric"
          />
          <Text style={styles.label}>Amount for first N (₱)</Text>
          <TextInput
            style={styles.input}
            value={v.firstAmount}
            onChangeText={(x) => set('firstAmount', x)}
            keyboardType="decimal-pad"
          />
          <Text style={styles.label}>Succeeding hourly (₱)</Text>
          <TextInput
            style={styles.input}
            value={v.succeeding}
            onChangeText={(x) => set('succeeding', x)}
            keyboardType="decimal-pad"
          />
        </>
      )}

      {existing?.is_default ? (
        <Text style={styles.meta} testID="rate-default-note">
          The default rate applies every day, with no dates. To limit days or dates, use another
          rate.
        </Text>
      ) : (
        <>
          <Text style={styles.label}>Days (none selected = every day)</Text>
          <View style={styles.types}>
            {WEEK_DAYS.map((d) => {
              const on = v.days.includes(d.value);
              return (
                <TouchableOpacity
                  key={d.value}
                  onPress={() => set('days', toggleDay(v.days, d.value))}
                  style={[styles.typeChip, on && styles.typeChipOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  testID={`rate-day-${d.value}`}
                >
                  <Text style={[styles.typeChipText, on && styles.typeChipTextOn]}>{d.short}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Effective from (optional YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={v.from}
            onChangeText={(x) => set('from', x)}
            placeholder="YYYY-MM-DD"
            testID="rate-from"
          />
          <Text style={styles.label}>Effective to (optional, inclusive)</Text>
          <TextInput
            style={styles.input}
            value={v.to}
            onChangeText={(x) => set('to', x)}
            placeholder="YYYY-MM-DD"
            testID="rate-to"
          />
        </>
      )}

      <Button
        title={rateId ? 'Save rate' : 'Create rate'}
        onPress={save}
        disabled={saving}
        testID="rate-save"
      />

      {error ? (
        <Text style={styles.error} testID="rate-edit-error">
          {error}
        </Text>
      ) : null}
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
  centered: { justifyContent: 'center', alignItems: 'center' },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.lg,
  },
  label: { ...theme.typography.bodySmall, fontWeight: '600', marginTop: theme.spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.sm,
  },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  types: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.sm,
  },
  typeChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  typeChipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  typeChipText: { ...theme.typography.caption, color: theme.colors.text.primary },
  typeChipTextOn: { color: '#fff' },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.md },
});
