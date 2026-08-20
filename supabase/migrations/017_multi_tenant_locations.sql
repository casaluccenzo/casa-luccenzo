-- Migration 017: Multi-tenant foundation (locations)
--
-- Adds public.locations and a location_id column across every operational
-- table, as groundwork for supporting more than the one physical location
-- ("Casa Lucenzo") this schema was built for. Purely additive and
-- backward-compatible on its own: every location_id column gets DEFAULT +
-- backfill to the existing location's fixed id, so nothing in the current
-- app (which does not yet send location_id anywhere) breaks.
--
-- RLS is tightened only for authenticated-only staff policies, where every
-- existing profile is guaranteed a location_id after this same migration.
-- Deliberately NOT touched here (left for a follow-up migration, once
-- js/supabase.js is updated to pass location_id explicitly):
--   - Policies that also grant anon access (products/ingredients/
--     replenishments/app_config SELECT, pedidos_online INSERT) -- anon has
--     no profile, so get_user_location() is always NULL for it; adding a
--     location filter to those policies would silently break the public
--     menu / order flow.
--   - active_sessions, activity_logs, profiles RLS -- device/session and
--     audit-log access patterns aren't fully mapped yet, and profiles SELECT
--     intentionally lets admin see every active profile.
--   - app_config's primary key (still the single fixed row id=1) -- moving
--     it to location_id needs to land together with the js/supabase.js
--     change that queries it, not on its own.

BEGIN;

-- --------------------------------------------------------------------
-- 1. locations table, seeded with the current (only) location
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.locations (id, slug, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'casa-luccenzo', 'Casa Lucenzo')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- Location name/slug isn't sensitive (it's just "which restaurant") and the
-- future public site needs to read it unauthenticated to know which menu to
-- show, so SELECT is open. Only migrations (service role) write to it for
-- now -- no INSERT/UPDATE/DELETE policy is created, so authenticated/anon
-- clients can't modify it via the API.
DROP POLICY IF EXISTS "Lectura pública de locations" ON public.locations;
CREATE POLICY "Lectura pública de locations" ON public.locations
    FOR SELECT TO authenticated, anon
    USING (true);

-- --------------------------------------------------------------------
-- 2. location_id column, defaulted + backfilled, on every operational
--    table. DEFAULT is a constant (not a subquery) on purpose -- Postgres
--    doesn't allow subqueries in column defaults.
-- --------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.products SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.products ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.products ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_location_id ON public.products (location_id);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.sales SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.sales ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.sales ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_location_id ON public.sales (location_id);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.expenses SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.expenses ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.expenses ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_location_id ON public.expenses (location_id);

ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.debts SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.debts ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.debts ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debts_location_id ON public.debts (location_id);

ALTER TABLE public.replenishments ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.replenishments SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.replenishments ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.replenishments ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_replenishments_location_id ON public.replenishments (location_id);

ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.ingredients SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.ingredients ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.ingredients ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingredients_location_id ON public.ingredients (location_id);

ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.active_sessions SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.active_sessions ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.active_sessions ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_active_sessions_location_id ON public.active_sessions (location_id);

ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.activity_logs SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.activity_logs ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.activity_logs ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_logs_location_id ON public.activity_logs (location_id);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.profiles SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.profiles ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.profiles ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_location_id ON public.profiles (location_id);

ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.whatsapp_conversations SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.whatsapp_conversations ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.whatsapp_conversations ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_location_id ON public.whatsapp_conversations (location_id);

ALTER TABLE public.pedidos_online ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.pedidos_online SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.pedidos_online ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.pedidos_online ALTER COLUMN location_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_online_location_id ON public.pedidos_online (location_id);

-- app_config: column only. PK stays id=1 for now -- see note at top.
ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);
UPDATE public.app_config SET location_id = '00000000-0000-0000-0000-000000000001' WHERE location_id IS NULL;
ALTER TABLE public.app_config ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.app_config ALTER COLUMN location_id SET NOT NULL;

-- --------------------------------------------------------------------
-- 3. Helper: which location does the current authenticated user belong to
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_location(user_id uuid DEFAULT auth.uid())
RETURNS uuid AS $$
    SELECT location_id FROM public.profiles WHERE id = user_id AND active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- --------------------------------------------------------------------
