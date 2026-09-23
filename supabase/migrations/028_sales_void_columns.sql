-- Migration 028: anulacion de ventas por marca, no por DELETE (spec §5.2).
BEGIN;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS voided_at   timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS void_reason text;
CREATE INDEX IF NOT EXISTS idx_sales_active
    ON public.sales (timestamp) WHERE voided_at IS NULL;
COMMIT;
