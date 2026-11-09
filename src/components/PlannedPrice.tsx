import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { plannedPriceDetail } from '../lib/reservations';
import { theme } from '../lib/theme';
import { formatPeso } from '../utils/formatters';

/**
 * The reservation total and how it was calculated.
 * Reserve a spot always shows the calculation, above the request button.
 */
export function PlannedPrice({
  price,
  quoting = false,
  startOpen = false,
  alwaysOpen = false,
  testID = 'planned-price',
}: {
  /** A session_price object (amount, billed hours, breakdown). A bare amount still shows. */
  price: unknown;
  quoting?: boolean;
  /** Opens the calculation on first render. Reserve a spot uses alwaysOpen instead. */
  startOpen?: boolean;
  /** The calculation stays visible. Used on Reserve a spot, before the request is sent. */
  alwaysOpen?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = React.useState(startOpen || alwaysOpen);
  const detail = quoting ? null : plannedPriceDetail(price);
  const shown = quoting ? '…' : detail?.amount != null ? formatPeso(detail.amount) : '—';
  const shownDetail = alwaysOpen || open;
  const canOpen =
    !alwaysOpen && !quoting && !!detail && (!!detail.summary || detail.lines.length > 0);

  return (
    <View style={styles.box}>
      <Text style={styles.total} testID={testID}>
        Planned price: {shown}
      </Text>
      {canOpen ? (
        <TouchableOpacity
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={
            open ? 'Hide how the price is calculated' : 'Show how the price is calculated'
          }
          testID={`${testID}-toggle`}
        >
          <Text style={styles.toggle}>
            {open ? '▾ Hide calculation' : '▸ How this is calculated'}
          </Text>
        </TouchableOpacity>
      ) : null}
      {shownDetail && detail ? (
        <View testID={`${testID}-detail`}>
          {detail.summary ? <Text style={styles.line}>{detail.summary}</Text> : null}
          {detail.note ? <Text style={styles.note}>{detail.note}</Text> : null}
          {detail.lines.map((line, i) => (
            <Text key={`${line.label}-${i}`} style={styles.line} testID={`${testID}-line`}>
              {line.label} · {formatPeso(line.amount)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  total: { ...theme.typography.body, fontWeight: '600', color: theme.colors.text.primary },
  toggle: {
    ...theme.typography.bodySmall,
    color: theme.colors.primary,
    marginTop: theme.spacing.xs,
  },
  line: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.primary,
    marginTop: theme.spacing.xs,
  },
  note: {
    ...theme.typography.caption,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
  },
});
