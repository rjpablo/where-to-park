-- RLS: an operator sees their own staff, not another operator's.
BEGIN;
SELECT plan(6);

CREATE TEMP TABLE rls_counts (label TEXT, n INTEGER);
GRANT ALL ON rls_counts TO PUBLIC;

-- Claims must be set as postgres before SET ROLE (authenticated cannot set GUCs).
SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL ROLE anon;

INSERT INTO rls_counts SELECT 'anon_locations', COUNT(*)::INTEGER FROM locations WHERE published = true;
INSERT INTO rls_counts SELECT 'anon_members', COUNT(*)::INTEGER FROM operator_members;
INSERT INTO rls_counts SELECT 'anon_folios', COUNT(*)::INTEGER FROM folios;

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL ROLE authenticated;

INSERT INTO rls_counts
SELECT 'juan_own_staff', COUNT(*)::INTEGER
FROM operator_members
WHERE operator_id = '10000000-0000-0000-0000-000000000002';

INSERT INTO rls_counts
SELECT 'juan_other_staff', COUNT(*)::INTEGER
FROM operator_members
WHERE operator_id = '10000000-0000-0000-0000-000000000001';

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL ROLE authenticated;

INSERT INTO rls_counts
SELECT 'maria_other_staff', COUNT(*)::INTEGER
FROM operator_members
WHERE operator_id = '10000000-0000-0000-0000-000000000002';

RESET ROLE;

SELECT cmp_ok((SELECT n FROM rls_counts WHERE label = 'anon_locations'), '>=', 4, 'Anon can read published locations');
SELECT is((SELECT n FROM rls_counts WHERE label = 'anon_members'), 0, 'Anon cannot list operator_members');
SELECT is((SELECT n FROM rls_counts WHERE label = 'anon_folios'), 0, 'Anon cannot read folios');
SELECT cmp_ok((SELECT n FROM rls_counts WHERE label = 'juan_own_staff'), '>=', 2, 'Juan can list Session Road staff (himself + Ana)');
SELECT is((SELECT n FROM rls_counts WHERE label = 'juan_other_staff'), 0, 'Juan cannot list SM City staff');
SELECT is((SELECT n FROM rls_counts WHERE label = 'maria_other_staff'), 0, 'Maria cannot list Session Road staff');

SELECT * FROM finish();
ROLLBACK;
