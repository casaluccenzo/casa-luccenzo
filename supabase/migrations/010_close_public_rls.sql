-- Migration 010: Close the wide-open "Acceso publico seguro" policies
--
-- Six tables carried a hand-added dashboard policy granting cmd=ALL to the
-- `public` role with USING(true) / WITH CHECK(true). Postgres OR's policies
-- together, so these fully overrode the role-scoped policies from 001/002:
-- anyone who read the anon key out of the public page source could read,
-- modify or delete every sale, price, expense, debt and inventory row.
--
-- Dropping them alone would have broken production, because the role-scoped
-- set has real gaps that the permissive policy was masking. Those gaps are
-- closed first, in the same transaction, so there is never a window where the
-- POS is missing a permission it needs.
--
-- Gaps found by tracing the actual call sites (2026-08-12):
--   1. `sales` had NO UPDATE policy at all, yet markTransactionAsPaid()
--      upserts sales rows to tag them "(Pagado - <método>)". Registering a
--      payment -- the most-used action of the day -- would have failed.
--   2. `sales` DELETE and `expenses` DELETE were admin-only, but the vendedora
--      (role `venta`) has Deshacer / Corregir on her own screen and has been
--      using them all along through the permissive policy. Owner confirmed
--      she keeps both.
--   3. `sales` has no anon SELECT, which the nightly WhatsApp cron relied on.
--      Fixed on the application side by pointing api/sales-monitor.js at
--      SUPABASE_SERVICE_ROLE_KEY, not by reopening the table.
--
-- Deliberately NOT widened, having traced the writers: `expenses` needs no
-- UPDATE (only insert/delete exist, offline replay included), and `ingredients`
-- stays admin+cocina (its only writers are deliverProduct from Cocina and the
-- admin factory reset -- renderIngredientsPantry is a no-op, so the pantry
-- screen the `venta` role would have used no longer renders).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Close the gaps the permissive policies were hiding
-- ---------------------------------------------------------------------------

-- Registering a collection rewrites the sale's name, so venta/admin need UPDATE.
DROP POLICY IF EXISTS "Venta y Admin pueden actualizar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden actualizar ventas"
    ON public.sales FOR UPDATE TO authenticated
    USING (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'venta']))
    WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'venta']));

-- Deshacer / Corregir a mis-rung sale is a cashier action, not an admin one.
DROP POLICY IF EXISTS "Solo Admin puede eliminar ventas" ON public.sales;
DROP POLICY IF EXISTS "Venta y Admin pueden eliminar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden eliminar ventas"
    ON public.sales FOR DELETE TO authenticated
    USING (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'venta']));

-- Same reasoning for a mistyped expense.
DROP POLICY IF EXISTS "Solo Admin puede borrar gastos" ON public.expenses;
DROP POLICY IF EXISTS "Venta y Admin pueden borrar gastos" ON public.expenses;
CREATE POLICY "Venta y Admin pueden borrar gastos"
    ON public.expenses FOR DELETE TO authenticated
    USING (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'venta']));

-- ---------------------------------------------------------------------------
-- 2. Now remove the blanket public access
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Acceso publico seguro sales"          ON public.sales;
DROP POLICY IF EXISTS "Acceso publico seguro products"       ON public.products;
DROP POLICY IF EXISTS "Acceso publico seguro expenses"       ON public.expenses;
DROP POLICY IF EXISTS "Acceso publico seguro debts"          ON public.debts;
DROP POLICY IF EXISTS "Acceso publico seguro replenishments" ON public.replenishments;
DROP POLICY IF EXISTS "Acceso publico seguro ingredients"    ON public.ingredients;

COMMIT;
