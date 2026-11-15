-- Migration 049: costo del producto en dólares, opcional.
-- Gustavo compra las bebidas en dólares (facturas del proveedor) y quiere
-- poner su costo en $ para que el costo en Bs siga a la tasa del día.
-- Cómo se usa:
--   * cost_usd vacío (NULL)  -> el costo es products.cost en Bs, como siempre.
--   * cost_usd con valor     -> cada venta guarda cost_at_sale = cost_usd × tasa
--     de ESE momento (queda congelado en la venta, los días viejos no cambian).
--     products.cost se sigue llenando con el equivalente en Bs del día en que
--     se guardó, para las pantallas que solo leen Bs.
-- No toca products.price.
--
-- Columna nueva en una tabla existente: hereda los GRANT de la tabla.
BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS cost_usd numeric
    CHECK (cost_usd IS NULL OR cost_usd >= 0);

COMMENT ON COLUMN public.products.cost_usd IS
    'Costo por unidad en dólares (opcional). Si tiene valor, el costo en Bs de cada venta = cost_usd × tasa de la venta.';

COMMIT;
