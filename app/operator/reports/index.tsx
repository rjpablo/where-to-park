import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBottomInset } from '../../../src/hooks/useBottomInset';
import {
  reportOperators,
  type MembershipRow,
  type ReportOperator,
} from '../../../src/lib/collections';
import { firstParam } from '../../../src/lib/params';
import { supabase } from '../../../src/lib/supabase';
import { theme } from '../../../src/lib/theme';
import { useAuthStore } from '../../../src/stores/authStore';

export default function ReportsScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const requested = firstParam(
    useLocalSearchParams<{ operatorId?: string | string[] }>().operatorId
  );
  const [operators, setOperators] = React.useState<ReportOperator[]>([]);
  const [operatorId, setOperatorId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!user) {
      setOperators([]);
      setOperatorId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: memError } = await supabase
        .from('operator_members')
        .select('operator_id, role, created_at')
        .eq('profile_id', user.id);
      if (cancelled) return;
      if (memError) {
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
      setOperators(list);
      const preferred = list.some((op) => op.id === requested) ? requested! : list[0]?.id;
      setOperatorId(preferred ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, requested]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="reports-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  if (!operators.length) {
    return (
      <View style={[styles.container, styles.centered, bottomInset]} testID="reports-denied">
        <Text style={styles.body}>Owners and managers only.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  const selected = operators.find((op) => op.id === operatorId) ?? operators[0];

  return (
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="reports-ready">
      {operators.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          {operators.map((op) => {
            const on = op.id === selected.id;
            return (
              <Pressable
                key={op.id}
                onPress={() => setOperatorId(op.id)}
                style={[styles.chip, on && styles.chipOn]}
                testID={`reports-operator-${op.id}`}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{op.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={styles.card}
        testID="reports-collections"
        onPress={() =>
          router.push(`/operator/reports/collections?operatorId=${selected.id}` as never)
        }
      >
        <Text style={styles.cardTitle}>Collections</Text>
        <Text style={styles.body}>Payments, fees, waivers, and refunds</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  body: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  error: { ...theme.typography.bodySmall, color: theme.colors.danger, margin: theme.spacing.md },
  chips: { flexGrow: 0, paddingVertical: theme.spacing.md },
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
  card: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  cardTitle: {
    ...theme.typography.h3,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs,
  },
});
