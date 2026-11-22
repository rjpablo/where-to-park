import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { DateTimeField } from '../../../src/components/DateTimeField';
import { FilterDropdown } from '../../../src/components/FilterDropdown';
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
      if (cancelled) return;
      const rows: MembershipRow[] = memberships.map((row) => ({
        operatorId: row.operator_id,
        role: row.role,
        createdAt: row.created_at,
        name: null,
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
      <Text style={styles.label}>Listing</Text>
      <FilterDropdown
        label="Listing"
        showLabel={false}
        value={locationId}
        options={[
          { value: null, label: 'All listings' },
          ...listings.map((listing) => ({ value: listing.id, label: listing.name })),
        ]}
        onChange={setLocationId}
        highlightActive={false}
        style={styles.dropdown}
        testID="collections-listing"
      />
      <Text style={styles.label}>Date range</Text>
      <FilterDropdown<RangePreset | 'custom'>
        label="Date range"
        showLabel={false}
        value={preset}
        options={PRESETS.map((item) => ({ value: item.key, label: item.label }))}
        onChange={(next) => {
          if (next) choosePreset(next);
        }}
        highlightActive={false}
        style={styles.dropdown}
        testID="collections-range"
      />
      {preset === 'custom' ? (
        <View>
          <Text style={styles.label}>Start</Text>
          <DateTimeField
            mode="date"
            value={startDate}
            onChange={setStartDate}
            placeholder="Start date"
            style={styles.date}
            testID="collections-start"
          />
          <Text style={styles.label}>End</Text>
          <DateTimeField
            mode="date"
            value={endDate}
            onChange={setEndDate}
            placeholder="End date"
            style={styles.date}
            testID="collections-end"
          />
        </View>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="collections-error">
          {error}
        </Text>
      ) : null}
      {loading && !report ? <Text style={styles.meta}>Loading...</Text> : null}
      {report ? (
        <View>
          <View style={styles.collected}>
            <Text style={styles.totalLabel}>Collected</Text>
            <Text style={styles.total} testID="collections-collected">
              {peso(report.collected)}
            </Text>
            <Text style={styles.collectedMeta}>Payments minus refunds</Text>
          </View>
          <Total label="Payments" amount={report.payments} testID="collections-payments" />
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
  label: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  dropdown: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    marginHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  date: { marginHorizontal: theme.spacing.md },
  collected: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  totalLabel: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
  },
  total: {
    ...theme.typography.h1,
    color: theme.colors.text.primary,
    marginTop: theme.spacing.xs,
  },
  collectedMeta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
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
