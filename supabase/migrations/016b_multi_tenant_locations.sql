-- Migration 016b: Multi-tenant locations scaffold
--
-- Reconstruida desde el esquema real de producción (proyecto xttpaqokeyywjaajvjyu,
-- Supabase migration id 20260819023438 "multi_tenant_locations"). Se había aplicado
-- a mano el 2026-08-19 y nunca se commiteó un archivo para ella -- este archivo
-- documenta retroactivamente lo que ya corre en producción, no introduce nada nuevo.
-- Verificado columna por columna, política por política e índice por índice contra
-- el proyecto real el 2026-09-22 antes de escribir este archivo.
--
-- Qué hace: agrega una tabla `locations` (hoy con una sola fila, la panadería
-- actual) y una columna `location_id` a las 12 tablas que ya tenían datos por
-- ubicación, todas con el mismo default apuntando a esa fila única -- así que
-- para la operación actual (una sola location) esto es un no-op funcional.
-- Reescribe además las políticas RLS de 7 de esas tablas (debts, expenses,
-- ingredients, pedidos_online, products, replenishments, sales) para exigir
-- `location_id = get_user_location(auth.uid())` adicionalmente al chequeo de
-- rol que ya tenían. Las otras 5 (active_sessions, activity_logs, app_config,
-- profiles, whatsapp_conversations) sólo ganan la columna; sus políticas no se
-- tocaron porque profiles es la fuente de get_user_location() (filtrarla por
-- location sería circular) y las otras cuatro se dejaron sin filtrar a
-- propósito para esta primera location.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tabla locations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.locations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       text NOT NULL,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de locations" ON public.locations;
CREATE POLICY "Lectura pública de locations"
    ON public.locations FOR SELECT TO anon, authenticated
    USING (true);

INSERT INTO public.locations (id, slug, name, created_at) VALUES
    ('00000000-0000-0000-0000-000000000001', 'casa-luccenzo', 'Casa Lucenzo', '2026-08-19 02:34:38.387708+00')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Columna location_id en las 12 tablas existentes
--    (antes de la función: get_user_location() es LANGUAGE sql y Postgres
--    valida su cuerpo contra el catálogo al crearla, así que profiles.location_id
--    tiene que existir primero)
-- ---------------------------------------------------------------------------

ALTER TABLE public.active_sessions        ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.activity_logs          ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.app_config             ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.debts                  ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.expenses               ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.ingredients            ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.pedidos_online         ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.products               ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.profiles               ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.replenishments         ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.sales                  ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id);

-- ---------------------------------------------------------------------------
-- 3. Función get_user_location — mismo patrón que get_user_role (001)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_location(user_id uuid DEFAULT auth.uid())
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT location_id FROM public.profiles WHERE id = user_id AND active = true;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Índices — producción no indexó app_config, así que acá tampoco
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_active_sessions_location_id        ON public.active_sessions(location_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_location_id          ON public.activity_logs(location_id);
CREATE INDEX IF NOT EXISTS idx_debts_location_id                  ON public.debts(location_id);
CREATE INDEX IF NOT EXISTS idx_expenses_location_id               ON public.expenses(location_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_location_id            ON public.ingredients(location_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_online_location_id         ON public.pedidos_online(location_id);
CREATE INDEX IF NOT EXISTS idx_products_location_id               ON public.products(location_id);
CREATE INDEX IF NOT EXISTS idx_profiles_location_id               ON public.profiles(location_id);
CREATE INDEX IF NOT EXISTS idx_replenishments_location_id         ON public.replenishments(location_id);
CREATE INDEX IF NOT EXISTS idx_sales_location_id                  ON public.sales(location_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_location_id ON public.whatsapp_conversations(location_id);

-- ---------------------------------------------------------------------------
-- 5. Políticas reescritas para exigir location_id además del rol
--    (debts, expenses, ingredients, pedidos_online, products, replenishments,
--    sales -- las otras 5 tablas con location_id se dejan como estaban)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Venta y Admin pueden gestionar deudas" ON public.debts;
CREATE POLICY "Venta y Admin pueden gestionar deudas"
    ON public.debts FOR ALL TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())))
    WITH CHECK ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Ver deudas por rol" ON public.debts;
CREATE POLICY "Ver deudas por rol"
    ON public.debts FOR SELECT TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Ver gastos por rol" ON public.expenses;
CREATE POLICY "Ver gastos por rol"
    ON public.expenses FOR SELECT TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Venta y Admin pueden borrar gastos" ON public.expenses;
CREATE POLICY "Venta y Admin pueden borrar gastos"
    ON public.expenses FOR DELETE TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Venta y Admin pueden registrar gastos" ON public.expenses;
CREATE POLICY "Venta y Admin pueden registrar gastos"
    ON public.expenses FOR INSERT TO authenticated
    WITH CHECK ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Gestión de ingredientes" ON public.ingredients;
CREATE POLICY "Gestión de ingredientes"
    ON public.ingredients FOR ALL TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'cocina'::text])) AND (location_id = get_user_location(auth.uid())))
    WITH CHECK ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'cocina'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Admin y venta pueden actualizar pedidos" ON public.pedidos_online;
CREATE POLICY "Admin y venta pueden actualizar pedidos"
    ON public.pedidos_online FOR UPDATE TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())))
    WITH CHECK ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Admin y venta pueden ver y gestionar pedidos" ON public.pedidos_online;
CREATE POLICY "Admin y venta pueden ver y gestionar pedidos"
    ON public.pedidos_online FOR SELECT TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Solo Admin puede insertar o eliminar productos" ON public.products;
CREATE POLICY "Solo Admin puede insertar o eliminar productos"
    ON public.products FOR ALL TO authenticated
    USING ((get_user_role(auth.uid()) = 'admin'::text) AND (location_id = get_user_location(auth.uid())))
    WITH CHECK ((get_user_role(auth.uid()) = 'admin'::text) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Admin y Cocina/Venta pueden actualizar stock de productos" ON public.products;
CREATE POLICY "Admin y Cocina/Venta pueden actualizar stock de productos"
    ON public.products FOR UPDATE TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text, 'cocina'::text])) AND (location_id = get_user_location(auth.uid())))
    WITH CHECK ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text, 'cocina'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Cocina y Admin pueden crear y actualizar reposiciones" ON public.replenishments;
CREATE POLICY "Cocina y Admin pueden crear y actualizar reposiciones"
    ON public.replenishments FOR ALL TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'cocina'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())))
    WITH CHECK ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'cocina'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Venta y Admin pueden actualizar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden actualizar ventas"
    ON public.sales FOR UPDATE TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())))
    WITH CHECK ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Ver ventas por rol" ON public.sales;
CREATE POLICY "Ver ventas por rol"
    ON public.sales FOR SELECT TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text, 'cocina'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Venta y Admin pueden registrar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden registrar ventas"
    ON public.sales FOR INSERT TO authenticated
    WITH CHECK ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

DROP POLICY IF EXISTS "Venta y Admin pueden eliminar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden eliminar ventas"
    ON public.sales FOR DELETE TO authenticated
    USING ((get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'venta'::text])) AND (location_id = get_user_location(auth.uid())));

COMMIT;
