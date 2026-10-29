import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Button } from '../../src/components/Button';
import { WorkspaceNav } from '../../src/components/WorkspaceNav';
import { supabase } from '../../src/lib/supabase';
import { formatLocalDateTime, formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';

export default function AdminReportsScreen() {
  const [reports, setReports] = React.useState<any[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (fetchError) setError(fetchError.message);
    setReports(data || []);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: 'resolve' | 'hide' | 'dismiss') => {
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('resolve_report', {
      p_report_id: id,
      p_action: action,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setNotice(action === 'hide' ? 'Hidden' : action === 'dismiss' ? 'Dismissed' : 'Resolved');
    await load();
  };

  if (loading) {
    return (
      <View style={styles.container} testID="reports-loading">
        <WorkspaceNav />
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="reports-ready">
      <WorkspaceNav />
      <Text style={styles.title}>Moderation queue</Text>
      <Text style={styles.meta}>{reports.length} pending</Text>
      {notice ? (
        <Text style={styles.notice} testID="reports-notice">
          {notice}
        </Text>
      ) : null}
      {reports.map((r) => (
        <View key={r.id} style={styles.card} testID={`report-${r.target_type}`}>
          <Text style={styles.rowTitle}>{r.target_type === 'location' ? 'Listing' : 'Review'}</Text>
          <Text style={styles.reason}>{r.reason}</Text>
          {r.details ? <Text style={styles.meta}>{r.details}</Text> : null}
          <Text style={styles.meta}>
            {formatLocalDateTime(r.created_at)} · {formatRelativeTime(r.created_at)}
          </Text>
          <View style={styles.row}>
            <Button title="Resolve" size="small" onPress={() => act(r.id, 'resolve')} />
            <Button
              title="Hide"
              size="small"
              variant="danger"
              onPress={() => act(r.id, 'hide')}
              testID="report-hide"
            />
            <Button
              title="Dismiss"
              size="small"
              variant="outline"
              onPress={() => act(r.id, 'dismiss')}
            />
          </View>
        </View>
      ))}
      {reports.length === 0 ? <Text style={styles.meta}>Queue is empty</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg },
  title: { ...theme.typography.h2 },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  reason: { ...theme.typography.body, marginBottom: theme.spacing.xs },
  notice: { ...theme.typography.body, color: theme.colors.success, marginBottom: theme.spacing.sm },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
  },
  rowTitle: { ...theme.typography.body, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  error: { color: theme.colors.danger, marginTop: theme.spacing.md },
});
