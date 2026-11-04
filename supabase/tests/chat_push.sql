-- 0081 chat messages are push-only: no notifications rows (pgTAP).
BEGIN;
SELECT plan(2);
INSERT INTO notifications (recipient_id, type, title)
VALUES ('20000000-0000-0000-0000-000000000001', 'chat_message', 'x');
SELECT is((SELECT count(*)::INT FROM notifications WHERE type = 'chat_message'), 0,
  'chat_message notifications are dropped');
INSERT INTO notifications (recipient_id, type, title)
VALUES ('20000000-0000-0000-0000-000000000001', 'report', 'still works');
SELECT is((SELECT count(*)::INT FROM notifications WHERE title = 'still works'), 1,
  'other notification types are kept');
SELECT * FROM finish();
ROLLBACK;
