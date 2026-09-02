-- Migration 029: columnas sombra en products.
--
-- El trigger de la migración 030 las mantiene calculadas desde stock_movements.
-- La app NO las lee hasta Plan B; sirven para comparar el cálculo nuevo contra
-- el valor real (stock / initial_stock) durante el modo sombra (spec §10).

BEGIN;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_computed         integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS initial_stock_computed integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS max_computed           integer;
COMMIT;
