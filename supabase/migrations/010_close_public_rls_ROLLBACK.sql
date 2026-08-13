-- ROLLBACK for migration 010. NOT part of the migration sequence -- run by hand
-- only if closing the public policies breaks something in production.
--
-- This restores the exact pre-2026-08-12 state: the six wide-open policies come
-- back, and the two DELETE policies return to admin-only. Running it reopens
-- every table to anyone holding the anon key, so it is a "stop the bleeding
-- while we diagnose" tool, not a resting state.
--
-- The `sales` UPDATE policy added by 010 is deliberately NOT dropped here: it
-- closes a genuine gap (markTransactionAsPaid could never have worked without
-- the permissive policy masking it) and keeping it costs nothing on rollback.

BEGIN;

-- Restore the blanket public access exactly as it was.
CREATE POLICY "Acceso publico seguro sales"
    ON public.sales FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Acceso publico seguro products"
    ON public.products FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Acceso publico seguro expenses"
    ON public.expenses FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Acceso publico seguro debts"
    ON public.debts FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Acceso publico seguro replenishments"
    ON public.replenishments FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Acceso publico seguro ingredients"
    ON public.ingredients FOR ALL TO public USING (true) WITH CHECK (true);

-- Return the DELETE policies to their original admin-only form.
DROP POLICY IF EXISTS "Venta y Admin pueden eliminar ventas" ON public.sales;
CREATE POLICY "Solo Admin puede eliminar ventas"
    ON public.sales FOR DELETE TO authenticated
    USING (get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Venta y Admin pueden borrar gastos" ON public.expenses;
CREATE POLICY "Solo Admin puede borrar gastos"
    ON public.expenses FOR DELETE TO authenticated
    USING (get_user_role(auth.uid()) = 'admin');

COMMIT;
