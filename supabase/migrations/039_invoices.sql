-- Migration 039: facturas (formato carta estilo talonario) con correlativo propio.
--
-- Cada cuenta cobrada (sales agrupadas por timestamp) puede tener a lo sumo
-- UNA factura: pedirla de nuevo devuelve la misma (reimpresión), nunca un
-- número nuevo. El correlativo arranca en 46 porque la libreta en papel de la
-- imprenta va por ahí (N° 00046 / control 00-00000046).
--
-- El número sale de invoice_counters con UPDATE ... RETURNING dentro de la
-- misma transacción que inserta la factura: si algo falla, el contador
-- vuelve atrás junto con el INSERT. Una SEQUENCE no sirve acá porque
-- nextval() no se deshace en un rollback y dejaría huecos en el correlativo.
--
-- Los totales los calcula la base, no el cliente: los precios ya traen el
-- IVA 16% incluido, así que el total cobrado no cambia y solo se desglosa
-- en base imponible + IVA (igual que la Factura POS, PR #42).
--
-- Verificación pública (verify_invoice): la página /factura la llama como
-- anon. Solo devuelve una factura si el N° coincide Y además coincide la
-- cédula/RIF del cliente o el código de verificación impreso en la factura
-- (el que lleva el QR). Nunca lista facturas por RIF, así que saber la
-- cédula de alguien no alcanza para ver sus compras. Tras 10 intentos
-- fallidos sobre un mismo N° en una hora, ese N° deja de responder por
-- cédula/RIF hasta que pase la hora (frena probar cédulas una por una); el
-- código del QR sigue funcionando.
BEGIN;

CREATE TABLE public.invoice_counters (
    location_id uuid PRIMARY KEY REFERENCES public.locations(id),
    next_number integer NOT NULL CHECK (next_number > 0)
);

INSERT INTO public.invoice_counters (location_id, next_number)
VALUES ('00000000-0000-0000-0000-000000000001', 46)
ON CONFLICT (location_id) DO NOTHING;

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo lo tocan las funciones SECURITY DEFINER de abajo.

CREATE TABLE public.invoices (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id       uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id),
    number            integer NOT NULL,
    control_number    text NOT NULL,
    verify_code       text NOT NULL,
    sale_timestamp    timestamptz NOT NULL,
    client_name       text NOT NULL,
    client_rif        text NOT NULL,
    client_rif_key    text NOT NULL,
    client_address    text,
    client_phone      text,
    client_email      text,
    payment_method    text,
    payment_condition text NOT NULL DEFAULT 'Contado',
    bcv_rate          numeric(14,4) NOT NULL CHECK (bcv_rate > 0),
    items             jsonb NOT NULL,
    total_usd         numeric(14,2) NOT NULL,
    base_usd          numeric(14,2) NOT NULL,
    iva_usd           numeric(14,2) NOT NULL,
    total_bs          numeric(16,2) NOT NULL,
    base_bs           numeric(16,2) NOT NULL,
    iva_bs            numeric(16,2) NOT NULL,
    status            text NOT NULL DEFAULT 'emitida' CHECK (status IN ('emitida', 'anulada')),
    issued_at         timestamptz NOT NULL DEFAULT now(),
    issued_by         uuid DEFAULT auth.uid(),
    UNIQUE (location_id, number),
    UNIQUE (location_id, sale_timestamp)
);

