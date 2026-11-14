import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overnightError, overnightTimeText } from './overnight.ts';

test('overnight times keep hours and minutes', () => {
  assert.equal(overnightTimeText('22:00:00'), '22:00');
  assert.equal(overnightTimeText('6:05'), '06:05');
  assert.equal(overnightTimeText(null), '');
});

test('overnight requires a window and a price only when it is on', () => {
  assert.equal(overnightError(false, '', '', ''), null);
  assert.match(overnightError(true, '', '06:00', '200') || '', /start/);
  assert.match(overnightError(true, '22:00', 'bad', '200') || '', /end/);
  assert.match(overnightError(true, '22:00', '22:00', '200') || '', /different/);
  assert.match(overnightError(true, '22:00', '06:00', '0') || '', /price/);
  assert.equal(overnightError(true, '22:00', '06:00', '200'), null);
});
