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
