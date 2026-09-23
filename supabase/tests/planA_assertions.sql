-- planA_assertions.sql — suite de aserciones de Plan A (offline-first POS)
-- Se corre a mano vía execute_sql contra el proyecto dev (casa-lucenzo-dev),
-- NUNCA contra producción (xttpaqokeyywjaajvjyu). No es una migración.
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
-- literales '2026-09-02T21:00:00Z' (la fecha en que se escribió el plan).
-- Acá se usan timestamps relativos a now() en su lugar, para que el test siga
-- siendo válido corra cuando corra -- lo único que importa es el orden real
-- (antes/después de t-close-A), no la fecha absoluta. Por eso este bloque se
-- corre en 4 pasos separados (no todo en una sola transacción): cada uno debe
-- ver un now() que ya avanzó respecto al paso anterior.
-- ---------------------------------------------------------------------------

-- Paso A: pastelito, un día sin cierre.
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

-- Paso B: el cierre resetea el pastelito (correr después de A, en un execute_sql aparte).
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-A', now());
DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s, i
    FROM public.products WHERE id='t-past-1';
  ASSERT s = 0, 'planA: tras el cierre el pastelito debe dar stock 0, dio ' || s;
  ASSERT i = 0, 'planA: tras el cierre initial del pastelito debe dar 0, dio ' || i;
END $$;

-- Paso C: bebida (empaquetado), movimientos ANTES del cierre (correr después de B).
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-beb-1','Test Bebida',0,1,50,2.0,'bebidas',0,1.0);

INSERT INTO public.stock_movements (id,product_id,delta,type,created_at) VALUES
  ('b1','t-beb-1', 24,'load', now() - interval '2 hours'),
  ('b2','t-beb-1', -4,'sale', now() - interval '90 minutes');

-- Paso D: movimientos DESPUÉS del cierre (correr después de C, en un execute_sql
-- aparte -- el now() de este paso ya es posterior a closed_at del paso B).
INSERT INTO public.stock_movements (id,product_id,delta,type,created_at) VALUES
  ('b3','t-beb-1', 12,'load', now()),
  ('b4','t-beb-1', -3,'sale', now());

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
