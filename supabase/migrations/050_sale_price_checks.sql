-- Migration 050: el servidor revisa el precio de cada venta (sin bloquearla).
--
-- Hasta ahora la caja calcula el precio y Postgres guarda lo que llegue. Esta
-- migración compara cada venta con el precio real del producto y, si no cuadra,
-- la anota en `sale_price_alerts` para que el admin la vea.
--
-- Por qué ANOTAR y no RECHAZAR: las ventas suben por la cola de PowerSync de
-- cada caja. Si el servidor rechaza una fila, esa cola se traba y las ventas
-- siguientes de ese dispositivo dejan de subir (lo mismo que evita la 038).
-- Además hay precios legítimos distintos al de lista (combos, promo, consumo
-- del personal, delivery, extras). El trigger nunca hace fallar el INSERT.
--
-- Reglas (copiadas de js/combos.js; tests/sale-price-rules.test.js comprueba
-- que los números sigan iguales). Lo pagado en Bs = price × bcv_rate de la
-- venta, con 1% de margen (o Bs 1) por la tasa que usó la caja:
--   * delivery: entre $0 y $50                     (Combos.DELIVERY.maxUsd)
--   * extra: mayor que $0 y hasta $50              (Combos.EXTRA.maxUsd)
--   * " · Consumo personal": pastelitos al costo en Bs (products.cost)
--   * " · Combo …": precio fijo del producto, Bs 2.000 los martes y miércoles
--     para pastelitos (Combos.PROMO), Bs 750 el mini (Combo Mini) o el precio
--     de una bebida de combo (Bs 800, 500, 600, 900)
--   * resto: products.price_bs en Bs si lo tiene, si no products.price en $
-- Probado contra las ventas reales: desde el 18/10/2026 ninguna venta da
-- alarma. Las anteriores tenían otros precios de lista y no se revisan
-- (el trigger solo mira ventas nuevas o editadas).
BEGIN;

CREATE TABLE IF NOT EXISTS public.sale_price_alerts (
    sale_uuid       text PRIMARY KEY,
    location_id     uuid NOT NULL,
    sale_timestamp  timestamptz,
    product_id      text,
    name            text,
    price           numeric,          -- lo que se cobró, en $
    bcv_rate        numeric,
    paid_bs         numeric,          -- price × bcv_rate
    expected        text,             -- precio esperado, legible ("Bs 2200", "$1.10")
    reason          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    reviewed_at     timestamptz,
    reviewed_by     text
);

CREATE INDEX IF NOT EXISTS sale_price_alerts_location_created_idx
    ON public.sale_price_alerts (location_id, created_at DESC);

COMMENT ON TABLE public.sale_price_alerts IS
    'Ventas cuyo precio no cuadra con el producto (migración 050). Solo informa: la venta se guarda igual.';

