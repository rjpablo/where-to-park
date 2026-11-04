import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateTimeLabel,
  normalizePickerValue,
  pickerDate,
  valueFromPickerDate,
} from './dateTimeField.ts';

test('picker round-trips the calendar day and the clock time', () => {
  assert.equal(valueFromPickerDate(pickerDate('2026-11-04', 'date'), 'date'), '2026-11-04');
  assert.equal(valueFromPickerDate(pickerDate('15:05', 'time'), 'time'), '15:05');
  assert.equal(valueFromPickerDate(pickerDate('9:05', 'time'), 'time'), '09:05');
});

test('an empty date opens on the Manila calendar day', () => {
  const opened = valueFromPickerDate(pickerDate('', 'date'), 'date');
  const manila = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  assert.equal(opened, manila);
});

test('labels and browser values', () => {
  assert.equal(dateTimeLabel('2026-11-04', 'date'), 'Wed, Nov 4, 2026');
  assert.equal(dateTimeLabel('15:05', 'time'), '15:05');
  assert.equal(dateTimeLabel('', 'date'), '');
  assert.equal(normalizePickerValue('2026-11-04T15:05', 'date'), '2026-11-04');
  assert.equal(normalizePickerValue('15:05:00', 'time'), '15:05');
  assert.equal(normalizePickerValue('', 'time'), '');
  assert.equal(normalizePickerValue('nope', 'date'), '');
});
