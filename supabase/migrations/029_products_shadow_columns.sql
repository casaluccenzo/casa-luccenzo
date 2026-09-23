-- Migration 029: columnas sombra. El trigger de 030 las mantiene; la app las
-- ignora hasta Plan B. Sirven para comparar el calculo nuevo contra el real.
BEGIN;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_computed         integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS initial_stock_computed integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS max_computed           integer;
COMMIT;
