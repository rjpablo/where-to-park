BEGIN;
SELECT plan(10);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (invite_staff(
    '10000000-0000-0000-0000-000000000002',
    'sarah@wheretopark.local'
  )->>'success')::BOOLEAN,
  true,
  'Juan can invite Sarah by email'
);

SELECT is(
  invite_staff(
    '10000000-0000-0000-0000-000000000002',
    'nobody@wheretopark.local'
  )->>'error',
  'user_not_found',
  'Unknown email returns user_not_found'
);

RESET ROLE;

-- Phone invite of Maria onto Session Road (separate from email invite)
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (invite_staff(
    '10000000-0000-0000-0000-000000000002',
    NULL,
    '+639181111111'
  )->>'success')::BOOLEAN,
  true,
  'Juan can invite Maria by phone'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM operator_members
    WHERE operator_id = '10000000-0000-0000-0000-000000000002'
      AND profile_id = '20000000-0000-0000-0000-000000000003'
      AND role = 'staff'
  ),
  'Sarah is staff on Session Road after email invite'
);

SELECT is(
  (set_staff_can_waive('10000000-0000-0000-0000-000000000002', false)->>'staff_can_waive')::BOOLEAN,
  false,
  'Juan can turn staff_can_waive off'
);

SELECT is(
  (remove_staff(
    '10000000-0000-0000-0000-000000000002',
    (SELECT id FROM operator_members
     WHERE operator_id = '10000000-0000-0000-0000-000000000002'
       AND profile_id = '20000000-0000-0000-0000-000000000003')
  )->>'success')::BOOLEAN,
  true,
  'Juan can remove invited staff'
);

SELECT is(
  remove_staff(
    '10000000-0000-0000-0000-000000000002',
    (SELECT id FROM operator_members
     WHERE operator_id = '10000000-0000-0000-0000-000000000002'
       AND profile_id = '20000000-0000-0000-0000-000000000002')
  )->>'error',
  'cannot_remove_owner',
  'Owner membership cannot be removed'
);

RESET ROLE;

SELECT is(
  (SELECT staff_can_waive FROM operators WHERE id = '10000000-0000-0000-0000-000000000002'),
  false,
  'staff_can_waive persists off'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM operator_members
    WHERE operator_id = '10000000-0000-0000-0000-000000000002'
      AND profile_id = '20000000-0000-0000-0000-000000000003'
  ),
  'Sarah is no longer a Session Road member'
);

-- Ana (staff) cannot invite
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000004';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  invite_staff(
    '10000000-0000-0000-0000-000000000002',
    'sarah@wheretopark.local'
  )->>'error',
  'Permission denied',
  'Staff cannot invite staff'
);

SELECT * FROM finish();
ROLLBACK;
