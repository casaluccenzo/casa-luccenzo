-- Migration 019: Per-product production cost + cost snapshot on sale
--
-- CONTEXTO
-- Casa Lucenzo le paga un costo fijo en bolívares a un tercero por cada torta
-- que produce (hoy: 800 Bs/unidad). No existía ningún campo para registrar
-- ese costo, así que el margen real por venta era imposible de calcular.
--
-- Mismo riesgo que ya mordió con bcv_rate (ver 017_bcv_rate_history.sql): si
-- el costo se lee "en vivo" desde products.cost al armar un reporte, un
-- reporte de un día pasado queda mal en cuanto el costo actual cambia. Por
-- eso sales.cost_at_sale congela el costo vigente al momento de la venta,
-- igual que sales.bcv_rate congela la tasa.
--
-- products.cost es genérico (no exclusivo de tortas): aplica a cualquier
-- producto por si en el futuro se terceriza el costo de otros ítems.

BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost numeric NOT NULL DEFAULT 0;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cost_at_sale numeric;

-- Red de contención: si el cliente no manda cost_at_sale (o el producto fue
-- borrado/renombrado luego), completar server-side desde el costo actual del
-- producto. Igual patrón que fill_missing_sale_bcv_rate.
CREATE OR REPLACE FUNCTION public.fill_missing_sale_cost()
RETURNS trigger AS $$
BEGIN
    IF NEW.cost_at_sale IS NULL THEN
        SELECT cost INTO NEW.cost_at_sale FROM public.products WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fill_missing_sale_cost ON public.sales;
CREATE TRIGGER trg_fill_missing_sale_cost
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.fill_missing_sale_cost();

COMMIT;