CREATE INDEX idx_invoices_issued_at ON public.invoices (issued_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- La caja (venta/admin) ve las facturas de su local. Nadie inserta ni edita
-- directo: se emiten solo por issue_invoice().
CREATE POLICY "Venta y admin ven facturas" ON public.invoices
    FOR SELECT TO authenticated
    USING ((get_user_role((select auth.uid())) = ANY (ARRAY['admin'::text, 'venta'::text]))
           AND (location_id = get_user_location((select auth.uid()))));

CREATE TABLE public.invoice_verify_attempts (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    number      integer NOT NULL,
    tried_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_verify_attempts ON public.invoice_verify_attempts (number, tried_at DESC);
ALTER TABLE public.invoice_verify_attempts ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo lo escribe verify_invoice().

-- Cédula / RIF reducido a sus dígitos: "V-12.345.678", "v12345678" y
-- "12345678" son la misma persona; "J-50818313-4" -> "508183134".
CREATE OR REPLACE FUNCTION public.invoice_rif_key(p_rif text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT regexp_replace(coalesce(p_rif, ''), '[^0-9]', '', 'g');
$$;

-- Lo que se le muestra al cliente (y a la caja) de una factura.
CREATE OR REPLACE FUNCTION public.invoice_public_json(inv public.invoices)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'number', inv.number,
        'control_number', inv.control_number,
        'verify_code', inv.verify_code,
        'sale_timestamp', inv.sale_timestamp,
        'issued_at', inv.issued_at,
        'client_name', inv.client_name,
        'client_rif', inv.client_rif,
        'client_address', inv.client_address,
        'client_phone', inv.client_phone,
        'client_email', inv.client_email,
        'payment_method', inv.payment_method,
        'payment_condition', inv.payment_condition,
        'bcv_rate', inv.bcv_rate,
        'items', inv.items,
        'total_usd', inv.total_usd,
        'base_usd', inv.base_usd,
        'iva_usd', inv.iva_usd,
        'total_bs', inv.total_bs,
        'base_bs', inv.base_bs,
        'iva_bs', inv.iva_bs,
        'status', inv.status
    );
$$;

-- p_items: [{ "desc": "Pastelito de Carne", "qty": 4, "price": 2.50 }, ...]
-- price es el precio unitario en $ con IVA incluido, tal como se cobró.
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
     WHERE location_id = v_location AND sale_timestamp = p_sale_timestamp;
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

-- Factura ya emitida para una cuenta (o null), para reimprimir sin emitir.
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
       AND i.sale_timestamp = p_sale_timestamp;
$$;

CREATE OR REPLACE FUNCTION public.verify_invoice(
    p_number integer,
    p_rif    text DEFAULT NULL,
    p_code   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv public.invoices;
    v_key text := invoice_rif_key(p_rif);
BEGIN
    IF p_number IS NULL OR (length(v_key) < 5 AND length(coalesce(p_code, '')) < 6) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'datos_incompletos');
    END IF;

    -- El código del QR (8 caracteres al azar) no se puede adivinar probando,
    -- así que entra siempre, aunque ese N° esté frenado por intentos fallidos.
    IF length(coalesce(p_code, '')) >= 6 THEN
        SELECT * INTO v_inv FROM public.invoices
         WHERE number = p_number AND verify_code = upper(trim(p_code));
        IF FOUND THEN
            RETURN jsonb_build_object('ok', true, 'invoice', invoice_public_json(v_inv));
        END IF;
    END IF;

    IF (SELECT count(*) FROM public.invoice_verify_attempts
         WHERE number = p_number AND tried_at > now() - interval '1 hour') >= 10 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'demasiados_intentos');
    END IF;

    IF length(v_key) >= 5 THEN
        SELECT * INTO v_inv FROM public.invoices
         WHERE number = p_number AND client_rif_key = v_key;
    END IF;

    IF NOT FOUND THEN
        INSERT INTO public.invoice_verify_attempts (number) VALUES (p_number);
        DELETE FROM public.invoice_verify_attempts WHERE tried_at < now() - interval '1 day';
        RETURN jsonb_build_object('ok', false, 'reason', 'no_encontrada');
    END IF;

    RETURN jsonb_build_object('ok', true, 'invoice', invoice_public_json(v_inv));
END;
$$;

REVOKE ALL ON FUNCTION public.invoice_public_json(public.invoices) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_invoice(timestamptz, text, text, text, text, text, text, numeric, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_invoice_for_sale(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_invoice(integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_invoice(timestamptz, text, text, text, text, text, text, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoice_for_sale(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_invoice(integer, text, text) TO anon, authenticated;

COMMIT;
