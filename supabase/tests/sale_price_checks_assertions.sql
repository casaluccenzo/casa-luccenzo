-- Pruebas de la migración 050 (revisión de precio de ventas).
-- Correr en casa-lucenzo-dev DESPUÉS de aplicar la 050. Todo va dentro de una
-- transacción que se deshace al final: no deja datos.
--   psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sale_price_checks_assertions.sql
BEGIN;

-- Productos de prueba con los mismos precios que producción (nov 2026).
INSERT INTO public.products (id, name, stock, min, max, unit, price, category, price_bs, cost, location_id) VALUES
    ('t_pastel',  'Pastel prueba',  10, 0, 10, 'u', 2.5, 'pastelitos', 2200, 1000, '00000000-0000-0000-0000-000000000001'),
    ('t_mini',    'Mini prueba',    10, 0, 10, 'u', 0.84, 'minis',     750,  0,    '00000000-0000-0000-0000-000000000001'),
    ('t_bebida',  'Malta prueba',   10, 0, 10, 'u', 1.1, 'bebidas',    NULL, 0,    '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE casos (uuid text, product_id text, name text, price numeric, bcv_rate numeric, ts timestamptz, espera text);
INSERT INTO casos VALUES
 -- precio en Bs exacto y con la tasa un poco corrida (0.14%)
 ('t1', 't_pastel', 'Pastel prueba', 2200/916.6477, 916.6477, '2026-11-18 15:00-04', NULL),
 ('t2', 't_pastel', 'Pastel prueba', 2.458409, 896.1225, '2026-11-05 15:00-04', NULL),
 -- precio en $ (producto sin price_bs)
 ('t3', 't_bebida', 'Malta prueba', 1.1, 916.6477, '2026-11-18 15:00-04', NULL),
 -- cobrado a la mitad
 ('t4', 't_pastel', 'Pastel prueba', 1.2, 916.6477, '2026-11-18 15:00-04', 'precio_distinto'),
 ('t5', 't_bebida', 'Malta prueba', 0.5, 916.6477, '2026-11-18 15:00-04', 'precio_distinto'),
 -- consumo del personal al costo (Bs 1000) y por debajo
 ('t6', 't_pastel', 'Pastel prueba · Consumo personal [X]', 1000/916.6477, 916.6477, '2026-11-18 15:00-04', NULL),
 ('t7', 't_pastel', 'Pastel prueba · Consumo personal [X]', 0.5, 916.6477, '2026-11-18 15:00-04', 'consumo_personal_precio'),
 ('t8', 't_bebida', 'Malta prueba · Consumo personal [X]', 0.5, 916.6477, '2026-11-18 15:00-04', 'consumo_personal_precio'),
 -- combo: promo Bs 2000 solo martes/miércoles (18/11/2026 es miércoles, 20/11 viernes)
 ('t9',  't_pastel', 'Pastel prueba · Combo Clásico', 2000/916.6477, 916.6477, '2026-11-18 15:00-04', NULL),
 ('t10', 't_pastel', 'Pastel prueba · Combo Clásico', 2000/916.6477, 916.6477, '2026-11-20 15:00-04', 'combo_precio'),
 ('t11', 't_mini',   'Mini prueba · Combo Mini', 750/916.6477, 916.6477, '2026-11-20 15:00-04', NULL),
 ('t12', 't_bebida', 'Malta prueba · Combo Clásico', 800/916.6477, 916.6477, '2026-11-20 15:00-04', NULL),
 ('t13', 't_bebida', 'Malta prueba · Combo Clásico', 100/916.6477, 916.6477, '2026-11-20 15:00-04', 'combo_precio'),
 -- delivery y extras
 ('t14', 'delivery', 'Delivery', 3.5, 916.6477, '2026-11-18 15:00-04', NULL),
 ('t15', 'delivery', 'Delivery', 80, 916.6477, '2026-11-18 15:00-04', 'delivery_fuera_de_rango'),
 ('t16', 'extra', 'Jugo', 1800/916.6477, 916.6477, '2026-11-18 15:00-04', NULL),
 ('t17', 'extra', 'Jugo', 0, 916.6477, '2026-11-18 15:00-04', 'extra_fuera_de_rango'),
 -- producto que no existe
 ('t18', 'no_existe', 'Fantasma', 1, 916.6477, '2026-11-18 15:00-04', 'producto_desconocido');

INSERT INTO public.sales (uuid, product_id, name, price, bcv_rate, "timestamp")
SELECT 'test-050-' || uuid, product_id, name, price, bcv_rate, ts FROM casos;

DO $$
DECLARE r record; malos int := 0;
BEGIN
    FOR r IN
        SELECT c.uuid, c.espera, a.reason
        FROM casos c LEFT JOIN public.sale_price_alerts a ON a.sale_uuid = 'test-050-' || c.uuid
    LOOP
        IF r.espera IS DISTINCT FROM r.reason THEN
            malos := malos + 1;
            RAISE WARNING 'caso %: esperaba %, quedó %', r.uuid, coalesce(r.espera, 'sin alerta'), coalesce(r.reason, 'sin alerta');
        END IF;
    END LOOP;
    IF malos > 0 THEN RAISE EXCEPTION '% casos fallaron', malos; END IF;
END $$;

-- Corregir el precio borra la alerta; anular la venta también.
UPDATE public.sales SET price = 2200/916.6477 WHERE uuid = 'test-050-t4';
UPDATE public.sales SET voided_at = now(), void_reason = 'prueba' WHERE uuid = 'test-050-t5';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.sale_price_alerts WHERE sale_uuid IN ('test-050-t4', 'test-050-t5')) THEN
        RAISE EXCEPTION 'corregir/anular no borró la alerta';
    END IF;
END $$;

-- Si la revisión falla por dentro, la venta se guarda igual.
ALTER TABLE public.sale_price_alerts RENAME TO sale_price_alerts_tmp;
INSERT INTO public.sales (uuid, product_id, name, price, bcv_rate) VALUES ('test-050-robusta', 't_pastel', 'Pastel prueba', 0.1, 900);
ALTER TABLE public.sale_price_alerts_tmp RENAME TO sale_price_alerts;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sales WHERE uuid = 'test-050-robusta') THEN
        RAISE EXCEPTION 'la venta no se guardó cuando falló la revisión';
    END IF;
END $$;

SELECT 'sale_price_checks: OK' AS resultado;
ROLLBACK;
