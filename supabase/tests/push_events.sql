-- 0074 notification events (pgTAP, local seed). Sarah (…03) drives ABC 1234 at
-- Session Road (…30…02), whose operator Juan (…02) owns.
BEGIN;
SELECT plan(9);

-- 12 Ending soon: once per End time; an extension gets its own reminder.
UPDATE parking_sessions SET scheduled_end_at = NOW() + INTERVAL '20 minutes', status = 'active'
 WHERE plate = 'ABC 1234';
SELECT is(notify_sessions_ending_soon(), 1, 'driver reminded 30 min before the End');
SELECT is(notify_sessions_ending_soon(), 0, 'not twice for the same End');
UPDATE parking_sessions SET scheduled_end_at = scheduled_end_at + INTERVAL '5 minutes'
 WHERE plate = 'ABC 1234';
SELECT is(notify_sessions_ending_soon(), 1, 'a new End gets a new reminder');
SELECT is(
  (SELECT recipient_id FROM notifications WHERE type = 'session_ending_soon' LIMIT 1),
  '20000000-0000-0000-0000-000000000003'::UUID,
  'the reminder goes to the linked driver');

-- 7 Reservation request -> listing staff
INSERT INTO reservations (driver_id, location_id, start_at, end_at, quote_amount, status)
VALUES ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002',
        NOW() + INTERVAL '1 day', NOW() + INTERVAL '26 hours', 40, 'pending_approval');
SELECT ok(EXISTS (SELECT 1 FROM notifications WHERE type = 'reservation_request'
  AND recipient_id = '20000000-0000-0000-0000-000000000002'), 'owner gets the reservation request');

-- Sarah writes twice, reports the listing
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT send_chat_message((start_thread('30000000-0000-0000-0000-000000000002')->>'thread_id')::UUID, 'one');
SELECT send_chat_message((start_thread('30000000-0000-0000-0000-000000000002')->>'thread_id')::UUID, 'two');
SELECT submit_report('location', '30000000-0000-0000-0000-000000000002', 'Actually full');
RESET ROLE;

SELECT is((SELECT count(*) FROM notifications WHERE type = 'chat_message'
  AND recipient_id = '20000000-0000-0000-0000-000000000002')::INT, 1,
  'a burst of messages makes one chat notification');
SELECT is((SELECT count(*) FROM notifications WHERE type = 'chat_message'
  AND recipient_id = '20000000-0000-0000-0000-000000000003')::INT, 0, 'the sender is not notified');
SELECT ok(EXISTS (SELECT 1 FROM notifications WHERE type = 'report'
  AND recipient_id = '20000000-0000-0000-0000-000000000002'), 'owner hears about the report');

-- Juan opens the thread -> its chat notification is read
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT mark_thread_read((SELECT id FROM chat_threads WHERE driver_id = '20000000-0000-0000-0000-000000000003'
  AND location_id = '30000000-0000-0000-0000-000000000002'));
RESET ROLE;
SELECT is((SELECT count(*) FROM notifications WHERE type = 'chat_message' AND read_at IS NULL
  AND recipient_id = '20000000-0000-0000-0000-000000000002')::INT, 0,
  'opening the thread marks its chat notification read');

SELECT * FROM finish();
ROLLBACK;
