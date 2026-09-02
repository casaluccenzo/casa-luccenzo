-- planA_devbootstrap.sql
-- SOLO para el proyecto dev (casa-lucenzo-dev, hvwpbhnnfggfdpztdmwo).
-- NUNCA correr contra produccion.
--
-- Los archivos supabase/migrations/*.sql NO son un reflejo fiel de lo aplicado
-- en produccion (falta el archivo de multi_tenant_locations; varias 010-015 no
-- estan trackeadas en prod). En vez de replayar migraciones dudosas, este
-- script crea el subconjunto MINIMO del esquema de prod que Plan A necesita,
-- con las columnas exactas leidas de la prod viva el 2026-09-02:
--   locations, profiles, products, sales, debts
--   funciones get_user_role(uuid), get_user_location(uuid)
--
-- Plan A (migraciones 025-032) no toca ninguna otra tabla.

BEGIN;

-- 1. locations (destino de los FK location_id)
CREATE TABLE IF NOT EXISTS public.locations (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL DEFAULT 'Casa Lucenzo'
);
INSERT INTO public.locations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Casa Lucenzo')
ON CONFLICT (id) DO NOTHING;

-- 2. profiles (lo lee get_user_role / get_user_location)
CREATE TABLE IF NOT EXISTS public.profiles (
    id                  uuid PRIMARY KEY,
    username            text NOT NULL,
    name                text NOT NULL,
    role                text NOT NULL,
    active              boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    pin_hash            text,
    pin_failed_attempts integer DEFAULT 0,
    pin_locked_until    timestamptz,
    location_id         uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                          REFERENCES public.locations(id)
);

-- 3. products — columnas exactas de prod (id text PK)
CREATE TABLE IF NOT EXISTS public.products (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    stock         integer NOT NULL,
    min           integer NOT NULL,
    max           integer NOT NULL,
    unit          text DEFAULT 'unid.',
    price         numeric NOT NULL,
    category      text DEFAULT 'pastelitos',
    updated_at    timestamptz DEFAULT now(),
    initial_stock integer NOT NULL DEFAULT 0,
    location_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                    REFERENCES public.locations(id),
    cost          numeric NOT NULL DEFAULT 0
);

-- 4. sales — columnas exactas de prod (uuid text PK)
CREATE TABLE IF NOT EXISTS public.sales (
    uuid         text PRIMARY KEY,
    product_id   text NOT NULL,
    name         text NOT NULL,
    price        numeric NOT NULL,
    timestamp    timestamptz DEFAULT now(),
    location_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                   REFERENCES public.locations(id),
    bcv_rate     numeric,
    cost_at_sale numeric
);

-- 5. debts — columnas exactas de prod (uuid text PK)
CREATE TABLE IF NOT EXISTS public.debts (
    uuid        text PRIMARY KEY,
    client_name text NOT NULL,
    amount      numeric NOT NULL,
    description text,
    timestamp   timestamptz DEFAULT now(),
    location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.locations(id)
);

-- 6. get_user_role / get_user_location (identicas a prod tras migracion 024)
CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE u_role TEXT;
BEGIN
    SELECT role INTO u_role FROM public.profiles WHERE id = user_id AND active = true;
    RETURN COALESCE(u_role, 'anon');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_location(user_id uuid DEFAULT auth.uid())
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT location_id FROM public.profiles WHERE id = user_id AND active = true;
$$;

COMMIT;
