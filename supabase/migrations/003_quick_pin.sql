-- Migration 003: Quick PIN Unlock support with pgcrypto server-side hashing
-- Enables fast session reactivation using a 4-digit PIN stored securely in public.profiles.

-- 1. Enable pgcrypto extension for bcrypt password/PIN hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Add pin_hash column to public.profiles if not exists
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_hash text;

-- 3. RPC function to set/update quick PIN for current authenticated user
CREATE OR REPLACE FUNCTION public.set_quick_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'El PIN debe tener al menos 4 dígitos.';
  END IF;

  UPDATE public.profiles
  SET pin_hash = crypt(trim(p_pin), gen_salt('bf'))
  WHERE id = auth.uid();
END;
$$;

-- 4. RPC function to verify quick PIN for a user
CREATE OR REPLACE FUNCTION public.verify_quick_pin(p_user_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stored_hash text;
BEGIN
  IF p_pin IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT pin_hash INTO stored_hash FROM public.profiles WHERE id = p_user_id;
  IF stored_hash IS NULL THEN
    RETURN false;
  END IF;

  RETURN stored_hash = crypt(trim(p_pin), stored_hash);
END;
$$;

-- 5. Restrict permissions so only authenticated users can call these functions
REVOKE ALL ON FUNCTION public.set_quick_pin(text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_quick_pin(text) TO authenticated;

REVOKE ALL ON FUNCTION public.verify_quick_pin(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_quick_pin(uuid, text) TO authenticated;
