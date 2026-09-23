-- Migration 025: stock_movements — registro append-only de movimientos de vitrina
-- Ver spec §5.1a. Dormida en Plan A: nadie inserta todavía.
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