-- Regla pura: devuelve NULL si el precio cuadra, o el motivo y lo esperado.
CREATE OR REPLACE FUNCTION public.sale_price_issue(
    p_product_id text,
    p_name       text,
    p_price      numeric,
    p_bcv_rate   numeric,
    p_timestamp  timestamptz,
    OUT reason   text,
    OUT expected text
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    prod     record;
    paid_bs  numeric := CASE WHEN p_bcv_rate > 0 THEN p_price * p_bcv_rate END;
    promo    boolean := extract(isodow FROM coalesce(p_timestamp, now()) AT TIME ZONE 'America/Caracas') IN (2, 3);
    cand     numeric;
BEGIN
    reason := NULL;
    expected := NULL;

    IF p_product_id = 'delivery' THEN
        IF NOT (p_price >= 0 AND p_price <= 50) THEN
            reason := 'delivery_fuera_de_rango'; expected := '$0 a $50';
        END IF;
        RETURN;
    END IF;

    IF p_product_id = 'extra' THEN
        IF NOT (p_price > 0 AND p_price <= 50.01) THEN
            reason := 'extra_fuera_de_rango'; expected := 'más de $0 y hasta $50';
        END IF;
        RETURN;
    END IF;

    SELECT p.category, p.price, p.price_bs, p.cost INTO prod
    FROM public.products p WHERE p.id = p_product_id;
    IF NOT FOUND THEN
        reason := 'producto_desconocido'; expected := 'producto existente';
        RETURN;
    END IF;

    IF p_name LIKE '% · Consumo personal%' THEN
        IF NOT (prod.category = 'pastelitos' AND prod.cost > 0 AND paid_bs IS NOT NULL
                AND abs(paid_bs - prod.cost) <= greatest(prod.cost * 0.01, 1)) THEN
            reason := 'consumo_personal_precio';
            expected := CASE WHEN prod.cost > 0 THEN 'Bs ' || round(prod.cost, 2) ELSE 'solo pastelitos con costo' END;
        END IF;
        RETURN;
    END IF;

    IF p_name LIKE '% · Combo %' THEN
        IF paid_bs IS NOT NULL THEN
            FOREACH cand IN ARRAY ARRAY[
                prod.price_bs,
                CASE WHEN prod.category = 'pastelitos' AND promo THEN 2000 END,
                CASE WHEN p_product_id = 'pastelito_mini' THEN 750 END,
                800, 500, 600, 900
            ] LOOP
                IF cand > 0 AND abs(paid_bs - cand) <= greatest(cand * 0.01, 1) THEN
                    RETURN;
                END IF;
            END LOOP;
        END IF;
        reason := 'combo_precio';
        expected := CASE WHEN prod.price_bs > 0 THEN 'Bs ' || round(prod.price_bs, 2) || ' o precio de combo' ELSE 'precio de combo' END;
        RETURN;
    END IF;

    IF prod.price_bs > 0 AND paid_bs IS NOT NULL
       AND abs(paid_bs - prod.price_bs) <= greatest(prod.price_bs * 0.01, 1) THEN
        RETURN;
    END IF;
    IF abs(p_price - prod.price) <= 0.005 THEN
        RETURN;
    END IF;

    reason := 'precio_distinto';
    expected := CASE WHEN prod.price_bs > 0 THEN 'Bs ' || round(prod.price_bs, 2) ELSE '$' || round(prod.price, 2) END;
END;
$$;

-- Trigger: anota (o borra) la alerta. Nunca hace fallar la venta.
CREATE OR REPLACE FUNCTION public.check_sale_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    chk record;
BEGIN
    BEGIN
        IF NEW.voided_at IS NOT NULL THEN
            DELETE FROM public.sale_price_alerts WHERE sale_uuid = NEW.uuid;
            RETURN NEW;
        END IF;

        SELECT * INTO chk FROM public.sale_price_issue(NEW.product_id, NEW.name, NEW.price, NEW.bcv_rate, NEW."timestamp");

        IF chk.reason IS NULL THEN
            DELETE FROM public.sale_price_alerts WHERE sale_uuid = NEW.uuid;
        ELSE
            INSERT INTO public.sale_price_alerts AS a
                (sale_uuid, location_id, sale_timestamp, product_id, name, price, bcv_rate, paid_bs, expected, reason)
            VALUES
                (NEW.uuid, NEW.location_id, NEW."timestamp", NEW.product_id, NEW.name, NEW.price, NEW.bcv_rate,
                 CASE WHEN NEW.bcv_rate > 0 THEN round(NEW.price * NEW.bcv_rate, 2) END, chk.expected, chk.reason)
            ON CONFLICT (sale_uuid) DO UPDATE SET
                location_id = EXCLUDED.location_id, sale_timestamp = EXCLUDED.sale_timestamp,
                product_id = EXCLUDED.product_id, name = EXCLUDED.name, price = EXCLUDED.price,
                bcv_rate = EXCLUDED.bcv_rate, paid_bs = EXCLUDED.paid_bs, expected = EXCLUDED.expected,
                reason = EXCLUDED.reason, created_at = now(), reviewed_at = NULL, reviewed_by = NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Revisar el precio es secundario: la venta tiene que guardarse siempre.
        RAISE WARNING 'check_sale_price falló para %: %', NEW.uuid, SQLERRM;
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_sale_price ON public.sales;
-- AFTER: los BEFORE INSERT ya llenaron bcv_rate/cost (017, 019).
CREATE TRIGGER trg_check_sale_price
    AFTER INSERT OR UPDATE OF price, product_id, name, bcv_rate, voided_at ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.check_sale_price();

-- Acceso: solo el admin de esa sede las ve y las marca como revisadas.
-- Nadie inserta ni borra desde el cliente: solo el trigger (SECURITY DEFINER).
ALTER TABLE public.sale_price_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_price_alerts FROM anon, authenticated;
GRANT SELECT ON public.sale_price_alerts TO authenticated;
GRANT UPDATE (reviewed_at, reviewed_by) ON public.sale_price_alerts TO authenticated;

DROP POLICY IF EXISTS "Admin ve alertas de precio" ON public.sale_price_alerts;
CREATE POLICY "Admin ve alertas de precio" ON public.sale_price_alerts
    FOR SELECT TO authenticated
    USING (public.get_user_role((select auth.uid())) = 'admin'
           AND location_id = public.get_user_location((select auth.uid())));

DROP POLICY IF EXISTS "Admin marca alertas revisadas" ON public.sale_price_alerts;
CREATE POLICY "Admin marca alertas revisadas" ON public.sale_price_alerts
    FOR UPDATE TO authenticated
    USING (public.get_user_role((select auth.uid())) = 'admin'
           AND location_id = public.get_user_location((select auth.uid())))
    WITH CHECK (public.get_user_role((select auth.uid())) = 'admin'
                AND location_id = public.get_user_location((select auth.uid())));

REVOKE ALL ON FUNCTION public.check_sale_price() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_price_issue(text, text, numeric, numeric, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_price_issue(text, text, numeric, numeric, timestamptz) TO authenticated;

COMMIT;
