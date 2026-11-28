-- Migration 054: notas de entrega (despacho a cliente). Ver docs/NOTA-DE-ENTREGA.md.
--
-- Una nota documenta que se le entregó mercancía a un cliente y lleva su
-- firma. No es factura (sin valor fiscal) y no mueve stock: el stock ya lo
-- descontó la venta. Nada aquí toca public.sales ni tiene triggers sobre
-- ella, así que no puede frenar una venta (regla 2 de AGENTS.md).
--
-- Sale de una cuenta (ventas agrupadas por timestamp, cobrada o fiada) o de
-- un pedido en línea confirmado. A lo sumo UNA nota por cuenta y una por
-- pedido: pedirla otra vez devuelve la misma (reimpresión).
--
-- Los productos los arma la base leyendo sales / pedidos_online, no los manda
-- la caja: así la nota no puede decir algo que no se vendió.
--
-- Correlativo sin huecos: UPDATE ... RETURNING en la misma transacción que
-- el INSERT (igual que invoice_counters en la 039).
BEGIN;

CREATE TABLE public.delivery_note_counters (
    location_id uuid PRIMARY KEY REFERENCES public.locations(id),
    next_number integer NOT NULL CHECK (next_number > 0)
);

INSERT INTO public.delivery_note_counters (location_id, next_number)
SELECT id, 1 FROM public.locations
ON CONFLICT (location_id) DO NOTHING;

ALTER TABLE public.delivery_note_counters ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo lo tocan las funciones SECURITY DEFINER de abajo.

CREATE TABLE public.delivery_notes (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id        uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id),
    number             integer NOT NULL,
    source             text NOT NULL CHECK (source IN ('venta', 'pedido')),
    sale_timestamp     timestamptz,
    pedido_id          uuid REFERENCES public.pedidos_online(id),
    client_name        text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 200),
    client_rif         text CHECK (client_rif IS NULL OR char_length(client_rif) <= 30),
    client_phone       text CHECK (client_phone IS NULL OR char_length(client_phone) <= 40),
    delivery_address   text CHECK (delivery_address IS NULL OR char_length(delivery_address) <= 300),
    delivery_reference text CHECK (delivery_reference IS NULL OR char_length(delivery_reference) <= 300),
    items              jsonb NOT NULL,
    total_usd          numeric(14,2) NOT NULL,
    bcv_rate           numeric(14,4) CHECK (bcv_rate IS NULL OR bcv_rate > 0),
    total_bs           numeric(16,2),
    show_prices        boolean NOT NULL DEFAULT true,
    notes              text CHECK (notes IS NULL OR char_length(notes) <= 300),
    status             text NOT NULL DEFAULT 'emitida' CHECK (status IN ('emitida', 'entregada', 'anulada')),
    received_by_name   text CHECK (received_by_name IS NULL OR char_length(received_by_name) <= 200),
    received_by_rif    text CHECK (received_by_rif IS NULL OR char_length(received_by_rif) <= 30),
    delivered_at       timestamptz,
    void_reason        text,
    voided_at          timestamptz,
    voided_by          uuid,
    issued_at          timestamptz NOT NULL DEFAULT now(),
    issued_by          uuid DEFAULT auth.uid(),
    UNIQUE (location_id, number),
    UNIQUE (location_id, sale_timestamp),
    UNIQUE (location_id, pedido_id),
    CHECK ((source = 'venta'  AND sale_timestamp IS NOT NULL AND pedido_id IS NULL)
        OR (source = 'pedido' AND pedido_id IS NOT NULL AND sale_timestamp IS NULL))
);

CREATE INDEX idx_delivery_notes_issued_at ON public.delivery_notes (location_id, issued_at DESC);

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;

-- Caja y admin ven las notas de su local. Nadie inserta ni edita directo.
CREATE POLICY "Venta y admin ven notas de entrega" ON public.delivery_notes
    FOR SELECT TO authenticated
    USING ((public.get_user_role((select auth.uid())) = ANY (ARRAY['admin'::text, 'venta'::text]))
           AND (location_id = public.get_user_location((select auth.uid()))));

