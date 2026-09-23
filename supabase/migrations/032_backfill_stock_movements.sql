-- Migration 032: backfill. Por producto:
--   - un 'load' con delta = initial_stock actual
--   - si stock < initial_stock: un 'count_down' con delta = stock - initial_stock
-- Con day_closes vacia, last_close_at() = -infinity, asi que TODO movimiento
-- cuenta.
--   stock_computed  = SUM(todos los delta) = initial_stock + (stock - initial_stock) = stock
--   initial_computed (pastelitos)   = SUM(delta type='load') = initial_stock
--   initial_computed (empaquetados) = SUM(delta <= t0) + SUM(load > t0)
--                                   = 0 + initial_stock = initial_stock
-- => sombra == real para ambas categorias.
BEGIN;

INSERT INTO public.stock_movements (id, product_id, delta, type, note, created_at)
SELECT
  'backfill-load-' || p.id,
  p.id,
  GREATEST(p.initial_stock, 0),
  'load',
  'backfill 032: base del dia al momento de la migracion',
  now() - interval '1 second'          -- antes que el count_down
FROM public.products p;

INSERT INTO public.stock_movements (id, product_id, delta, type, note, created_at)
SELECT
  'backfill-cd-' || p.id,
  p.id,
  p.stock - p.initial_stock,           -- negativo
  'count_down',
  'backfill 032: diferencia fisica al momento de la migracion',
  now()
FROM public.products p
WHERE p.stock < p.initial_stock;

COMMIT;
