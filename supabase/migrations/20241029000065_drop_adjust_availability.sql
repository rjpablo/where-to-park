-- 🟧 Security fix (rj t136u): adjust_availability (the removed Count tab's +1/-1) had no
-- permission check and was executable by anon and authenticated, so anyone, even signed
-- out, could change any listing's available count. Availability is now computed from
-- sessions (0064), so the RPC is dropped.
DROP FUNCTION IF EXISTS public.adjust_availability(uuid, integer);

NOTIFY pgrst, 'reload schema';
