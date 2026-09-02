-- Migration 027: debt_payments — abonos append-only (spec §5.3).
--
-- La deuda deja de guardar un saldo mutable. Saldo = debts.amount - Σ pagos.
-- Backfill: debt_payments arranca vacía y debts.amount = el remanente actual
-- (los abonos viejos viven en sales como product_id='abono', no re-linkeables).
-- Dormida al aplicarse.

BEGIN;

CREATE TABLE public.debt_payments (
    id          text PRIMARY KEY,
    debt_uuid   text NOT NULL REFERENCES public.debts(uuid) ON DELETE CASCADE,
    amount      numeric NOT NULL CHECK (amount > 0),
    method      text,
    device_id   text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
);

CREATE INDEX idx_debt_payments_debt ON public.debt_payments (debt_uuid, created_at);

ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de debt_payments" ON public.debt_payments;
CREATE POLICY "Lectura de debt_payments" ON public.debt_payments
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Venta y admin registran abonos" ON public.debt_payments;
CREATE POLICY "Venta y admin registran abonos" ON public.debt_payments
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('venta','admin'));

COMMIT;
