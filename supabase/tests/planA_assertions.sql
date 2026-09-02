-- planA_assertions.sql — correr entero vía execute_sql contra el proyecto DEV
-- (hvwpbhnnfggfdpztdmwo), NUNCA produccion. Cada bloque que pasa no imprime
-- nada; una falla lanza EXCEPTION con prefijo 'planA:'. Al final no debe quedar
-- ninguna fila con id que empiece en 't-', 'm', 'b', 'n'. Las filas
-- 'backfill-*' de stock_movements y las 'seed-*' SI quedan (no son test).

-- ── Task 1: stock_movements ──────────────────────────────────────────────
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='stock_movements') = 9,
         'planA: stock_movements debe tener 9 columnas';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.stock_movements'::regclass),
         'planA: RLS no activo en stock_movements';
  ASSERT (SELECT count(*) FROM pg_policies WHERE tablename='stock_movements') = 2,
         'planA: stock_movements debe tener 2 politicas';
END $$;

-- ── Task 2: day_closes + last_close_at() ─────────────────────────────────
DO $$ BEGIN
  ASSERT public.last_close_at() = '-infinity'::timestamptz,
         'planA: last_close_at() con day_closes vacia debe dar -infinity';
END $$;
-- fechas en julio: ANTES de los movimientos de backfill/seed, para que el
-- trigger recompute-all que dispara insertar en day_closes no toque los
-- productos reales (sus movimientos caen despues de la frontera).
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-1', '2026-07-10T23:00:00Z');
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-2', '2026-07-11T22:00:00Z');
DO $$ BEGIN
  ASSERT public.last_close_at() = '2026-07-11T22:00:00Z'::timestamptz,
         'planA: last_close_at() debe dar el MAX(closed_at)';
END $$;
DELETE FROM public.day_closes WHERE id IN ('t-close-1','t-close-2');
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.products LOOP
    PERFORM public.recompute_product_stock(r.id);
  END LOOP;
END $$;

-- ── Task 3: debt_payments ───────────────────────────────────────────────
INSERT INTO public.debts (uuid, client_name, amount) VALUES ('t-debt-1', 'Test', 100);
INSERT INTO public.debt_payments (id, debt_uuid, amount) VALUES ('t-pay-1', 't-debt-1', 30);
INSERT INTO public.debt_payments (id, debt_uuid, amount) VALUES ('t-pay-2', 't-debt-1', 20);
DO $$
DECLARE saldo numeric;
BEGIN
  SELECT d.amount - COALESCE(SUM(p.amount),0) INTO saldo
    FROM public.debts d LEFT JOIN public.debt_payments p ON p.debt_uuid = d.uuid
   WHERE d.uuid = 't-debt-1' GROUP BY d.amount;
  ASSERT saldo = 50, 'planA: saldo esperado 50, dio ' || saldo;
END $$;
DELETE FROM public.debt_payments WHERE debt_uuid = 't-debt-1';
DELETE FROM public.debts WHERE uuid = 't-debt-1';

-- ── Task 4: columnas de anulacion en sales ──────────────────────────────
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sales'
            AND column_name IN ('voided_at','void_reason')) = 2,
         'planA: faltan columnas de anulacion en sales';
END $$;

-- ── Task 5: columnas sombra en products ─────────────────────────────────
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='products'
            AND column_name LIKE '%_computed') = 3,
         'planA: faltan columnas sombra en products';
END $$;

-- ── Task 6: recompute_product_stock + triggers ─────────────────────────
-- IMPORTANTE: el cierre de prueba se data en 2026-08-01, ANTES de cualquier
-- movimiento de backfill/seed (que estan en "ahora"). Asi el trigger
-- recompute-all que dispara insertar en day_closes no corrompe los productos
-- reales: sus movimientos caen DESPUES de la frontera y se siguen contando.
-- El recompute-all explicito al final es cinturon-y-tiradores.

