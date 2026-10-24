-- Migration 040: precio fijo en bolívares, opcional por producto.
-- Gustavo quiere cobrar los pastelitos a un monto fijo en Bs (Bs 2.200) sin
-- que nadie toque products.price. La vez anterior (PR #38, revertido en #41)
-- la caja reescribía products.price como 1900 / tasa y pisaba lo que él ponía
-- a mano. Ahora el monto en Bs vive en su propia columna, lo pone él desde
-- "Editar producto", y la caja solo calcula los dólares de cada venta al
-- momento de cobrar (sales.price). products.price queda como respaldo cuando
-- price_bs está vacío.
--
-- Columna nueva en una tabla existente: hereda los GRANT de la tabla, no hace
-- falta repetirlos (el cambio de Supabase del 30/10 solo afecta tablas nuevas).
-- Las cajas con la versión anterior no mandan esta columna en sus upserts, así
-- que no la borran.
BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS price_bs numeric
    CHECK (price_bs IS NULL OR price_bs > 0);

COMMENT ON COLUMN public.products.price_bs IS
    'Precio fijo en bolívares (IVA incluido). NULL = se cobra products.price en dólares.';

COMMIT;
