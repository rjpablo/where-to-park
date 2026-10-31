BEGIN;
SELECT plan(16);

-- Seeded ABC 1234 session already posted a system event on Sarah's Session Road thread.
SELECT ok(
  EXISTS (
    SELECT 1
    FROM chat_messages m
    JOIN chat_threads t ON t.id = m.thread_id
    WHERE t.location_id = '30000000-0000-0000-0000-000000000002'
      AND t.driver_id = '20000000-0000-0000-0000-000000000003'
      AND m.kind = 'system'
      AND m.body = 'Session started'
  ),
  'Session started system event is on Sarah Session Road thread'
);

CREATE TEMP TABLE chat_ids (label TEXT, id UUID);
GRANT ALL ON chat_ids TO PUBLIC;

-- Driver can message any published listing (SM City — no stay).
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (start_thread('30000000-0000-0000-0000-000000000001')->>'success')::BOOLEAN,
  true,
  'Sarah can start a thread on SM City without a stay'
);

INSERT INTO chat_ids
SELECT 'sm', (start_thread('30000000-0000-0000-0000-000000000001')->>'thread_id')::UUID;

INSERT INTO chat_ids
SELECT 'session_road', (start_thread('30000000-0000-0000-0000-000000000002')->>'thread_id')::UUID;

SELECT is(
  (send_chat_message((SELECT id FROM chat_ids WHERE label = 'sm'), 'Covered parking?')->>'success')::BOOLEAN,
  true,
  'Sarah can send a text on the SM thread'
);

SELECT is(
  (put_chat_image((SELECT id FROM chat_ids WHERE label = 'sm'), 'gate.jpg')->>'success')::BOOLEAN,
  true,
  'Sarah can attach a chat image stored in chat-images'
);

SELECT is(
  put_chat_image(
    (SELECT id FROM chat_ids WHERE label = 'sm'),
    'processed.jpg',
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'image/jpeg'
  )->>'content_type',
  'image/jpeg',
  'put_chat_image stores processed JPEG bytes and content type'
);

RESET ROLE;

-- Operator of SM cannot reply: Sarah has no reservation or session there.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  send_chat_message((SELECT id FROM chat_ids WHERE label = 'sm'), 'Yes, B2 is covered')->>'error',
  'Permission denied',
  'Maria cannot message Sarah on SM without a stay'
);

SELECT throws_ok(
  format(
    $$INSERT INTO chat_messages (thread_id, sender_id, kind, body)
      VALUES (%L, '20000000-0000-0000-0000-000000000001', 'text', 'bypass')$$,
    (SELECT id FROM chat_ids WHERE label = 'sm')
  ),
  '42501',
  NULL,
  'RLS blocks Maria INSERT on SM thread without a stay'
);

RESET ROLE;

-- Session Road operator CAN reply because ABC 1234 session exists.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (send_chat_message(
    (SELECT id FROM chat_ids WHERE label = 'session_road'),
    'Gate is on Assumption Road'
  )->>'success')::BOOLEAN,
  true,
  'Juan can message Sarah because she has a Session Road session'
);

RESET ROLE;

-- Staff of Session Road can also send.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000004';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (send_chat_message(
    (SELECT id FROM chat_ids WHERE label = 'session_road'),
    'Please pull into Level 1'
  )->>'success')::BOOLEAN,
  true,
  'Ana staff can message Sarah on a stay thread'
);

RESET ROLE;

-- Anon cannot read private chat-images.
SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL "request.jwt.claims" TO '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM storage.objects WHERE bucket_id = 'chat-images'),
  0,
  'Anon cannot read chat-images objects'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM chat_messages),
  0,
  'Anon cannot read chat messages'
);

RESET ROLE;

-- Thread member (Sarah) can write/read chat-images via Storage RLS.
-- put_chat_image no longer inserts storage.objects (hosted unique index mismatch).
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO storage.objects (bucket_id, name, owner, metadata)
VALUES (
  'chat-images',
  (SELECT id FROM chat_ids WHERE label = 'sm')::text || '/rls.jpg',
  '20000000-0000-0000-0000-000000000003',
  '{}'::jsonb
);

SELECT cmp_ok(
  (SELECT COUNT(*)::INTEGER FROM storage.objects WHERE bucket_id = 'chat-images'),
  '>=',
  1,
  'Sarah can read her chat-images object'
);

SELECT is(
  (register_chat_image((SELECT id FROM chat_ids WHERE label = 'sm'), 'uploaded.jpg', 'image/jpeg')->>'success')::BOOLEAN,
  true,
  'register_chat_image records a path after a client Storage upload'
);

SELECT ok(
  (SELECT length(bytes) FROM chat_image_blobs WHERE path LIKE '%/gate.jpg') > 10,
  'Chat image bytes are stored for signed-URL serving'
);

SELECT is(
  (get_chat_image((SELECT path FROM chat_image_blobs WHERE path LIKE '%/gate.jpg' LIMIT 1))->>'success')::BOOLEAN,
  true,
  'Sarah can read chat image bytes for a signed URL'
);

RESET ROLE;

-- Payment system event
INSERT INTO payments (folio_id, amount, method, recorded_by)
SELECT f.id, 50.00, 'cash', '20000000-0000-0000-0000-000000000002'
FROM folios f
JOIN parking_sessions s ON s.id = f.session_id
WHERE s.plate = 'ABC 1234'
ORDER BY s.created_at DESC
LIMIT 1;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM chat_messages m
    JOIN chat_threads t ON t.id = m.thread_id
    WHERE t.location_id = '30000000-0000-0000-0000-000000000002'
      AND t.driver_id = '20000000-0000-0000-0000-000000000003'
      AND m.kind = 'system'
      AND m.body = 'Payment recorded'
  ),
  'Payment recorded appears as a system message'
);

SELECT * FROM finish();
ROLLBACK;
