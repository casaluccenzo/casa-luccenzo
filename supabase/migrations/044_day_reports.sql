-- Migration 044: reporte PDF diario de ventas, guardado al cerrar la jornada.
--
-- api/cierre-pdf.js arma el PDF (resumen + un comprobante por cuenta) con las
-- ventas del día en Caracas y lo sube al bucket privado `cierres` como
-- AAAA/MM/AAAA-MM-DD.pdf. Esta tabla es el índice de esos archivos: el POS
-- la lee para listar el historial y el PDF se baja por la API (URL firmada),
-- así que el bucket no necesita políticas para anon.
BEGIN;

CREATE TABLE IF NOT EXISTS public.day_reports (
    report_date   date PRIMARY KEY,
    storage_path  text NOT NULL,
    generated_at  timestamptz NOT NULL DEFAULT now(),
    trigger       text NOT NULL DEFAULT 'cierre' CHECK (trigger IN ('cierre', 'cron', 'manual')),
    accounts      integer NOT NULL DEFAULT 0,
    total_bs      numeric(16,2) NOT NULL DEFAULT 0,
    iva_bs        numeric(16,2) NOT NULL DEFAULT 0,
    expenses_bs   numeric(16,2) NOT NULL DEFAULT 0,
    bcv_rate      numeric(14,4),
    size_bytes    integer
);

ALTER TABLE public.day_reports ENABLE ROW LEVEL SECURITY;

-- Solo lectura para la caja; escribe únicamente la API con service_role.
DROP POLICY IF EXISTS day_reports_read ON public.day_reports;
CREATE POLICY day_reports_read ON public.day_reports
    FOR SELECT TO anon, authenticated USING (true);

-- Supabase ya no da GRANT automático a tablas nuevas (desde 2026-10-30).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.day_reports TO anon, authenticated, service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cierres', 'cierres', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
