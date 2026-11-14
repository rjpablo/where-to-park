import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessages,
  chunk,
  deadTokensFromReceipts,
  directPushRow,
  pushData,
  readTickets,
  safeEqual,
} from './lib.ts';

const row = {
  id: 'n1',
  recipient_id: 'u1',
  type: 'scheduled_end',
  title: 'Scheduled end reached',
  body: 'ABC 123 is overdue',
  ref_type: 'session',
  ref_id: 's1',
  data: { location_id: 'l1' },
};

test('pushData carries type and ref for deep links; row fields win over data', () => {
  assert.deepEqual(pushData({ ...row, data: { location_id: 'l1', type: 'spoof' } }), {
    location_id: 'l1',
    notification_id: 'n1',
    type: 'scheduled_end',
    ref_type: 'session',
    ref_id: 's1',
  });
  assert.equal(pushData({ ...row, data: null, ref_type: undefined }).ref_type, null);
});

test('buildMessages: one message per unique token, Android channel, no empty body', () => {
  const m = buildMessages({ ...row, body: null }, ['A', 'A', '', 'B']);
  assert.equal(m.length, 2);
  assert.equal(m[0].channelId, 'default');
  assert.equal(m[0].priority, 'high');
  assert.equal('body' in m[0], false);
  assert.equal(m[1].data.ref_id, 's1');
});

test('chunk splits at 100', () => {
  const parts = chunk(Array.from({ length: 205 }, (_, i) => i));
  assert.deepEqual(
    parts.map((p) => p.length),
    [100, 100, 5]
  );
});

test('readTickets: DeviceNotRegistered tokens dropped, ok tickets kept for receipts', () => {
  const r = readTickets(
    [{ to: 'A' }, { to: 'B' }, { to: 'C' }],
    [
      { status: 'ok', id: 't1' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ]
  );
  assert.deepEqual(r.deadTokens, ['B']);
  assert.deepEqual(r.pending, [{ ticket_id: 't1', token: 'A' }]);
});

test('deadTokensFromReceipts', () => {
  assert.deepEqual(
    deadTokensFromReceipts(
      {
        t1: { status: 'ok' },
        t2: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        t3: { status: 'error', details: { error: 'InvalidCredentials' } },
      },
      { t1: 'A', t2: 'B', t3: 'C' }
    ),
    ['B']
  );
});

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(null, 'x'), false);
});

test('direct chat push (0081): no notifications row, tap data kept, others refused', () => {
  const row = directPushRow({
    recipient_id: '6d3e0df0-87b9-417a-9263-c419c27fa4e7',
    type: 'chat_message',
    title: 'New message from Sarah · Lot',
    body: 'hi',
    ref_type: 'chat_thread',
    ref_id: 'd6016687-f2f4-4b0c-a967-f98c6f9d4db4',
    data: { location_id: 'L1', driver_id: 'D1', audience: 'operator' },
  });
  assert.ok(row);
  assert.equal(row!.id, null);
  const [m] = buildMessages(row!, ['ExponentPushToken[a]']);
  assert.equal(m.title, 'New message from Sarah · Lot');
  assert.deepEqual(m.data, {
    location_id: 'L1',
    driver_id: 'D1',
    audience: 'operator',
    type: 'chat_message',
    ref_type: 'chat_thread',
    ref_id: 'd6016687-f2f4-4b0c-a967-f98c6f9d4db4',
  });
  assert.equal(directPushRow({ recipient_id: 'x', type: 'chat_message', title: 't' }), null);
  assert.equal(
    directPushRow({
      recipient_id: '6d3e0df0-87b9-417a-9263-c419c27fa4e7',
      type: 'report',
      title: 't',
    }),
    null,
    'only chat messages are pushed without a row'
  );
});
