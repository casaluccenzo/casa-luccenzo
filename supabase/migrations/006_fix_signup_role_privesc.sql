-- Migration 006: Fix privilege escalation via public signup role metadata
-- Casa Lucenzo's Supabase project has email signup enabled. handle_new_user()
-- previously trusted NEW.raw_user_meta_data->>'role', which is fully controlled
-- by the client calling /auth/v1/signup. Anyone could self-register with
-- {"data": {"role": "admin"}} and be inserted as an admin profile directly by
-- this SECURITY DEFINER trigger, bypassing the "Admin puede gestionar perfiles"
-- RLS policy entirely. New signups must always land as the lowest-privilege
-- role; role changes must go through an existing admin (already enforced by
-- the "Admin puede gestionar perfiles" UPDATE policy on public.profiles).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username, name, role, active)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        'venta',
        true
    )
    ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        name = EXCLUDED.name,
        updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
