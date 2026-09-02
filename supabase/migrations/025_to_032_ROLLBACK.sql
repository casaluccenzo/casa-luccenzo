-- ROLLBACK de Plan A (migraciones 025-032).
--
-- Deshace TODO lo que agregó Plan A. Como todo fue aditivo/dormido, revertir es
-- seguro: nada en la app de producción lee las columnas *_computed ni las
-- tablas nuevas hasta Plan B.
--
-- Correr entero. Orden inverso a la aplicación.

BEGIN;

-- 032 + 030: triggers y función de recálculo, y los movimientos de backfill
DROP TRIGGER IF EXISTS trg_day_close_recompute      ON public.day_closes;
DROP TRIGGER IF EXISTS trg_stock_movements_recompute ON public.stock_movements;
DROP FUNCTION IF EXISTS public.tg_day_close_recompute();
DROP FUNCTION IF EXISTS public.tg_stock_movements_recompute();
DROP FUNCTION IF EXISTS public.recompute_product_stock(text);
DELETE FROM public.stock_movements WHERE id LIKE 'backfill-%';

-- 031: vista de alertas
DROP VIEW IF EXISTS public.v_stock_alerts;

-- 029: columnas sombra
ALTER TABLE public.products DROP COLUMN IF EXISTS max_computed;
ALTER TABLE public.products DROP COLUMN IF EXISTS initial_stock_computed;
ALTER TABLE public.products DROP COLUMN IF EXISTS stock_computed;

-- 028: columnas de anulación en sales
DROP INDEX IF EXISTS public.idx_sales_active;
ALTER TABLE public.sales DROP COLUMN IF EXISTS void_reason;
ALTER TABLE public.sales DROP COLUMN IF EXISTS voided_at;

-- 027: debt_payments
DROP TABLE IF EXISTS public.debt_payments;

-- 026: day_closes + last_close_at()
DROP FUNCTION IF EXISTS public.last_close_at();
DROP TABLE IF EXISTS public.day_closes;

-- 025: stock_movements
DROP TABLE IF EXISTS public.stock_movements;

-- Limpiar el tracking de migraciones (ajustar el nombre del esquema si difiere)
DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN (
   -- reemplazar por las versions reales que devuelva apply_migration al aplicar
   -- en prod; en dev fueron 025..032 con timestamps propios
   SELECT version FROM supabase_migrations.schema_migrations
    WHERE name LIKE '025_%' OR name LIKE '026_%' OR name LIKE '027_%'
       OR name LIKE '028_%' OR name LIKE '029_%' OR name LIKE '030_%'
       OR name LIKE '031_%' OR name LIKE '032_%'
 );

COMMIT;
