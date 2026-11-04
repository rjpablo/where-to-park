import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Button } from './Button';
import { theme } from '../lib/theme';
import {
  dateTimeLabel,
  defaultPlaceholder,
  pickerDate,
  valueFromPickerDate,
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

function applyPick(mode: DateTimeMode, event: DateTimePickerEvent, date: Date | undefined) {
  if (event.type !== 'set' || !date) return null;
  return valueFromPickerDate(date, mode);
}

/**
 * System date and time pickers: Android's calendar/clock dialog, and the iOS
 * system picker. The field shows the value; it is not a text box.
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
  // iOS keeps the wheel/calendar open until Done. Android's dialog closes itself.
  const [draft, setDraft] = React.useState<Date | null>(null);

  const open = () => {
    const current = pickerDate(value, mode);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode,
        is24Hour: true,
        display: mode === 'date' ? 'calendar' : 'clock',
        onChange: (event, date) => {
          const next = applyPick(mode, event, date);
          if (next) onChange(next);
        },
      });
      return;
    }
    setDraft(current);
  };

  return (
    <>
      <View style={[styles.field, style]}>
        <Pressable
          style={styles.main}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={hint}
          accessibilityValue={shown ? { text: shown } : undefined}
          testID={testID}
        >
          <Text style={shown ? styles.value : styles.placeholder} numberOfLines={1}>
            {shown || hint}
          </Text>
        </Pressable>
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
      <Modal
        visible={draft != null}
        transparent
        animationType="fade"
        onRequestClose={() => setDraft(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{mode === 'date' ? 'Date' : 'Time'}</Text>
            {draft ? (
              mode === 'date' ? (
                <DateTimePicker
                  value={draft}
                  mode="date"
                  display="inline"
                  themeVariant="light"
                  accentColor={theme.colors.primary}
                  onChange={(_event, date) => {
                    if (date) setDraft(date);
                  }}
                />
              ) : (
                <DateTimePicker
                  value={draft}
                  mode="time"
                  display="spinner"
                  themeVariant="light"
                  onChange={(_event, date) => {
                    if (date) setDraft(date);
                  }}
                />
              )
            ) : null}
            <Button
              title="Done"
              onPress={() => {
                if (draft) onChange(valueFromPickerDate(draft, mode));
                setDraft(null);
              }}
              testID={testID ? `${testID}-done` : undefined}
            />
            <Pressable
              onPress={() => setDraft(null)}
              style={styles.cancel}
              testID={testID ? `${testID}-cancel` : undefined}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
