import React from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../lib/theme';
import {
  dateTimeLabel,
  defaultPlaceholder,
  normalizePickerValue,
  type DateTimeMode,
} from '../lib/dateTimeField';
import { dateTimeFieldStyles as styles } from './dateTimeFieldStyles';

export type DateTimeFieldProps = {
  mode: DateTimeMode;
  /** YYYY-MM-DD or HH:MM. Empty string means unset. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Optional fields can be cleared. The system picker itself always returns a value. */
  allowEmpty?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Web: the browser's date or time control (not a free-text field).
 * iOS and Android use DateTimeField.native.tsx.
 */
export function DateTimeField({
  mode,
  value,
  onChange,
  placeholder,
  allowEmpty,
  testID,
  style,
}: DateTimeFieldProps) {
  const hint = placeholder ?? defaultPlaceholder(mode);
  const shown = dateTimeLabel(value, mode);
  return (
    <View style={[styles.field, style]}>
      <input
        type={mode === 'date' ? 'date' : 'time'}
        value={normalizePickerValue(value, mode)}
        step={mode === 'time' ? 60 : undefined}
        inputMode="none"
        aria-label={hint}
        data-testid={testID}
        onChange={(e) => onChange(normalizePickerValue(e.target.value, mode))}
        onKeyDown={(e) => {
          if (e.key === 'Tab' || e.key === 'Escape') return;
          e.preventDefault();
        }}
        onPaste={(e) => e.preventDefault()}
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          background: 'transparent',
          color: shown ? theme.colors.text.primary : theme.colors.text.tertiary,
          fontSize: 16,
          padding: theme.spacing.md,
          fontFamily: 'inherit',
          minWidth: 0,
        }}
      />
      {allowEmpty && value ? (
        <Pressable
          onPress={() => onChange('')}
          style={styles.clearHit}
          accessibilityLabel="Clear"
          testID={testID ? `${testID}-clear` : undefined}
        >
          <Text style={styles.clear}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
