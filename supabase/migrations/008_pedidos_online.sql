-- Migration 008: Online orders ("Pedidos Online")
-- Customers submit an order from the public landing page (anon, no login).
-- They can only INSERT -- there is deliberately no SELECT policy for anon/public,
-- so a customer can never read anyone else's name, phone, or order (privacy).
-- Only admin/venta staff can see and manage the queue from /sistema.

CREATE TABLE IF NOT EXISTS public.pedidos_online (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    items jsonb NOT NULL,
    total numeric(10, 2) NOT NULL CHECK (total >= 0),
    payment_method text NOT NULL CHECK (payment_method IN ('Pago Móvil', 'Transferencia')),
    status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'confirmado', 'rechazado')),
    notes text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_pedidos_online_status_created ON public.pedidos_online(status, created_at);

ALTER TABLE public.pedidos_online ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cualquiera puede crear un pedido pendiente" ON public.pedidos_online;
CREATE POLICY "Cualquiera puede crear un pedido pendiente" ON public.pedidos_online
    FOR INSERT TO anon, authenticated
    WITH CHECK (status = 'pendiente');

DROP POLICY IF EXISTS "Admin y venta pueden ver y gestionar pedidos" ON public.pedidos_online;
CREATE POLICY "Admin y venta pueden ver y gestionar pedidos" ON public.pedidos_online
    FOR SELECT TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta'));

DROP POLICY IF EXISTS "Admin y venta pueden actualizar pedidos" ON public.pedidos_online;
CREATE POLICY "Admin y venta pueden actualizar pedidos" ON public.pedidos_online
    FOR UPDATE TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta'))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta'));