-- 4. RLS: add the location check to authenticated-only staff policies.
--    Anon-inclusive policies are untouched -- see note at top.
-- --------------------------------------------------------------------

-- products
DROP POLICY IF EXISTS "Admin y Cocina/Venta pueden actualizar stock de productos" ON public.products;
CREATE POLICY "Admin y Cocina/Venta pueden actualizar stock de productos" ON public.products
    FOR UPDATE TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta', 'cocina') AND location_id = public.get_user_location(auth.uid()))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta', 'cocina') AND location_id = public.get_user_location(auth.uid()));

DROP POLICY IF EXISTS "Solo Admin puede insertar o eliminar productos" ON public.products;
CREATE POLICY "Solo Admin puede insertar o eliminar productos" ON public.products
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) = 'admin' AND location_id = public.get_user_location(auth.uid()))
    WITH CHECK (public.get_user_role(auth.uid()) = 'admin' AND location_id = public.get_user_location(auth.uid()));

-- sales
DROP POLICY IF EXISTS "Ver ventas por rol" ON public.sales;
CREATE POLICY "Ver ventas por rol" ON public.sales
    FOR SELECT TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta', 'cocina') AND location_id = public.get_user_location(auth.uid()));

DROP POLICY IF EXISTS "Venta y Admin pueden registrar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden registrar ventas" ON public.sales
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

DROP POLICY IF EXISTS "Venta y Admin pueden actualizar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden actualizar ventas" ON public.sales
    FOR UPDATE TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

DROP POLICY IF EXISTS "Venta y Admin pueden eliminar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden eliminar ventas" ON public.sales
    FOR DELETE TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

-- expenses
DROP POLICY IF EXISTS "Ver gastos por rol" ON public.expenses;
CREATE POLICY "Ver gastos por rol" ON public.expenses
    FOR SELECT TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

DROP POLICY IF EXISTS "Venta y Admin pueden registrar gastos" ON public.expenses;
CREATE POLICY "Venta y Admin pueden registrar gastos" ON public.expenses
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

DROP POLICY IF EXISTS "Venta y Admin pueden borrar gastos" ON public.expenses;
CREATE POLICY "Venta y Admin pueden borrar gastos" ON public.expenses
    FOR DELETE TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

-- debts
DROP POLICY IF EXISTS "Ver deudas por rol" ON public.debts;
CREATE POLICY "Ver deudas por rol" ON public.debts
    FOR SELECT TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

DROP POLICY IF EXISTS "Venta y Admin pueden gestionar deudas" ON public.debts;
CREATE POLICY "Venta y Admin pueden gestionar deudas" ON public.debts
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

-- replenishments (only the staff-management policy; anon SELECT untouched)
DROP POLICY IF EXISTS "Cocina y Admin pueden crear y actualizar reposiciones" ON public.replenishments;
CREATE POLICY "Cocina y Admin pueden crear y actualizar reposiciones" ON public.replenishments
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'cocina', 'venta') AND location_id = public.get_user_location(auth.uid()))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'cocina', 'venta') AND location_id = public.get_user_location(auth.uid()));

-- ingredients (only the staff-management policy; anon SELECT untouched)
DROP POLICY IF EXISTS "Gestión de ingredientes" ON public.ingredients;
CREATE POLICY "Gestión de ingredientes" ON public.ingredients
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'cocina') AND location_id = public.get_user_location(auth.uid()))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'cocina') AND location_id = public.get_user_location(auth.uid()));

-- pedidos_online (only the staff-facing policies; anon INSERT untouched)
DROP POLICY IF EXISTS "Admin y venta pueden ver y gestionar pedidos" ON public.pedidos_online;
CREATE POLICY "Admin y venta pueden ver y gestionar pedidos" ON public.pedidos_online
    FOR SELECT TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

DROP POLICY IF EXISTS "Admin y venta pueden actualizar pedidos" ON public.pedidos_online;
CREATE POLICY "Admin y venta pueden actualizar pedidos" ON public.pedidos_online
    FOR UPDATE TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta') AND location_id = public.get_user_location(auth.uid()));

COMMIT;