-- Fase 1: pastelito sin cierre (last_close_at = -infinity)
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-past-1','Test Pastelito',0,2,20,1.5,'pastelitos',0,0.5);
INSERT INTO public.stock_movements (id,product_id,delta,type,created_at) VALUES
  ('m1','t-past-1', 12,'load',       '2026-07-15T10:00:00Z'),
  ('m2','t-past-1', -1,'sale',       '2026-07-15T10:10:00Z'),
  ('m3','t-past-1', -1,'sale',       '2026-07-15T10:20:00Z'),
  ('m4','t-past-1', -2,'count_down', '2026-07-15T10:30:00Z');
DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s,i FROM public.products WHERE id='t-past-1';
  ASSERT s = 8,  'planA 6.3: pastelito stock esperado 8, dio '  || s;
  ASSERT i = 12, 'planA 6.3: pastelito initial esperado 12, dio '|| i;
END $$;
-- Fase 2: el cierre (2026-08-01) resetea el pastelito de prueba (mov. en julio)
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-A', '2026-08-01T20:00:00Z');
DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s,i FROM public.products WHERE id='t-past-1';
  ASSERT s = 0, 'planA 6.4: tras el cierre el pastelito debe dar stock 0, dio ' || s;
  ASSERT i = 0, 'planA 6.4: tras el cierre initial del pastelito debe dar 0, dio ' || i;
END $$;
-- Fase 3: bebida (empaquetado) que cruza el cierre (2026-08-01 20:00)
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-beb-1','Test Bebida',0,1,50,2.0,'bebidas',0,1.0);
INSERT INTO public.stock_movements (id,product_id,delta,type,created_at) VALUES
  ('b1','t-beb-1', 24,'load','2026-08-01T18:00:00Z'),
  ('b2','t-beb-1', -4,'sale','2026-08-01T19:00:00Z'),
  ('b3','t-beb-1', 12,'load','2026-08-01T21:00:00Z'),
  ('b4','t-beb-1', -3,'sale','2026-08-01T21:30:00Z');
DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s,i FROM public.products WHERE id='t-beb-1';
  ASSERT s = 29, 'planA 6.5: bebida stock esperado 29, dio ' || s;
  ASSERT i = 32, 'planA 6.5: bebida initial esperado 32, dio ' || i;
END $$;
DELETE FROM public.stock_movements WHERE product_id IN ('t-past-1','t-beb-1');
DELETE FROM public.day_closes WHERE id = 't-close-A';
DELETE FROM public.products WHERE id IN ('t-past-1','t-beb-1');
-- restaurar estado limpio de los productos reales (day_closes vuelve a vacia)
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.products LOOP
    PERFORM public.recompute_product_stock(r.id);
  END LOOP;
END $$;

-- ── Task 7: v_stock_alerts ─────────────────────────────────────────────
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-neg-1','Test Neg',0,1,10,1,'pastelitos',0,0);
INSERT INTO public.stock_movements (id,product_id,delta,type) VALUES
  ('n1','t-neg-1', 2,'load'),
  ('n2','t-neg-1', -5,'sale');
DO $$
DECLARE f int;
BEGIN
  SELECT faltante INTO f FROM public.v_stock_alerts WHERE product_id='t-neg-1';
  ASSERT f = 3, 'planA 7.2: v_stock_alerts faltante esperado 3, dio ' || COALESCE(f::text,'NULL');
END $$;
DELETE FROM public.stock_movements WHERE product_id='t-neg-1';
DELETE FROM public.products WHERE id='t-neg-1';

-- ── Task 8: backfill — sombra == real para TODOS los productos ─────────
-- (corre DESPUES de aplicar la migracion 032; asume day_closes vacia)
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.products
   WHERE stock_computed IS DISTINCT FROM stock
      OR initial_stock_computed IS DISTINCT FROM initial_stock;
  ASSERT bad = 0, 'planA 8.3: ' || bad || ' productos con sombra != real tras el backfill';
END $$;
