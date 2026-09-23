-- planA_assertions.sql — correr entero vía execute_sql contra la RAMA de
-- desarrollo (casa-lucenzo-dev, NO producción / xttpaqokeyywjaajvjyu). No es
-- una migración. Cada bloque que pasa no imprime nada; una falla lanza
-- EXCEPTION con prefijo 'planA:'. Al final no debe quedar ninguna fila con id
-- que empiece en 't-', 'm', 'b', 'n' (las 'backfill-*' de stock_movements SÍ
-- quedan -- son el backfill real de la Task 8, no basura de test).
-- Ver docs/superpowers/plans/2026-09-02-offline-first-pos-plan-A-postgres.md

-- ---------------------------------------------------------------------------
-- Task 1: stock_movements
-- ---------------------------------------------------------------------------

-- Step 1: aserción previa a la migración 025 (ya corrida y verificada -- la
-- tabla no existía). Se deja documentada por completitud; no es re-ejecutable
-- tal cual una vez aplicada 025 (fallaría a propósito).
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM information_schema.tables
--              WHERE table_schema='public' AND table_name='stock_movements') THEN
--     RAISE EXCEPTION 'planA: stock_movements ya existe antes de la migracion 025';
--   END IF;
-- END $$;

-- Step 4: aserciones de estructura, posteriores a 025.
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='stock_movements') = 9,
         'planA: stock_movements debe tener 9 columnas';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.stock_movements'::regclass),
         'planA: RLS no activo en stock_movements';
  ASSERT (SELECT count(*) FROM pg_policies WHERE tablename='stock_movements') = 2,
         'planA: stock_movements debe tener 2 politicas';
END $$;

-- ---------------------------------------------------------------------------
-- Task 2: day_closes + last_close_at()
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ASSERT public.last_close_at() = '-infinity'::timestamptz,
         'planA: last_close_at() con day_closes vacia debe dar -infinity';
END $$;

-- Filas sintéticas: insertar, verificar el MAX, y limpiar -- válido solo en
-- el proyecto dev de test; en producción day_closes es append-only.
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-1', '2026-09-01T23:00:00Z');
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-2', '2026-09-02T22:00:00Z');
DO $$ BEGIN
  ASSERT public.last_close_at() = '2026-09-02T22:00:00Z'::timestamptz,
         'planA: last_close_at() debe dar el MAX(closed_at)';
END $$;
DELETE FROM public.day_closes WHERE id IN ('t-close-1','t-close-2');

-- El trigger de day_closes recalcula TODOS los productos por statement (no
-- solo los de prueba) -- incluye los productos reales sembrados en Task 0 /
-- ya backfillados en Task 8. El DELETE de arriba no dispara recálculo (no hay
-- trigger AFTER DELETE), así que sus columnas sombra quedan pisadas con el
-- resultado de la frontera de prueba. Se restauran acá para no romper la
-- aserción sombra==real de la Task 8, más adelante en este mismo archivo.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.products LOOP
    PERFORM public.recompute_product_stock(r.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Task 3: debt_payments
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Task 4: sales.voided_at / void_reason
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sales'
            AND column_name IN ('voided_at','void_reason')) = 2,
         'planA: faltan columnas de anulacion en sales';
END $$;

-- ---------------------------------------------------------------------------
-- Task 5: columnas sombra en products
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='products'
            AND column_name LIKE '%_computed') = 3,
         'planA: faltan columnas sombra en products';
END $$;

-- ---------------------------------------------------------------------------
-- Task 6: recompute_product_stock() + triggers
--
-- NOTA: el plan original fechaba los movimientos "despues del cierre" con
-- literales '2026-09-02T21:00:00Z' (la fecha en que se escribió el plan, ya
-- en el pasado para cualquier corrida futura). Acá se usan offsets relativos
-- a now() para "antes" (now() - interval) y "despues" (now() + interval) del
-- cierre en vez de fechas absolutas o de confiar en que el reloj real avance
-- entre statements -- dentro de una sola transacción (p.ej. todo este archivo
-- pegado de una vez en execute_sql) now() es constante, así que "despues"
-- tiene que forzarse con +interval, no alcanza con volver a llamar now().
-- ---------------------------------------------------------------------------

INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-past-1','Test Pastelito',0,2,20,1.5,'pastelitos',0,0.5);

INSERT INTO public.stock_movements (id,product_id,delta,type) VALUES
  ('m1','t-past-1', 12,'load'),
  ('m2','t-past-1', -1,'sale'),
  ('m3','t-past-1', -1,'sale'),
  ('m4','t-past-1', -2,'count_down');

DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s, i
    FROM public.products WHERE id='t-past-1';
  ASSERT s = 8,  'planA: pastelito stock_computed esperado 8, dio ' || s;
  ASSERT i = 12, 'planA: pastelito initial_stock_computed esperado 12, dio ' || i;
END $$;

-- El cierre resetea el pastelito.
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-A', now());
DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s, i
    FROM public.products WHERE id='t-past-1';
  ASSERT s = 0, 'planA: tras el cierre el pastelito debe dar stock 0, dio ' || s;
  ASSERT i = 0, 'planA: tras el cierre initial del pastelito debe dar 0, dio ' || i;
END $$;

-- Bebida (empaquetado): movimientos antes Y despues del cierre, ambos con
-- offset explícito respecto al mismo now() de esta transacción.
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-beb-1','Test Bebida',0,1,50,2.0,'bebidas',0,1.0);

INSERT INTO public.stock_movements (id,product_id,delta,type,created_at) VALUES
  ('b1','t-beb-1', 24,'load', now() - interval '2 hours'),
  ('b2','t-beb-1', -4,'sale', now() - interval '90 minutes'),
  ('b3','t-beb-1', 12,'load', now() + interval '1 minute'),
  ('b4','t-beb-1', -3,'sale', now() + interval '2 minutes');

DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s, i
    FROM public.products WHERE id='t-beb-1';
  ASSERT s = 29, 'planA: bebida stock_computed esperado 29, dio ' || s;
  ASSERT i = 32, 'planA: bebida initial esperado 32, dio ' || i;
END $$;

-- Limpieza
DELETE FROM public.stock_movements WHERE product_id IN ('t-past-1','t-beb-1');
DELETE FROM public.day_closes WHERE id = 't-close-A';
DELETE FROM public.products WHERE id IN ('t-past-1','t-beb-1');

-- Mismo motivo que en la Task 2: t-close-A recalculó TODOS los productos
-- (incluye los reales, ya backfillados) con su propia frontera de prueba, y
-- el DELETE de arriba no lo deshace. Restaurar antes de seguir.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.products LOOP
    PERFORM public.recompute_product_stock(r.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Task 7: v_stock_alerts
-- ---------------------------------------------------------------------------

INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-neg-1','Test Neg',0,1,10,1,'pastelitos',0,0);
INSERT INTO public.stock_movements (id,product_id,delta,type) VALUES
  ('n1','t-neg-1', 2,'load'),
  ('n2','t-neg-1', -5,'sale');   -- vendio 5, habia 2 -> -3
DO $$
DECLARE f int;
BEGIN
  SELECT faltante INTO f FROM public.v_stock_alerts WHERE product_id='t-neg-1';
  ASSERT f = 3, 'planA: v_stock_alerts faltante esperado 3, dio ' || COALESCE(f::text,'NULL');
END $$;
DELETE FROM public.stock_movements WHERE product_id='t-neg-1';
DELETE FROM public.products WHERE id='t-neg-1';

-- ---------------------------------------------------------------------------
-- Task 8: backfill — sombra == real para TODOS los productos
-- ---------------------------------------------------------------------------

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.products
   WHERE stock_computed IS DISTINCT FROM stock
      OR initial_stock_computed IS DISTINCT FROM initial_stock;
  ASSERT bad = 0,
    'planA: ' || bad || ' productos con sombra != real tras el backfill';
END $$;
