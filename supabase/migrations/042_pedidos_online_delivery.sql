-- Migration 042: datos de entrega en los pedidos web (pedidos_online).
--
-- El cliente ahora elige Delivery o Retiro en el local y, si es delivery,
-- escribe la dirección y un punto de referencia. Todo llega a la pestaña
-- Pedidos del POS. El costo del delivery se cobra aparte (no va en total).
--
-- Son columnas nuevas en una tabla que ya existe, así que heredan los GRANT
-- de pedidos_online y las políticas RLS de siempre (anon solo INSERT).
-- Los pedidos viejos quedan con delivery_method NULL.
BEGIN;

ALTER TABLE public.pedidos_online
    ADD COLUMN IF NOT EXISTS delivery_method text
        CHECK (delivery_method IS NULL OR delivery_method IN ('delivery', 'retiro')),
    ADD COLUMN IF NOT EXISTS delivery_address text
        CHECK (delivery_address IS NULL OR char_length(delivery_address) <= 300),
    ADD COLUMN IF NOT EXISTS delivery_reference text
        CHECK (delivery_reference IS NULL OR char_length(delivery_reference) <= 300);

-- Un delivery sin dirección no sirve: la web la pide, y esto lo asegura.
ALTER TABLE public.pedidos_online DROP CONSTRAINT IF EXISTS pedidos_online_delivery_address_required;
ALTER TABLE public.pedidos_online ADD CONSTRAINT pedidos_online_delivery_address_required
    CHECK (delivery_method IS DISTINCT FROM 'delivery' OR char_length(trim(coalesce(delivery_address, ''))) > 0);

COMMIT;

-- PostgREST: que vea las columnas nuevas sin esperar.
NOTIFY pgrst, 'reload schema';
