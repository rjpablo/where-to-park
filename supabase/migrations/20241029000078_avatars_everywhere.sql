-- 0078 Avatars wherever a user's name shows (rj t179u).
-- public_profiles (the public, read-only id + name view; 0075 made it read-only) gains
-- avatar_url, so reviews, chat threads and the chat header can show the photo with the
-- name. Nothing else: no email, no phone. Admin contact RPCs return user_avatar_url.

CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT id, display_name, avatar_url FROM public.profiles;
REVOKE ALL ON public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_profiles(reviews)
 RETURNS SETOF public_profiles LANGUAGE sql STABLE ROWS 1 SET search_path TO 'public'
AS $function$
  SELECT * FROM public_profiles WHERE id = $1.author_id;
$function$;

CREATE OR REPLACE FUNCTION public.public_profiles(chat_threads)
 RETURNS SETOF public_profiles LANGUAGE sql STABLE ROWS 1 SET search_path TO 'public'
AS $function$
  SELECT * FROM public_profiles WHERE id = $1.driver_id;
$function$;

CREATE OR REPLACE FUNCTION public.admin_contact_submission(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT row_to_json(x)::jsonb INTO v FROM (
    SELECT c.id, c.created_at, c.category, c.status, c.contact, c.user_id, c.message,
           c.resolved_at, rp.display_name AS resolved_by_name,
           p.display_name AS user_name, p.phone AS user_phone, p.avatar_url AS user_avatar_url,
           COALESCE((SELECT array_agg(o.name ORDER BY o.name) FROM storage.objects o
             WHERE o.bucket_id = 'contact-images' AND o.name LIKE c.id::text || '/%'), '{}') AS images
      FROM contact_submissions c
      LEFT JOIN profiles p ON p.id = c.user_id
      LEFT JOIN profiles rp ON rp.id = c.resolved_by
     WHERE c.id = p_id) x;
  IF v IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'item', v);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_contact_submissions(p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  RETURN jsonb_build_object('success', true, 'items', COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC) FROM (
      SELECT c.id, c.created_at, c.category, c.status, c.contact, c.user_id,
             left(c.message, 140) AS preview,
             p.display_name AS user_name, p.phone AS user_phone, p.avatar_url AS user_avatar_url,
             (SELECT count(*) FROM storage.objects o
               WHERE o.bucket_id = 'contact-images' AND o.name LIKE c.id::text || '/%') AS images
        FROM contact_submissions c LEFT JOIN profiles p ON p.id = c.user_id
       WHERE p_status IS NULL OR c.status = p_status
       ORDER BY c.created_at DESC
       LIMIT 200) x), '[]'::jsonb));
END;
$function$;
