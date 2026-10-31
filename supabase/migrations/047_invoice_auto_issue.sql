-- 047_invoice_auto_issue.sql
--
-- La factura talonario se emite sola al registrar el pago de una cuenta
-- (js/app.js markTransactionAsPaid), aunque el cliente no haya dado cédula:
-- sale como CONSUMIDOR FINAL V-00000000. Esta migración agrega lo que eso
-- necesita en la base:
--
-- 1. update_invoice_client: completar o corregir nombre, cédula/RIF,
--    domicilio, teléfono y correo de una factura YA emitida, sin tocar su
--    número, control, productos ni montos. Caja (venta) y admin. Cada cambio
--    queda en invoice_client_changes con el valor anterior, quién y cuándo.
--
-- 2. void_invoice_for_correction: al tocar "Corregir" o "Deshacer" en una
--    cuenta ya cobrada, su factura queda ANULADA (el número no se reutiliza:
--    el correlativo no queda con huecos ni duplicados) y al cobrar de nuevo
--    sale otra con el siguiente número. La caja solo puede hacerlo con
--    facturas emitidas HOY (hora de Caracas); las de días anteriores las
--    anula solo el admin (void_invoice de 043).
--
-- Emisión: sigue siendo issue_invoice (039/043). Ya era idempotente por
-- cuenta: bloquea la fila del contador y, si la cuenta ya tiene una factura
-- emitida, devuelve esa misma. Dos teléfonos o un reintento nunca le dan dos
-- números a la misma cuenta.

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_client_changes (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    location_id      uuid NOT NULL REFERENCES public.locations(id),
    invoice_id       uuid NOT NULL REFERENCES public.invoices(id),
    invoice_number   integer NOT NULL,
    old_client_name  text,
    old_client_rif   text,
    old_client_address text,
    old_client_phone text,
    old_client_email text,
    new_client_name  text,
    new_client_rif   text,
    new_client_address text,
    new_client_phone text,
    new_client_email text,
    reason           text,
    changed_at       timestamptz NOT NULL DEFAULT now(),
    changed_by       uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_invoice_client_changes_invoice ON public.invoice_client_changes (invoice_id, changed_at DESC);

ALTER TABLE public.invoice_client_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin ve cambios de datos de factura" ON public.invoice_client_changes;
CREATE POLICY "Admin ve cambios de datos de factura" ON public.invoice_client_changes
    FOR SELECT TO authenticated
    USING ((get_user_role((select auth.uid())) = 'admin')
           AND (location_id = get_user_location((select auth.uid()))));

-- Desde 2026-10-30 Supabase no da permisos automáticos a tablas nuevas.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_client_changes TO anon, authenticated, service_role;
-- La caja lee las facturas del día para mostrar el N° en Clientes → Historial
-- (la política "Venta y admin ven facturas" de 039 sigue mandando).
GRANT SELECT ON public.invoices TO authenticated;

CREATE OR REPLACE FUNCTION public.update_invoice_client(
    p_number         integer,
    p_client_name    text,
    p_client_rif     text,
    p_client_address text,
    p_client_phone   text,
    p_client_email   text,
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
    v_name     text := trim(coalesce(p_client_name, ''));
    v_rif      text := upper(trim(coalesce(p_client_rif, '')));
    v_address  text := nullif(trim(coalesce(p_client_address, '')), '');
    v_phone    text := nullif(trim(coalesce(p_client_phone, '')), '');
    v_email    text := nullif(trim(coalesce(p_client_email, '')), '');
BEGIN
    IF get_user_role(auth.uid()) NOT IN ('venta', 'admin') THEN
        RAISE EXCEPTION 'Solo caja o administración pueden cambiar facturas' USING ERRCODE = '42501';
    END IF;

    -- Sin cédula: consumidor final, igual que al emitir sola.
    IF invoice_rif_key(v_rif) = '' THEN
        v_rif := 'V-00000000';
    END IF;
    IF v_name = '' THEN
        v_name := 'CONSUMIDOR FINAL';
    END IF;
    IF length(v_name) > 200 THEN
        RAISE EXCEPTION 'Nombre o razón social inválido' USING ERRCODE = '22023';
    END IF;
    IF length(invoice_rif_key(v_rif)) < 5 OR length(v_rif) > 30 THEN
        RAISE EXCEPTION 'Cédula o RIF inválido' USING ERRCODE = '22023';
    END IF;
    IF length(coalesce(v_address, '')) > 300 OR length(coalesce(v_phone, '')) > 30 OR length(coalesce(v_email, '')) > 120 THEN
        RAISE EXCEPTION 'Algún dato es demasiado largo' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_inv FROM public.invoices
     WHERE location_id = v_location AND number = p_number
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La factura N° % no existe', p_number USING ERRCODE = '22023';
    END IF;
    IF v_inv.status <> 'emitida' THEN
        RAISE EXCEPTION 'La factura N° % está anulada: no se le cambian los datos', p_number USING ERRCODE = '22023';
    END IF;
    IF v_inv.client_name = v_name AND v_inv.client_rif = v_rif
       AND v_inv.client_address IS NOT DISTINCT FROM v_address
       AND v_inv.client_phone IS NOT DISTINCT FROM v_phone
       AND v_inv.client_email IS NOT DISTINCT FROM v_email THEN
        RAISE EXCEPTION 'No hay nada que cambiar' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.invoice_client_changes (
        location_id, invoice_id, invoice_number,
        old_client_name, old_client_rif, old_client_address, old_client_phone, old_client_email,
        new_client_name, new_client_rif, new_client_address, new_client_phone, new_client_email,
        reason
    ) VALUES (
        v_location, v_inv.id, v_inv.number,
        v_inv.client_name, v_inv.client_rif, v_inv.client_address, v_inv.client_phone, v_inv.client_email,
        v_name, v_rif, v_address, v_phone, v_email,
        nullif(trim(coalesce(p_reason, '')), '')
    );

    UPDATE public.invoices
       SET client_name = v_name,
           client_rif = v_rif,
           client_rif_key = invoice_rif_key(v_rif),
           client_address = v_address,
           client_phone = v_phone,
           client_email = v_email
     WHERE id = v_inv.id
    RETURNING * INTO v_inv;

    RETURN invoice_public_json(v_inv);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_invoice_for_correction(
    p_sale_timestamp timestamptz,
    p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role     text := get_user_role(auth.uid());
    v_location uuid := coalesce(get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
    v_inv      public.invoices;
BEGIN
    IF v_role NOT IN ('venta', 'admin') THEN
        RAISE EXCEPTION 'Solo caja o administración pueden anular facturas' USING ERRCODE = '42501';
    END IF;
    IF length(trim(coalesce(p_reason, ''))) < 3 OR length(p_reason) > 300 THEN
        RAISE EXCEPTION 'Falta el motivo de la anulación' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_inv FROM public.invoices
     WHERE location_id = v_location AND sale_timestamp = p_sale_timestamp AND status = 'emitida'
     FOR UPDATE;
    IF NOT FOUND THEN
        -- Nada que anular (no tenía factura o ya estaba anulada): se puede seguir.
        RETURN NULL;
    END IF;

    IF v_role = 'venta'
       AND (v_inv.issued_at AT TIME ZONE 'America/Caracas')::date <> (now() AT TIME ZONE 'America/Caracas')::date THEN
        RAISE EXCEPTION 'La Factura N° % es de otro día: solo el administrador puede anularla', lpad(v_inv.number::text, 5, '0')
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.invoices
       SET status = 'anulada', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid()
     WHERE id = v_inv.id
    RETURNING * INTO v_inv;

    RETURN invoice_public_json(v_inv);
END;
$$;

REVOKE ALL ON FUNCTION public.update_invoice_client(integer, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_invoice_for_correction(timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_invoice_client(integer, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_invoice_for_correction(timestamptz, text) TO authenticated;

COMMIT;
