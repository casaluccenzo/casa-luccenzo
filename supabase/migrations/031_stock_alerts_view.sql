-- Migration 031: alerta de stock negativo para el admin (spec §5.1a).
--
-- El stock puede quedar negativo cuando dos dispositivos venden la última
-- unidad offline (regla de negocio: las ventas nunca se rechazan). Esta vista
-- lista esos casos para que el admin reponga / avise. No bloquea nada.

BEGIN;

CREATE OR REPLACE VIEW public.v_stock_alerts AS
SELECT id AS product_id,
       name,
       stock_computed,
       -stock_computed AS faltante
  FROM public.products
 WHERE stock_computed IS NOT NULL AND stock_computed < 0;

ALTER VIEW public.v_stock_alerts SET (security_invoker = true);
GRANT SELECT ON public.v_stock_alerts TO authenticated;

COMMIT;
