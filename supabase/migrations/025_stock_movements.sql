-- Migration 025: stock_movements — registro append-only de movimientos de vitrina
--
-- Ver spec 2026-09-02-offline-first-pos-design.md §5.1a. Dormida al aplicarse:
-- ningún código inserta todavía. El frontend que escribe movimientos es Plan B.
--
-- type:
--   load        — entra a la vitrina (carga de cocina, recuento hacia arriba). delta > 0. Sube la base del día.
--   sale        — una unidad cobrada. delta = -1. source_uuid = sales.uuid. No sube la base.
--   sale_return — se sacó del carrito o se anuló una venta. delta = +1. No sube la base.
--   count_down  — recuento físico hacia abajo. delta < 0. No sube la base (alimenta Conciliación).
--   open_carry  — al cerrar, para bebidas/dulces: marca de frontera. delta = 0.

BEGIN;

CREATE TABLE public.stock_movements (
    id          text PRIMARY KEY,
    product_id  text NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    delta       integer NOT NULL,
    type        text NOT NULL CHECK (type IN
                  ('load','sale','sale_return','count_down','open_carry')),
    source_uuid text,
    device_id   text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    note        text
);

CREATE INDEX idx_stock_movements_product_created
    ON public.stock_movements (product_id, created_at);
CREATE INDEX idx_stock_movements_source
    ON public.stock_movements (source_uuid) WHERE source_uuid IS NOT NULL;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de stock_movements" ON public.stock_movements;
CREATE POLICY "Lectura de stock_movements" ON public.stock_movements
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Venta y cocina y admin insertan movimientos" ON public.stock_movements;
CREATE POLICY "Venta y cocina y admin insertan movimientos" ON public.stock_movements
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('venta','cocina','admin'));

-- Sin UPDATE ni DELETE: es append-only. Correcciones = un movimiento nuevo.

COMMIT;
