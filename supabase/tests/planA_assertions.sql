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
