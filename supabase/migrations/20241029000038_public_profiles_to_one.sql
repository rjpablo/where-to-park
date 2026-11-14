-- Reviewer and driver names: make the public_profiles computed relationships to-one.
--
-- public_profiles(reviews) and public_profiles(chat_threads) returned SETOF without a
-- row estimate, so PostgREST embedded them as an ARRAY ([{display_name}]). App code that
-- reads `review.public_profiles.display_name` got undefined and showed 'Anonymous'
-- (still the case in builds made before 0a29604: the 1.0.8 APK and the current web
-- deploy). With ROWS 1 PostgREST treats the relationship as to-one and returns an object
-- ({display_name}), which old and new app code both read. Only id and display_name are
-- exposed (the public_profiles view); profiles RLS is unchanged.

ALTER FUNCTION public.public_profiles(public.reviews) ROWS 1;
ALTER FUNCTION public.public_profiles(public.chat_threads) ROWS 1;

NOTIFY pgrst, 'reload schema';
