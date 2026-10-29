import React from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '../lib/theme';
import {
  formatLocalDateTime,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../utils/formatters';

type Props = {
  valueUtc: string | null | undefined;
  onChangeUtc: (iso: string) => void;
  testID?: string;
};

export function DateTimeField({ valueUtc, onChangeUtc, testID }: Props) {
  const localValue = toDatetimeLocalValue(valueUtc);
  const friendly = formatLocalDateTime(valueUtc);

  if (Platform.OS === 'web') {
    return (
      <View>
        <Text style={styles.friendly} testID={testID ? `${testID}-label` : undefined}>
          {friendly || 'Pick a time'}
        </Text>
        <input
          type="datetime-local"
          value={localValue}
          data-testid={testID}
          onChange={(e) => {
            const next = fromDatetimeLocalValue(e.target.value);
            if (next) onChangeUtc(next);
          }}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            padding: 12,
            fontSize: 16,
            width: '100%',
          }}
        />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.friendly} testID={testID ? `${testID}-label` : undefined}>
        {friendly || 'Pick a time'}
      </Text>
      <TextInput
        style={styles.input}
        value={localValue}
        onChangeText={(text) => {
          const next = fromDatetimeLocalValue(text);
          if (next) onChangeUtc(next);
        }}
        placeholder="YYYY-MM-DDTHH:mm"
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background,
  },
  friendly: {
    ...theme.typography.body,
    marginBottom: theme.spacing.xs,
  },
});
