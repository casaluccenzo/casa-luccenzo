-- Migration 051: gastos fijos mensuales de la pestaña Rentabilidad.
--
-- Gustavo anota lo que le cuesta cada mes el alquiler del local, el relleno
-- sanitario, el internet, etc. (él escoge los nombres), en dólares o en Bs.
-- El POS los prorratea según el período que se mira (día, semana, mes, rango)
-- y los resta de la ganancia antes del reparto por porcentajes.
-- Se guardan en la base para que se vean igual en todos los equipos.
-- Solo el admin los puede ver o cambiar (la vendedora no).
BEGIN;

CREATE TABLE IF NOT EXISTS public.fixed_expenses (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 60),
    monto       numeric(16,2) NOT NULL DEFAULT 0 CHECK (monto >= 0),
    moneda      text NOT NULL DEFAULT 'usd' CHECK (moneda IN ('usd', 'bs')),
    orden       integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fixed_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fixed_expenses_admin ON public.fixed_expenses;
CREATE POLICY fixed_expenses_admin ON public.fixed_expenses
    FOR ALL TO authenticated
    USING (public.get_user_role((select auth.uid())) = 'admin')
    WITH CHECK (public.get_user_role((select auth.uid())) = 'admin');

-- Supabase ya no da GRANT automático a tablas nuevas (desde 2026-10-30).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_expenses TO anon, authenticated, service_role;

COMMIT;
