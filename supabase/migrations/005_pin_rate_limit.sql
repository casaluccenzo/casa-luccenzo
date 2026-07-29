-- Migration 005: Server-side rate limiting for verify_quick_pin RPC
-- Adds pin_failed_attempts and pin_locked_until columns to public.profiles and enforces server-side lockout in Postgres.

-- 1. Add rate limiting columns to public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_failed_attempts int DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;

-- 2. Create or replace verify_quick_pin function with server-side rate limiting
CREATE OR REPLACE FUNCTION public.verify_quick_pin(p_user_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stored_hash text;
  attempts int;
  locked_until timestamptz;
  is_valid boolean;
BEGIN
  IF p_pin IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT pin_hash, pin_failed_attempts, pin_locked_until
    INTO stored_hash, attempts, locked_until
    FROM public.profiles WHERE id = p_user_id;

  IF stored_hash IS NULL THEN
    RETURN false;
  END IF;

  -- Si está bloqueado y el bloqueo no ha expirado, rechazar sin siquiera comparar el PIN
  IF locked_until IS NOT NULL AND locked_until > now() THEN
    RETURN false;
  END IF;

  is_valid := (stored_hash = crypt(trim(p_pin), stored_hash));

  IF is_valid THEN
    UPDATE public.profiles
    SET pin_failed_attempts = 0, pin_locked_until = NULL
    WHERE id = p_user_id;
    RETURN true;
  ELSE
    UPDATE public.profiles
    SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
        pin_locked_until = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= 3 THEN now() + interval '60 seconds'
          ELSE pin_locked_until
        END
    WHERE id = p_user_id;
    RETURN false;
  END IF;
END;
$$;

-- 3. Restrict execution permissions to authenticated users
REVOKE ALL ON FUNCTION public.verify_quick_pin(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_quick_pin(uuid, text) TO authenticated;
