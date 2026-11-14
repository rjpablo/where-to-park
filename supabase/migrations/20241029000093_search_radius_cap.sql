-- Search radius cap (default 50 km). Guests and drivers read it. Only an admin can change it.
-- A search never asks for a wider radius than this. The app tells the driver when the
-- map covered a larger area.

CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_settings FROM PUBLIC, anon, authenticated;

INSERT INTO public.system_settings (key, value)
VALUES ('search_radius_cap_km', '50'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_search_radius_cap()
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_km NUMERIC;
BEGIN
  SELECT (value #>> '{}')::NUMERIC INTO v_km
  FROM system_settings
  WHERE key = 'search_radius_cap_km';
  IF v_km IS NULL OR v_km < 1 OR v_km > 500 THEN
    RETURN 50;
  END IF;
  RETURN v_km;
END;
$$;

REVOKE ALL ON FUNCTION public.get_search_radius_cap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_search_radius_cap() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_search_radius_cap(p_km NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_km IS NULL OR p_km < 1 OR p_km > 500 OR p_km <> trunc(p_km) THEN
    RETURN jsonb_build_object('error', 'Enter a whole number of kilometres from 1 to 500');
  END IF;
  INSERT INTO system_settings (key, value, updated_at, updated_by)
  VALUES ('search_radius_cap_km', to_jsonb(p_km), NOW(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
  RETURN jsonb_build_object('success', true, 'km', p_km);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_search_radius_cap(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_search_radius_cap(NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
