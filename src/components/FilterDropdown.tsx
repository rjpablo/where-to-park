import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { DropdownOption } from '../lib/searchFilters';
import { theme } from '../lib/theme';

type Props<T extends string> = {
  /** Menu title and screen-reader name, e.g. 'Vehicle'. */
  label: string;
  /** Show the label before the value on the chip ('Maps app: Google Maps'). Off for the
   *  search filters, whose option text says what they are ('All vehicles', 'Car'). */
  showLabel?: boolean;
  value: T | null;
  options: DropdownOption<T>[];
  onChange: (value: T | null) => void;
  /** Fill the chip when a non-'All' value is picked (filters); off for settings. */
  highlightActive?: boolean;
  testID?: string;
  /** Extra chip style (e.g. full width for long options). */
  style?: StyleProp<ViewStyle>;
};

/** Chip that opens a list of options (filters: 'All' = no filter; also used for settings). */
export function FilterDropdown<T extends string>({
  label,
  showLabel = true,
  value,
  options,
  onChange,
  highlightActive = true,
  testID,
  style,
}: Props<T>) {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  const active = highlightActive && value !== null;
  return (
    <>
      <TouchableOpacity
        style={[styles.chip, active && styles.chipActive, style]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current.label}. Change`}
        testID={testID}
      >
        <Text style={styles.chipText} numberOfLines={1}>
          {showLabel ? `${label}: ` : ''}
          {current.label} ▾
        </Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu} testID={testID ? `${testID}-menu` : undefined}>
            <Text style={styles.menuTitle}>{label}</Text>
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <TouchableOpacity
                  key={o.value ?? 'all'}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => {
                    setOpen(false);
                    if (!selected) onChange(o.value);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  testID={testID ? `${testID}-option-${o.value ?? 'all'}` : undefined}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {o.label}
                  </Text>
                  {selected ? <Text style={styles.check}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    maxWidth: 200,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { ...theme.typography.bodySmall },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  menu: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing.sm,
    ...theme.shadows.lg,
  },
  menuTitle: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
  },
  optionSelected: { backgroundColor: theme.colors.surfaceDark },
  optionText: { ...theme.typography.body, flex: 1 },
  optionTextSelected: { fontWeight: '700', color: theme.colors.primary },
  check: { ...theme.typography.body, color: theme.colors.primary, fontWeight: '700' },
});
