-- Migration 043: anular facturas (solo admin).
--
-- Una factura emitida no se edita nunca. Si se emitió por error (o su cuenta
-- se deshizo), el admin la anula: queda guardada con su número, marcada
-- ANULADA con el motivo, quién y cuándo, y el correlativo no pierde números.
-- /factura ya la muestra como "Factura anulada".
--
-- Después de anular, esa cuenta puede corregirse y emitirse otra factura con
-- el número siguiente; por eso la regla "una factura por cuenta" pasa a ser
-- "una factura EMITIDA por cuenta" (índice parcial en vez del UNIQUE).
BEGIN;

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS void_reason text,
    ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
    ADD COLUMN IF NOT EXISTS voided_by   uuid;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_location_id_sale_timestamp_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_emitida_per_sale
    ON public.invoices (location_id, sale_timestamp) WHERE status = 'emitida';

-- Igual que en 039, salvo que una factura anulada ya no cuenta como "la
-- factura de esta cuenta": se puede emitir otra.
CREATE OR REPLACE FUNCTION public.issue_invoice(
    p_sale_timestamp timestamptz,
    p_client_name    text,
    p_client_rif     text,
    p_client_address text,
    p_client_phone   text,
    p_client_email   text,
    p_payment_method text,
    p_bcv_rate       numeric,
    p_items          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role      text := get_user_role(auth.uid());
    v_location  uuid := coalesce(get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
    v_existing  public.invoices;
    v_new       public.invoices;
    v_items     jsonb := '[]'::jsonb;
    v_item      jsonb;
    v_qty       integer;
    v_price     numeric;
    v_desc      text;
    v_total_usd numeric := 0;
    v_base_usd  numeric;
    v_total_bs  numeric;
    v_base_bs   numeric;
    v_number    integer;
BEGIN
    IF v_role NOT IN ('venta', 'admin') THEN
        RAISE EXCEPTION 'Solo caja o administración pueden emitir facturas' USING ERRCODE = '42501';
    END IF;

    -- Bloquea el contador del local antes de mirar si ya hay factura: dos
    -- toques seguidos en "Emitir" para la misma cuenta quedan en fila y el
    -- segundo encuentra la factura del primero en vez de chocar.
    PERFORM 1 FROM public.invoice_counters WHERE location_id = v_location FOR UPDATE;

    SELECT * INTO v_existing FROM public.invoices
     WHERE location_id = v_location AND sale_timestamp = p_sale_timestamp
       AND status = 'emitida';
    IF FOUND THEN
        RETURN invoice_public_json(v_existing) || jsonb_build_object('reissued', true);
    END IF;

    IF p_sale_timestamp IS NULL THEN
        RAISE EXCEPTION 'Falta la cuenta a facturar' USING ERRCODE = '22023';
    END IF;
    IF length(trim(coalesce(p_client_name, ''))) = 0 OR length(p_client_name) > 200 THEN
        RAISE EXCEPTION 'Nombre o razón social inválido' USING ERRCODE = '22023';
    END IF;
    IF length(invoice_rif_key(p_client_rif)) < 5 OR length(p_client_rif) > 30 THEN
        RAISE EXCEPTION 'Cédula o RIF inválido' USING ERRCODE = '22023';
    END IF;
    IF p_bcv_rate IS NULL OR p_bcv_rate <= 0 THEN
        RAISE EXCEPTION 'Tasa BCV inválida' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 100 THEN
        RAISE EXCEPTION 'La factura necesita al menos un producto' USING ERRCODE = '22023';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_desc  := trim(coalesce(v_item->>'desc', ''));
        v_qty   := (v_item->>'qty')::integer;
        v_price := round((v_item->>'price')::numeric, 2);
        IF v_desc = '' OR length(v_desc) > 200 OR v_qty IS NULL OR v_qty <= 0 OR v_qty > 9999
           OR v_price IS NULL OR v_price < 0 THEN
            RAISE EXCEPTION 'Producto inválido en la factura' USING ERRCODE = '22023';
        END IF;
        v_items := v_items || jsonb_build_object(
            'desc', v_desc, 'qty', v_qty, 'price', v_price, 'total', v_qty * v_price);
        v_total_usd := v_total_usd + v_qty * v_price;
    END LOOP;

    v_total_usd := round(v_total_usd, 2);
    v_base_usd  := round(v_total_usd / 1.16, 2);
    v_total_bs  := round(v_total_usd * p_bcv_rate, 2);
    v_base_bs   := round(v_total_bs / 1.16, 2);

    UPDATE public.invoice_counters
       SET next_number = next_number + 1
     WHERE location_id = v_location
    RETURNING next_number - 1 INTO v_number;
    IF v_number IS NULL THEN
        INSERT INTO public.invoice_counters (location_id, next_number) VALUES (v_location, 2);
        v_number := 1;
    END IF;

    INSERT INTO public.invoices (
        location_id, number, control_number, verify_code, sale_timestamp,
        client_name, client_rif, client_rif_key, client_address, client_phone, client_email,
        payment_method, bcv_rate, items,
        total_usd, base_usd, iva_usd, total_bs, base_bs, iva_bs
    ) VALUES (
        v_location, v_number, '00-' || lpad(v_number::text, 8, '0'),
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
        p_sale_timestamp,
        trim(p_client_name), upper(trim(p_client_rif)), invoice_rif_key(p_client_rif),
        nullif(trim(coalesce(p_client_address, '')), ''),
        nullif(trim(coalesce(p_client_phone, '')), ''),
        nullif(trim(coalesce(p_client_email, '')), ''),
        nullif(trim(coalesce(p_payment_method, '')), ''),
        p_bcv_rate, v_items,
        v_total_usd, v_base_usd, v_total_usd - v_base_usd,
        v_total_bs, v_base_bs, v_total_bs - v_base_bs
    )
    RETURNING * INTO v_new;

    RETURN invoice_public_json(v_new) || jsonb_build_object('reissued', false);
END;
$$;

-- Solo la factura vigente (emitida) de la cuenta, o null.
CREATE OR REPLACE FUNCTION public.get_invoice_for_sale(p_sale_timestamp timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT invoice_public_json(i)
      FROM public.invoices i
     WHERE get_user_role(auth.uid()) IN ('venta', 'admin')
       AND i.location_id = coalesce(get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001')
       AND i.sale_timestamp = p_sale_timestamp
       AND i.status = 'emitida';
$$;

CREATE OR REPLACE FUNCTION public.void_invoice(p_number integer, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_location uuid := coalesce(get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
    v_inv      public.invoices;
BEGIN
    IF get_user_role(auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo el administrador puede anular facturas' USING ERRCODE = '42501';
    END IF;
    IF length(trim(coalesce(p_reason, ''))) < 3 OR length(p_reason) > 300 THEN
        RAISE EXCEPTION 'Escriba el motivo de la anulación' USING ERRCODE = '22023';
    END IF;

    UPDATE public.invoices
       SET status = 'anulada', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid()
     WHERE location_id = v_location AND number = p_number AND status = 'emitida'
    RETURNING * INTO v_inv;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La factura N° % no existe o ya estaba anulada', p_number USING ERRCODE = '22023';
    END IF;

    RETURN invoice_public_json(v_inv);
END;
$$;

REVOKE ALL ON FUNCTION public.void_invoice(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_invoice(integer, text) TO authenticated;

COMMIT;