-- Supabase ya no da GRANT automático a tablas nuevas (ver 045). Las escrituras
-- igual las frena RLS (sin políticas de INSERT/UPDATE/DELETE).
GRANT SELECT ON public.delivery_notes TO authenticated;
GRANT ALL ON public.delivery_notes, public.delivery_note_counters TO service_role;
-- anon no tiene nada que ver aquí (los privilegios por defecto se lo darían).
REVOKE ALL ON public.delivery_notes, public.delivery_note_counters FROM anon;

-- Descripción de una venta sin la etiqueta del cliente "[...]" ni la forma
-- de pago "(Pagado - ...)": lo mismo que hace invoiceDataForAccount en la caja.
CREATE OR REPLACE FUNCTION public.delivery_note_item_desc(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT trim(regexp_replace(
               regexp_replace(coalesce(p_name, ''), '\s*\[[^\]]*\]', '', 'g'),
               '\s*\((Pagado|Punto|Pago|Efectivo|Biopago)[^)]*\)', '', 'gi'));
$$;

CREATE OR REPLACE FUNCTION public.issue_delivery_note(
    p_source         text,
    p_sale_timestamp timestamptz,
    p_pedido_id      uuid,
    p_client_name    text,
    p_client_rif     text,
    p_client_phone   text,
    p_show_prices    boolean,
    p_notes          text,
    p_bcv_rate       numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role     text := public.get_user_role(auth.uid());
    v_location uuid := coalesce(public.get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
    v_existing public.delivery_notes;
    v_new      public.delivery_notes;
    v_items    jsonb;
    v_total    numeric;
    v_tag      text;
    v_name     text := nullif(trim(coalesce(p_client_name, '')), '');
    v_rif      text := nullif(upper(trim(coalesce(p_client_rif, ''))), '');
    v_phone    text := nullif(trim(coalesce(p_client_phone, '')), '');
    v_address  text;
    v_ref      text;
    v_rate     numeric := CASE WHEN p_bcv_rate > 0 THEN p_bcv_rate END;
    v_pedido   public.pedidos_online;
    v_number   integer;
BEGIN
    IF v_role IS NULL OR v_role NOT IN ('venta', 'admin') THEN
        RAISE EXCEPTION 'Solo caja o administración pueden emitir notas de entrega' USING ERRCODE = '42501';
    END IF;
    IF p_source NOT IN ('venta', 'pedido') THEN
        RAISE EXCEPTION 'Origen inválido' USING ERRCODE = '22023';
    END IF;
    IF length(coalesce(p_notes, '')) > 300 THEN
        RAISE EXCEPTION 'Las observaciones son muy largas (máx. 300)' USING ERRCODE = '22023';
    END IF;

    -- Bloquea el contador antes de buscar: dos toques seguidos quedan en fila
    -- y el segundo encuentra la nota del primero.
    PERFORM 1 FROM public.delivery_note_counters WHERE location_id = v_location FOR UPDATE;

    IF p_source = 'venta' THEN
        IF p_sale_timestamp IS NULL THEN
            RAISE EXCEPTION 'Falta la cuenta' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_existing FROM public.delivery_notes
         WHERE location_id = v_location AND sale_timestamp = p_sale_timestamp;
        IF FOUND THEN
            RETURN to_jsonb(v_existing) || jsonb_build_object('reissued', true);
        END IF;

        IF EXISTS (SELECT 1 FROM public.sales s
                    WHERE s.location_id = v_location AND s.timestamp = p_sale_timestamp
                      AND s.voided_at IS NULL AND s.name LIKE '%[Ajuste Inventario]%') THEN
            RAISE EXCEPTION 'Un ajuste de inventario no lleva nota de entrega' USING ERRCODE = '22023';
        END IF;

        SELECT coalesce(jsonb_agg(jsonb_build_object('desc', d, 'qty', q, 'price', round(t / q, 2), 'total', round(t, 2))
                                  ORDER BY d), '[]'::jsonb),
               coalesce(round(sum(t), 2), 0)
          INTO v_items, v_total
          FROM (SELECT public.delivery_note_item_desc(s.name) AS d,
                       count(*)::integer AS q,
                       sum(coalesce(s.price, 0)) AS t
                  FROM public.sales s
                 WHERE s.location_id = v_location
                   AND s.timestamp = p_sale_timestamp
                   AND s.voided_at IS NULL
                   AND s.product_id IS DISTINCT FROM 'abono'
                 GROUP BY 1) g;

        IF jsonb_array_length(v_items) = 0 THEN
            RAISE EXCEPTION 'No se encontró la venta' USING ERRCODE = 'P0002';
        END IF;

        -- Nombre y cédula de la etiqueta "[Nombre - V-123]" si la caja no los manda.
        SELECT substring(s.name from '\[([^\]]*)\]') INTO v_tag
          FROM public.sales s
         WHERE s.location_id = v_location AND s.timestamp = p_sale_timestamp AND s.voided_at IS NULL
         LIMIT 1;
        IF v_name IS NULL THEN
            v_name := nullif(trim(split_part(coalesce(v_tag, ''), ' - ', 1)), '');
        END IF;
        IF v_rif IS NULL AND coalesce(v_tag, '') ~ ' - [VJEGPvjegp]' THEN
            v_rif := nullif(upper(trim(substring(v_tag from ' - (.*)$'))), '');
        END IF;
        IF v_rate IS NULL THEN
            SELECT max(s.bcv_rate) INTO v_rate FROM public.sales s
             WHERE s.location_id = v_location AND s.timestamp = p_sale_timestamp AND s.bcv_rate > 0;
        END IF;
    ELSE
        IF p_pedido_id IS NULL THEN
            RAISE EXCEPTION 'Falta el pedido' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_existing FROM public.delivery_notes
         WHERE location_id = v_location AND pedido_id = p_pedido_id;
        IF FOUND THEN
            RETURN to_jsonb(v_existing) || jsonb_build_object('reissued', true);
        END IF;

        SELECT * INTO v_pedido FROM public.pedidos_online p
         WHERE p.id = p_pedido_id AND p.location_id = v_location;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se encontró el pedido' USING ERRCODE = 'P0002';
        END IF;
        IF v_pedido.status <> 'confirmado' THEN
            RAISE EXCEPTION 'Solo los pedidos confirmados llevan nota de entrega' USING ERRCODE = '22023';
        END IF;

        SELECT coalesce(jsonb_agg(jsonb_build_object('desc', d, 'qty', q, 'price', p, 'total', round(q * p, 2))
                                  ORDER BY ord), '[]'::jsonb),
               coalesce(round(sum(q * p), 2), 0)
          INTO v_items, v_total
          FROM (SELECT left(trim(coalesce(x->>'name', x->>'desc', '')), 200) AS d,
                       greatest(1, coalesce((x->>'qty')::integer, 1)) AS q,
                       round(greatest(0, coalesce((x->>'price')::numeric, 0)), 2) AS p,
                       ord
                  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_pedido.items) = 'array'
                                                 THEN v_pedido.items ELSE '[]'::jsonb END)
                       WITH ORDINALITY AS t(x, ord)) g
         WHERE d <> '';

        IF jsonb_array_length(v_items) = 0 THEN
            RAISE EXCEPTION 'El pedido no tiene productos' USING ERRCODE = '22023';
        END IF;

        v_name    := coalesce(v_name, nullif(trim(v_pedido.customer_name), ''));
        v_phone   := coalesce(v_phone, nullif(trim(v_pedido.customer_phone), ''));
        IF v_pedido.delivery_method = 'delivery' THEN
            v_address := nullif(trim(coalesce(v_pedido.delivery_address, '')), '');
            v_ref     := nullif(trim(coalesce(v_pedido.delivery_reference, '')), '');
        END IF;
    END IF;

    v_name := left(coalesce(v_name, 'Cliente'), 200);
    v_rif := left(v_rif, 30);
    v_phone := left(v_phone, 40);

    UPDATE public.delivery_note_counters
       SET next_number = next_number + 1
     WHERE location_id = v_location
    RETURNING next_number - 1 INTO v_number;
    IF v_number IS NULL THEN
        INSERT INTO public.delivery_note_counters (location_id, next_number) VALUES (v_location, 2);
        v_number := 1;
    END IF;

    INSERT INTO public.delivery_notes (
        location_id, number, source, sale_timestamp, pedido_id,
        client_name, client_rif, client_phone, delivery_address, delivery_reference,
        items, total_usd, bcv_rate, total_bs, show_prices, notes
    ) VALUES (
        v_location, v_number, p_source,
        CASE WHEN p_source = 'venta' THEN p_sale_timestamp END,
        CASE WHEN p_source = 'pedido' THEN p_pedido_id END,
        v_name, v_rif, v_phone, v_address, v_ref,
        v_items, v_total, v_rate,
        CASE WHEN v_rate > 0 THEN round(v_total * v_rate, 2) END,
        coalesce(p_show_prices, true),
        nullif(trim(coalesce(p_notes, '')), '')
    )
    RETURNING * INTO v_new;

    RETURN to_jsonb(v_new) || jsonb_build_object('reissued', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_delivery_note_delivered(
    p_id               uuid,
    p_received_by_name text,
    p_received_by_rif  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role     text := public.get_user_role(auth.uid());
    v_location uuid := coalesce(public.get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
    v_note     public.delivery_notes;
    v_name     text := nullif(trim(coalesce(p_received_by_name, '')), '');
BEGIN
    IF v_role IS NULL OR v_role NOT IN ('venta', 'admin') THEN
        RAISE EXCEPTION 'Solo caja o administración pueden marcar entregas' USING ERRCODE = '42501';
    END IF;
    IF v_name IS NULL OR length(v_name) > 200 THEN
        RAISE EXCEPTION 'Falta el nombre de quien recibió' USING ERRCODE = '22023';
    END IF;
    IF length(coalesce(p_received_by_rif, '')) > 30 THEN
        RAISE EXCEPTION 'La cédula es muy larga' USING ERRCODE = '22023';
    END IF;

    UPDATE public.delivery_notes
       SET status = 'entregada',
           received_by_name = v_name,
           received_by_rif = nullif(upper(trim(coalesce(p_received_by_rif, ''))), ''),
           delivered_at = now()
     WHERE id = p_id AND location_id = v_location AND status = 'emitida'
    RETURNING * INTO v_note;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La nota no existe, ya fue entregada o está anulada' USING ERRCODE = 'P0002';
    END IF;
    RETURN to_jsonb(v_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_delivery_note(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_location uuid := coalesce(public.get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
    v_note     public.delivery_notes;
    v_reason   text := nullif(trim(coalesce(p_reason, '')), '');
BEGIN
    IF public.get_user_role(auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo el admin puede anular notas de entrega' USING ERRCODE = '42501';
    END IF;
    IF v_reason IS NULL OR length(v_reason) > 300 THEN
        RAISE EXCEPTION 'Escriba el motivo de la anulación' USING ERRCODE = '22023';
    END IF;

    UPDATE public.delivery_notes
       SET status = 'anulada', void_reason = v_reason, voided_at = now(), voided_by = auth.uid()
     WHERE id = p_id AND location_id = v_location AND status <> 'anulada'
    RETURNING * INTO v_note;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La nota no existe o ya está anulada' USING ERRCODE = 'P0002';
    END IF;
    RETURN to_jsonb(v_note);
END;
$$;

REVOKE ALL ON FUNCTION public.delivery_note_item_desc(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_delivery_note(text, timestamptz, uuid, text, text, text, boolean, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_delivery_note_delivered(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_delivery_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_delivery_note(text, timestamptz, uuid, text, text, text, boolean, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_delivery_note_delivered(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_delivery_note(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
