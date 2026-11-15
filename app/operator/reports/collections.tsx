import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useBottomInset } from '../../../src/hooks/useBottomInset';
import {
  formatManilaWhen,
  manilaToday,
  methodLabel,
  parseCollectionsReport,
  peso,
  presetRange,
  rangeFromDates,
  reportOperators,
  type CollectionsReport,
  type MembershipRow,
  type RangePreset,
} from '../../../src/lib/collections';
import { firstParam } from '../../../src/lib/params';
import { supabase } from '../../../src/lib/supabase';
import { theme } from '../../../src/lib/theme';
import { useAuthStore } from '../../../src/stores/authStore';

const PRESETS: { key: RangePreset | 'custom'; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];

type Listing = { id: string; name: string };

export default function CollectionsScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const userId = useAuthStore((s) => s.user?.id);
  const requestedId = firstParam(
    useLocalSearchParams<{ operatorId?: string | string[] }>().operatorId
  );
  const [operatorId, setOperatorId] = React.useState<string | null>(requestedId ?? null);
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  const [operatorName, setOperatorName] = React.useState('');
  const [listings, setListings] = React.useState<Listing[]>([]);
  const [locationId, setLocationId] = React.useState<string | null>(null);
  const [preset, setPreset] = React.useState<RangePreset | 'custom'>('today');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [report, setReport] = React.useState<CollectionsReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!userId) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: memError } = await supabase
        .from('operator_members')
        .select('operator_id, role, created_at')
        .eq('profile_id', userId);
      if (cancelled) return;
      if (memError) {
        setAllowed(false);
        setError(memError.message);
        setLoading(false);
        return;
      }
      const memberships = (data || []) as {
        operator_id: string;
        role: string;
        created_at: string;
      }[];
      const ids = [...new Set(memberships.map((row) => row.operator_id))];
      const names = new Map<string, string | null>();
      if (ids.length) {
        const { data: ops } = await supabase
          .from('operators')
          .select('id, display_name')
          .in('id', ids);
        for (const op of (ops || []) as { id: string; display_name: string | null }[]) {
          names.set(op.id, op.display_name);
        }
      }
      if (cancelled) return;
      const rows: MembershipRow[] = memberships.map((row) => ({
        operatorId: row.operator_id,
        role: row.role,
        createdAt: row.created_at,
        name: names.get(row.operator_id) ?? null,
      }));
      const list = reportOperators(rows);
      if (requestedId && !list.some((op) => op.id === requestedId)) {
        setAllowed(false);
        setLoading(false);
        return;
      }
      const id = requestedId ?? list[0]?.id ?? null;
      const chosen = list.find((op) => op.id === id);
      if (!id || !chosen) {
        setAllowed(false);
        setLoading(false);
        return;
      }
      setOperatorId(id);
      setLocationId(null);
      setOperatorName(chosen.name);
      setAllowed(true);
      const { data: locs } = await supabase
        .from('locations')
        .select('id, name')
        .eq('operator_id', id)
        .is('deleted_at', null)
        .order('name');
      if (cancelled) return;
      setListings((locs || []) as Listing[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, requestedId]);

  React.useEffect(() => {
    if (!allowed || !operatorId) return;
    const range =
      preset === 'custom' ? rangeFromDates(startDate, endDate) : presetRange(preset, new Date());
    if ('error' in range) {
      setError(range.error);
      setReport(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('operator_collections_report', {
        p_operator_id: operatorId,
        p_from: range.from,
        p_to: range.to,
        p_location_id: locationId,
      });
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setReport(null);
      } else {
        const parsed = parseCollectionsReport(data);
        if ('error' in parsed) {
          setError(parsed.error);
          setReport(null);
        } else {
          setReport(parsed);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, operatorId, preset, startDate, endDate, locationId]);

  const choosePreset = (next: RangePreset | 'custom') => {
    setPreset(next);
    if (next === 'custom') {
      const today = manilaToday(new Date());
      setStartDate((value) => value || today);
      setEndDate((value) => value || today);
    }
  };

  if (allowed === false) {
    return (
      <View style={[styles.container, styles.centered, bottomInset]} testID="collections-denied">
        <Text style={styles.meta}>Owners and managers only.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, bottomInset]}
      testID={loading && !report ? 'collections-loading' : 'collections-ready'}
    >
      {operatorName ? <Text style={styles.subtitle}>{operatorName}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {PRESETS.map((item) => {
          const on = item.key === preset;
          return (
            <Pressable
              key={item.key}
              onPress={() => choosePreset(item.key)}
              style={[styles.chip, on && styles.chipOn]}
              testID={`collections-range-${item.key}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {preset === 'custom' ? (
        <View style={styles.dates}>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="Start YYYY-MM-DD"
            autoCapitalize="none"
            style={styles.input}
            testID="collections-start"
          />
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="End YYYY-MM-DD"
            autoCapitalize="none"
            style={styles.input}
            testID="collections-end"
          />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        <Pressable
          onPress={() => setLocationId(null)}
          style={[styles.chip, locationId === null && styles.chipOn]}
          testID="collections-listing-all"
        >
          <Text style={[styles.chipText, locationId === null && styles.chipTextOn]}>
            All listings
          </Text>
        </Pressable>
        {listings.map((listing) => {
          const on = locationId === listing.id;
          return (
            <Pressable
              key={listing.id}
              onPress={() => setLocationId(listing.id)}
              style={[styles.chip, on && styles.chipOn]}
              testID={`collections-listing-${listing.id}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{listing.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error ? (
        <Text style={styles.error} testID="collections-error">
          {error}
        </Text>
      ) : null}
      {loading && !report ? <Text style={styles.meta}>Loading...</Text> : null}
      {report ? (
        <View>
          <Text style={styles.totalLabel}>Collected</Text>
          <Text style={styles.total} testID="collections-collected">
            {peso(report.collected)}
          </Text>
          <Text style={styles.meta}>Payments minus refunds</Text>
          <Text style={styles.section}>By method</Text>
          {report.byMethod.map((method) => (
            <View
              key={method.method}
              style={styles.row}
              testID={`collections-method-${method.method}`}
            >
              <Text style={styles.rowLabel}>{method.label}</Text>
              <Text style={styles.rowValue}>{peso(method.amount)}</Text>
            </View>
          ))}
          <Total label="Extra fees" amount={report.extraFees} testID="collections-fees" />
          <Total label="Waived" amount={report.waived} testID="collections-waived" />
          <Total label="Refunded" amount={report.refunded} testID="collections-refunded" />
          <Total label="Still to collect" amount={report.openBalance} testID="collections-open" />
          <Text style={styles.meta}>Open sessions now. This does not follow the dates above.</Text>
          <Text style={styles.section}>Payments</Text>
          {report.lines.length === 0 ? (
            <Text style={styles.meta} testID="collections-empty-lines">
              No payments in this range.
            </Text>
          ) : (
            report.lines.map((line) => (
              <View
                key={line.id || `${line.at}-${line.amount}`}
                style={styles.line}
                testID="collections-line"
              >
                <Text style={styles.rowLabel}>{formatManilaWhen(line.at)}</Text>
                <Text style={styles.meta}>
                  {[line.listing, line.plate].filter(Boolean).join(' · ')}
                </Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>
                    {line.direction === 'refund' ? 'Refund' : methodLabel(line.method)}
                    {line.recordedBy ? ` · ${line.recordedBy}` : ''}
                  </Text>
                  <Text style={[styles.rowValue, line.direction === 'refund' && styles.refund]}>
                    {peso(line.amount)}
                  </Text>
                </View>
              </View>
            ))
          )}
          {report.linesTruncated ? (
            <Text style={styles.meta} testID="collections-truncated">
              Older payments in this range are not listed.
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Total({ label, amount, testID }: { label: string; amount: number; testID: string }) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{peso(amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingBottom: theme.spacing.lg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  chipRow: { flexGrow: 0, paddingVertical: theme.spacing.sm },
  chip: {
    marginLeft: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { ...theme.typography.bodySmall, color: theme.colors.text.primary },
  chipTextOn: { color: theme.colors.text.inverse, fontWeight: '600' },
  dates: { paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    ...theme.typography.body,
    color: theme.colors.text.primary,
  },
  totalLabel: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  total: {
    ...theme.typography.h2,
    color: theme.colors.text.primary,
    marginHorizontal: theme.spacing.md,
  },
  section: {
    ...theme.typography.h3,
    color: theme.colors.text.primary,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.md,
  },
  rowLabel: { ...theme.typography.body, color: theme.colors.text.primary, flex: 1 },
  rowValue: { ...theme.typography.body, color: theme.colors.text.primary, fontWeight: '600' },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  error: { ...theme.typography.bodySmall, color: theme.colors.danger, margin: theme.spacing.md },
  line: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  refund: { color: theme.colors.danger },
});
