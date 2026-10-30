-- Migration 045: correlativo de facturas desde 119 y corrección de números (solo admin).
--
-- 1) La próxima factura sale con N° 00119 / control 00-00000119 (pedido de
--    Gustavo, 2026-10-30, para seguir la libreta de la imprenta). En prod el
--    contador ya se puso en 119 a mano ese día; el UPDATE de abajo solo sube,
--    así que ahí no hace nada. Las ya emitidas (46 a 55) no cambian.
-- 2) set_invoice_next_number: el admin cambia el número de la próxima factura.
--    Nunca puede quedar en un número ya usado ni por debajo del mayor emitido,
--    así no se repiten números.
-- 3) renumber_invoice: el admin corrige el N° y/o el número de control de una
--    factura ya emitida (por si quedó mal escrito). No deja repetir un N° ni un
--    control de otra factura. Si el N° nuevo es igual o mayor que el contador,
--    el contador salta al siguiente para que la próxima factura no choque.
-- Cada cambio (del contador o de una factura) queda en invoice_number_changes
-- con el valor anterior, el nuevo, el motivo, quién y cuándo.
BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_number_changes (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    location_id        uuid NOT NULL REFERENCES public.locations(id),
    kind               text NOT NULL CHECK (kind IN ('contador', 'factura')),
    invoice_id         uuid REFERENCES public.invoices(id),
    old_number         integer,
    new_number         integer,
    old_control_number text,
    new_control_number text,
    reason             text,
    changed_at         timestamptz NOT NULL DEFAULT now(),
    changed_by         uuid DEFAULT auth.uid()
);

ALTER TABLE public.invoice_number_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin ve cambios de correlativo" ON public.invoice_number_changes
    FOR SELECT TO authenticated
    USING ((get_user_role((select auth.uid())) = 'admin')
           AND (location_id = get_user_location((select auth.uid()))));
-- Nadie escribe directo: solo las funciones SECURITY DEFINER de abajo.

-- Supabase ya no da GRANT automático a tablas nuevas (desde 2026-10-30).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_number_changes TO anon, authenticated, service_role;

-- Arranque en 119 (solo sube: si ya hubiera facturas por encima, sigue después de la mayor).
UPDATE public.invoice_counters c
   SET next_number = greatest(119, coalesce((SELECT max(number) + 1 FROM public.invoices i
                                              WHERE i.location_id = c.location_id), 1))
 WHERE location_id = '00000000-0000-0000-0000-000000000001'
   AND next_number < 119;

INSERT INTO public.invoice_number_changes (location_id, kind, new_number, reason, changed_by)
SELECT location_id, 'contador', next_number, 'Correlativo desde el N° 119 (pedido 2026-10-30)', NULL
  FROM public.invoice_counters
 WHERE location_id = '00000000-0000-0000-0000-000000000001';

-- Número que llevará la próxima factura (para mostrarlo en la caja).
CREATE OR REPLACE FUNCTION public.get_invoice_next_number()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.next_number
      FROM public.invoice_counters c
     WHERE get_user_role(auth.uid()) IN ('venta', 'admin')
       AND c.location_id = coalesce(get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
$$;

CREATE OR REPLACE FUNCTION public.set_invoice_next_number(p_next integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_location uuid := coalesce(get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
    v_old      integer;
    v_max      integer;
BEGIN
    IF get_user_role(auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo el administrador puede cambiar el correlativo' USING ERRCODE = '42501';
    END IF;
    IF p_next IS NULL OR p_next < 1 OR p_next > 99999999 THEN
        RAISE EXCEPTION 'Número de factura inválido' USING ERRCODE = '22023';
    END IF;

    -- Mismo candado que issue_invoice: nadie emite mientras se cambia.
    SELECT next_number INTO v_old FROM public.invoice_counters WHERE location_id = v_location FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO public.invoice_counters (location_id, next_number) VALUES (v_location, 1);
        v_old := 1;
    END IF;

    SELECT max(number) INTO v_max FROM public.invoices WHERE location_id = v_location;
    IF v_max IS NOT NULL AND p_next <= v_max THEN
        RAISE EXCEPTION 'La próxima factura tiene que ser mayor que la N° % (ya emitida)', lpad(v_max::text, 5, '0')
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.invoice_counters SET next_number = p_next WHERE location_id = v_location;
    INSERT INTO public.invoice_number_changes (location_id, kind, old_number, new_number, reason)
    VALUES (v_location, 'contador', v_old, p_next, 'Cambio de la próxima factura');
    RETURN p_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.renumber_invoice(
    p_number         integer,
    p_new_number     integer,
    p_new_control    text,
    p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_location uuid := coalesce(get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
    v_inv      public.invoices;
    v_control  text := upper(trim(coalesce(p_new_control, '')));
BEGIN
    IF get_user_role(auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo el administrador puede corregir facturas' USING ERRCODE = '42501';
    END IF;
    IF p_new_number IS NULL OR p_new_number < 1 OR p_new_number > 99999999 THEN
        RAISE EXCEPTION 'Número de factura inválido' USING ERRCODE = '22023';
    END IF;
    IF v_control = '' THEN
        v_control := '00-' || lpad(p_new_number::text, 8, '0');
    END IF;
    IF v_control !~ '^[0-9][0-9-]{0,18}[0-9]$' THEN
        RAISE EXCEPTION 'Número de control inválido (solo números y guiones, ej. 00-00000119)' USING ERRCODE = '22023';
    END IF;
    IF length(trim(coalesce(p_reason, ''))) < 3 OR length(p_reason) > 300 THEN
        RAISE EXCEPTION 'Escriba el motivo de la corrección' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.invoice_counters WHERE location_id = v_location FOR UPDATE;

    SELECT * INTO v_inv FROM public.invoices WHERE location_id = v_location AND number = p_number FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La factura N° % no existe', p_number USING ERRCODE = '22023';
    END IF;
    IF p_new_number = v_inv.number AND v_control = v_inv.control_number THEN
        RAISE EXCEPTION 'No hay nada que cambiar' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.invoices WHERE location_id = v_location AND number = p_new_number AND id <> v_inv.id) THEN
        RAISE EXCEPTION 'Ya existe otra factura con el N° %', lpad(p_new_number::text, 5, '0') USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM public.invoices WHERE location_id = v_location AND control_number = v_control AND id <> v_inv.id) THEN
        RAISE EXCEPTION 'Ya existe otra factura con el control %', v_control USING ERRCODE = '23505';
    END IF;

    UPDATE public.invoices SET number = p_new_number, control_number = v_control WHERE id = v_inv.id;

    -- Que la próxima factura no caiga en el número que se acaba de ocupar.
    UPDATE public.invoice_counters SET next_number = p_new_number + 1
     WHERE location_id = v_location AND next_number <= p_new_number;

    INSERT INTO public.invoice_number_changes
        (location_id, kind, invoice_id, old_number, new_number, old_control_number, new_control_number, reason)
    VALUES (v_location, 'factura', v_inv.id, v_inv.number, p_new_number, v_inv.control_number, v_control, trim(p_reason));

    SELECT * INTO v_inv FROM public.invoices WHERE id = v_inv.id;
    RETURN invoice_public_json(v_inv);
END;
$$;

REVOKE ALL ON FUNCTION public.get_invoice_next_number() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_invoice_next_number(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renumber_invoice(integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_next_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_invoice_next_number(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renumber_invoice(integer, integer, text, text) TO authenticated;

COMMIT;
