-- adjust_availability is gone (migration 0065). Rolls back.
BEGIN;
DO $$
BEGIN
  ASSERT to_regprocedure('public.adjust_availability(uuid, integer)') IS NULL, 'adjust_availability dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'adjust_availability'), 'no overloads left';
END $$;
ROLLBACK;
