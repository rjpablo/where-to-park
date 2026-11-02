import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationRoute } from './notificationRoute.ts';

const S = '11111111-2222-3333-4444-555555555555';

test('session notifications open the session', () => {
  for (const type of ['scheduled_end', 'overdue', 'session_ended', 'session_extended', 'no_show']) {
    assert.equal(notificationRoute({ type, ref_type: 'session', ref_id: S }), `/staff/session?id=${S}`);
  }
});

test('admin types', () => {
  assert.equal(
    notificationRoute({ type: 'contact_submission', ref_type: 'contact_submission', ref_id: S }),
    `/admin/contact-item?id=${S}`
  );
  assert.equal(notificationRoute({ type: 'contact_submission' }), '/admin/contact');
  assert.equal(notificationRoute({ type: 'verification_needed', ref_type: 'location', ref_id: S }), '/admin/verify');
  assert.equal(notificationRoute({ type: 'report' }), '/admin/reports');
});

test('chat opens the thread', () => {
  assert.equal(notificationRoute({ type: 'chat_message', location_id: S }), `/chat/${S}`);
  assert.equal(
    notificationRoute({ type: 'chat_message', location_id: S, driver_id: 'd-1' }),
    `/chat/${S}?driverId=d-1`
  );
  assert.equal(notificationRoute({ type: 'chat_message' }), '/operator/inbox');
});

test('location ref opens the listing; unknown -> Notifications', () => {
  assert.equal(notificationRoute({ type: 'fee_paid', ref_type: 'location', ref_id: S }), `/location/${S}`);
  assert.equal(notificationRoute({ type: 'reservation_request' }), '/notifications');
  assert.equal(notificationRoute(null), '/notifications');
  assert.equal(notificationRoute({ type: 'scheduled_end', ref_type: 'session', ref_id: '../x?y' }), '/notifications');
});
