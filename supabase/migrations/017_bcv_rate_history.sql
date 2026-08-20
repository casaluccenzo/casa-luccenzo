-- Migration 017: Daily BCV rate history + actually persist sales.bcv_rate
--
-- CONTEXTO
-- js/supabase.js ha estado enviando `bcv_rate` en cada INSERT a `sales` desde
-- hace tiempo (insertSale/insertSales), y el código de reportes (fetchDayReport,
-- groupSalesByClientAccounts, showPosReceiptModal -- ver PR #13) ya lo lee de
-- vuelta esperando encontrarlo. Pero la columna `bcv_rate` nunca existió en la
-- tabla `sales` (solo en `app_config`) -- ninguna migración la creó, alguien
-- debe haber armado esa parte del feature contra un esquema que se planeó pero
-- no se llegó a aplicar. PostgREST/Postgres no fallan cuando el JSON trae una
-- clave que no es columna (jsonb_populate_record simplemente la descarta), así
-- que cada venta grababa su fila SIN tasa, en silencio, sin ningún error visible
-- en ningún lado. Resultado: cada factura o reporte de un día pasado terminaba
-- mostrando la tasa del dólar DE HOY, porque nunca hubo ninguna tasa histórica
-- real guardada para leer.
--
-- Esta migración:
--   1. Crea la columna que debió existir desde el principio, para que las
--      ventas de ahora en adelante sí guarden su tasa real.
--   2. Agrega una red de contención: si por lo que sea el cliente no manda
--      tasa, se completa server-side con la tasa vigente en app_config en vez
--      de quedar en NULL.
--   3. Crea bcv_rate_history: un registro de "la tasa BCV de cada día",
--      independiente de si hubo ventas ese día o no. Se llena solo via trigger
--      cada vez que cambia app_config.bcv_rate (auto-fetch, edición manual, o
--      el bot de WhatsApp/Telegram) -- así ninguna vía futura de actualizar la
--      tasa puede "olvidarse" de dejar el registro.
--
-- LÍMITE: los días anteriores a esta migración nunca tuvieron su tasa
-- guardada en ningún lado (ni en sales, ni en ninguna tabla) -- no hay forma
-- de reconstruirla retroactivamente. Reportes/facturas de ANTES de hoy pueden
-- seguir mostrando la tasa del momento en que se consultan. De hoy en
-- adelante, esto no vuelve a pasar.

BEGIN;

-- 1. La columna que faltaba
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS bcv_rate numeric;

-- 2. Red de contención: completar server-side si el cliente no la mandó
CREATE OR REPLACE FUNCTION public.fill_missing_sale_bcv_rate()
RETURNS trigger AS $$
BEGIN
    IF NEW.bcv_rate IS NULL THEN
        SELECT bcv_rate INTO NEW.bcv_rate FROM public.app_config WHERE id = 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fill_missing_sale_bcv_rate ON public.sales;
CREATE TRIGGER trg_fill_missing_sale_bcv_rate
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.fill_missing_sale_bcv_rate();

-- 3. Registro diario de la tasa BCV
CREATE TABLE IF NOT EXISTS public.bcv_rate_history (
    rate_date date PRIMARY KEY,
    bcv_rate numeric NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bcv_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de bcv_rate_history" ON public.bcv_rate_history;
CREATE POLICY "Lectura de bcv_rate_history" ON public.bcv_rate_history
    FOR SELECT TO authenticated, anon
    USING (true);

-- Sin política de escritura para clientes a propósito: la única vía de
-- escritura es el trigger de abajo (SECURITY DEFINER), así nadie puede
-- corromper el historial insertando/editando filas directamente.

CREATE OR REPLACE FUNCTION public.record_bcv_rate_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.bcv_rate IS NOT NULL THEN
        INSERT INTO public.bcv_rate_history (rate_date, bcv_rate, updated_at)
        VALUES (CURRENT_DATE, NEW.bcv_rate, now())
        ON CONFLICT (rate_date) DO UPDATE
            SET bcv_rate = EXCLUDED.bcv_rate, updated_at = EXCLUDED.updated_at;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_bcv_rate_history ON public.app_config;
CREATE TRIGGER trg_record_bcv_rate_history
AFTER INSERT OR UPDATE OF bcv_rate ON public.app_config
FOR EACH ROW EXECUTE FUNCTION public.record_bcv_rate_history();

-- Bootstrap: dejar ya registrada la tasa de hoy en vez de esperar al próximo
-- cambio de app_config para que el trigger dispare.
INSERT INTO public.bcv_rate_history (rate_date, bcv_rate, updated_at)
SELECT CURRENT_DATE, bcv_rate, now() FROM public.app_config WHERE id = 1
ON CONFLICT (rate_date) DO UPDATE
    SET bcv_rate = EXCLUDED.bcv_rate, updated_at = EXCLUDED.updated_at;

COMMIT;
