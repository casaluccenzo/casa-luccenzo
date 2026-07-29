-- Migration 004: Fix privilege escalation vulnerability in admin_set_user_pin
-- Adds explicit server-side role check inside SQL body to ensure only 'admin' role can assign PINs to target users.

CREATE OR REPLACE FUNCTION public.admin_set_user_pin(p_target_user_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Server-side role verification (Do not trust client-side role checks)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Solo un administrador puede asignar PIN a otro usuario.';
  END IF;

  -- 2. Validate PIN length
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'El PIN debe tener al menos 4 dígitos.';
  END IF;

  -- 3. Perform update for target user ID
  UPDATE public.profiles
  SET pin_hash = crypt(trim(p_pin), gen_salt('bf'))
  WHERE id = p_target_user_id;
END;
$$;

-- Ensure permissions remain restricted to authenticated users
REVOKE ALL ON FUNCTION public.admin_set_user_pin(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_user_pin(uuid, text) TO authenticated;
