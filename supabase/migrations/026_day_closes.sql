-- Migration 026: day_closes — cada cierre de jornada es una fila (append-only).
--
-- last_close_at() es la frontera para el cálculo de stock (spec §5.1a). Dos
-- dispositivos que cierran offline generan dos filas; gana la más nueva vía
-- MAX(closed_at). Dormida al aplicarse.

BEGIN;

CREATE TABLE public.day_closes (
    id          text PRIMARY KEY,
    closed_at   timestamptz NOT NULL DEFAULT now(),
    device_id   text,
    totals      jsonb,
    location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_day_closes_closed_at ON public.day_closes (closed_at DESC);

ALTER TABLE public.day_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de day_closes" ON public.day_closes;
CREATE POLICY "Lectura de day_closes" ON public.day_closes
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Venta y admin cierran jornada" ON public.day_closes;
CREATE POLICY "Venta y admin cierran jornada" ON public.day_closes
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('venta','admin'));

CREATE OR REPLACE FUNCTION public.last_close_at()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(MAX(closed_at), '-infinity'::timestamptz) FROM public.day_closes;
$$;

REVOKE EXECUTE ON FUNCTION public.last_close_at() FROM PUBLIC, anon;
-- authenticated lo necesita: lo llaman las vistas de reporte del cliente.

COMMIT;
