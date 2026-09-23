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
