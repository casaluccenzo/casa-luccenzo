-- Migration 028: anulación de ventas por marca, no por DELETE (spec §5.2).
--
-- Los reportes filtran voided_at IS NULL (lógica cliente = Plan B). Acá solo se
-- agregan las columnas, nulas. Nunca más DELETE de una fila ya sincronizada.

BEGIN;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS voided_at   timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS void_reason text;
CREATE INDEX IF NOT EXISTS idx_sales_active
    ON public.sales (timestamp) WHERE voided_at IS NULL;
COMMIT;
