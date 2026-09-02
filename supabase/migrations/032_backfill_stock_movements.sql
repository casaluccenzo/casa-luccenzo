-- Migration 032: backfill de stock_movements.
--
-- Por cada producto, para que recompute_product_stock deje stock_computed =
-- stock e initial_stock_computed = initial_stock (spec §5.1a "Backfill"):
--   - un 'load' con delta = initial_stock actual
--   - si stock < initial_stock: un 'count_down' con delta = stock - initial_stock
--
-- Con day_closes vacía, last_close_at() = -infinity, así que TODO movimiento
-- cuenta:
--   stock_computed  = Σ(todos los delta) = initial_stock + (stock - initial_stock) = stock
--   initial_computed (pastelitos)   = Σ(delta type='load') = initial_stock
--   initial_computed (empaquetados) = Σ(delta <= t0) + Σ(load > t0)
--                                   = 0 + initial_stock = initial_stock
-- => sombra == real para ambas categorías.
--
-- PRECONDICION: day_closes debe estar vacía al correr esta migración. En
-- produccion lo está (day_closes es una tabla nueva de la migración 026).

BEGIN;

INSERT INTO public.stock_movements (id, product_id, delta, type, note, created_at)
SELECT
  'backfill-load-' || p.id,
  p.id,
  GREATEST(p.initial_stock, 0),
  'load',
  'backfill 032: base del dia al momento de la migracion',
  now() - interval '1 second'
FROM public.products p;

INSERT INTO public.stock_movements (id, product_id, delta, type, note, created_at)
SELECT
  'backfill-cd-' || p.id,
  p.id,
  p.stock - p.initial_stock,
  'count_down',
  'backfill 032: diferencia fisica al momento de la migracion',
  now()
FROM public.products p
WHERE p.stock < p.initial_stock;

COMMIT;
