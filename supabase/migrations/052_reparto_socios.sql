-- Migration 052: reparto de socios de la pestaña Rentabilidad, en la base.
--
-- Hasta la v1.0.64 las personas del reparto (nombre + % de pastelitos + % de
-- lo demás) se guardaban solo en el navegador de cada equipo. Lo que Gustavo
-- cambiaba en el teléfono no se veía en la PC, y en un equipo sin nada guardado
-- volvía la lista de fábrica: "quito nombres y aparecen de nuevo" (27/11/2026).
-- Ahora se guardan aquí, iguales para todos los equipos. Solo el admin.
BEGIN;

CREATE TABLE IF NOT EXISTS public.reparto_socios (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      text NOT NULL CHECK (length(nombre) <= 60),
    pct         numeric(6,2) NOT NULL DEFAULT 0 CHECK (pct >= 0 AND pct <= 100),
    pct_otros   numeric(6,2) NOT NULL DEFAULT 0 CHECK (pct_otros >= 0 AND pct_otros <= 100),
    orden       integer NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reparto_socios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reparto_socios_admin ON public.reparto_socios;
CREATE POLICY reparto_socios_admin ON public.reparto_socios
    FOR ALL TO authenticated
    USING (public.get_user_role((select auth.uid())) = 'admin')
    WITH CHECK (public.get_user_role((select auth.uid())) = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reparto_socios TO authenticated, service_role;

-- Reemplaza la lista completa de una vez (borra y vuelve a escribir en una sola
-- transacción), así nunca queda a medias. SECURITY INVOKER: corre con los
-- permisos y la RLS de quien la llama (solo el admin puede escribir).
CREATE OR REPLACE FUNCTION public.guardar_reparto_socios(p_lista jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF public.get_user_role((select auth.uid())) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo el admin puede cambiar el reparto';
    END IF;
    DELETE FROM public.reparto_socios WHERE true;
    INSERT INTO public.reparto_socios (nombre, pct, pct_otros, orden)
    SELECT left(coalesce(x->>'nombre', ''), 60),
           least(100, greatest(0, coalesce((x->>'pct')::numeric, 0))),
           least(100, greatest(0, coalesce((x->>'pctOtros')::numeric, (x->>'pct')::numeric, 0))),
           (ord - 1)::int
    FROM jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) WITH ORDINALITY AS t(x, ord);
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_reparto_socios(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_reparto_socios(jsonb) TO authenticated;

COMMIT;
