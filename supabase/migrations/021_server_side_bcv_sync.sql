-- Migration 021: Sincronización de la tasa BCV del lado del servidor (siempre activa)
--
-- CONTEXTO
-- Hasta ahora la única forma de mantener app_config.bcv_rate al día era que
-- ALGÚN dispositivo tuviera el POS abierto: el navegador consultaba
-- rates.dolarvzla.com / ve.dolarapi.com y escribía el resultado. Si nadie
-- abría la app, la tasa se congelaba. Además el cierre de jornada llamaba a
-- upsertAppConfig({lastCloseTime}) y, por un bug en esa función, pisaba
-- bcv_rate con el fallback 732.48 y apagaba use_auto_bcv. Eso pasó el
-- 2026-09-01 (cierre 23:43 UTC): 794.99 -> 732.48.
--
-- Esta migración mueve la actualización de la tasa al servidor:
--   1. Extensiones http + pg_cron.
--   2. bcv_sync_log: registro auditable de cada intento.
--   3. sync_bcv_rate(): consulta los dos proveedores, toma el mayor válido y
--      sano, y si difiere del vigente actualiza app_config. Siempre deja
--      registro. El trigger record_bcv_rate_history (017) propaga a
--      bcv_rate_history solo.
--   4. Guard BEFORE UPDATE en app_config: un bcv_rate NULL o <= 0 nunca pisa
--      el valor bueno.
--   5. Cron cada hora.
--
-- El navegador sigue LEYENDO app_config.bcv_rate como siempre; ya no necesita
-- escribirlo.

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Log de sincronización -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bcv_sync_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ran_at       timestamptz NOT NULL DEFAULT now(),
    dolarvzla    numeric,
    dolarapi     numeric,
    chosen_rate  numeric,
    applied      boolean NOT NULL DEFAULT false,
    note         text
);

ALTER TABLE public.bcv_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de bcv_sync_log" ON public.bcv_sync_log;
CREATE POLICY "Lectura de bcv_sync_log" ON public.bcv_sync_log
    FOR SELECT TO authenticated
    USING (true);
-- Sin política de escritura: solo la función SECURITY DEFINER escribe.

-- 3. Guard: un bcv_rate inválido nunca pisa el vigente -------------------
CREATE OR REPLACE FUNCTION public.guard_app_config_bcv_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.bcv_rate IS NULL OR NEW.bcv_rate <= 0 THEN
        NEW.bcv_rate := OLD.bcv_rate;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_app_config_bcv_rate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_app_config_bcv_rate ON public.app_config;
CREATE TRIGGER trg_guard_app_config_bcv_rate
BEFORE UPDATE OF bcv_rate ON public.app_config
FOR EACH ROW EXECUTE FUNCTION public.guard_app_config_bcv_rate();

-- 4. Función de sincronización ------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_bcv_rate()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_vzla    numeric := NULL;
    v_api     numeric := NULL;
    v_chosen  numeric := NULL;
    v_current numeric;
    v_note    text := '';
    v_applied boolean := false;
BEGIN
    PERFORM http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');

    -- Proveedor 1: DolarVZLA (tasa oficial, valor del próximo día hábil)
    BEGIN
        SELECT (content::jsonb -> 'current' ->> 'usd')::numeric
          INTO v_vzla
          FROM http_get('https://rates.dolarvzla.com/bcv/current.json');
    EXCEPTION WHEN OTHERS THEN
        v_note := v_note || 'dolarvzla:' || SQLERRM || '; ';
        v_vzla := NULL;
    END;

    -- Proveedor 2: DolarAPI Venezuela
    BEGIN
        SELECT COALESCE(
                   content::jsonb ->> 'promedio',
                   content::jsonb ->> 'monto',
                   content::jsonb ->> 'precio'
               )::numeric
          INTO v_api
          FROM http_get('https://ve.dolarapi.com/v1/dolares/oficial');
    EXCEPTION WHEN OTHERS THEN
        v_note := v_note || 'dolarapi:' || SQLERRM || '; ';
        v_api := NULL;
    END;

    -- Mayor válido de los dos (misma regla que el cliente)
    v_chosen := GREATEST(COALESCE(v_vzla, 0), COALESCE(v_api, 0));
    IF v_chosen <= 0 THEN
        v_chosen := NULL;
    END IF;

    -- Banda de sanidad: descarta parseos raros / respuestas corruptas
    IF v_chosen IS NOT NULL AND (v_chosen < 100 OR v_chosen > 20000) THEN
        v_note := v_note || 'fuera-de-banda:' || v_chosen || '; ';
        v_chosen := NULL;
    END IF;

    SELECT bcv_rate INTO v_current FROM public.app_config WHERE id = 1;

    IF v_chosen IS NOT NULL AND v_chosen IS DISTINCT FROM v_current THEN
        UPDATE public.app_config
           SET bcv_rate     = v_chosen,
               use_auto_bcv = true,
               updated_at   = now()
         WHERE id = 1;
        v_applied := true;
        v_note := v_note || 'aplicado ' || COALESCE(v_current::text, 'null') || ' -> ' || v_chosen;
    ELSIF v_chosen IS NOT NULL THEN
        v_note := v_note || 'sin cambios (' || v_chosen || ')';
    ELSE
        v_note := COALESCE(NULLIF(v_note, ''), 'ambos proveedores fallaron');
    END IF;

    INSERT INTO public.bcv_sync_log (dolarvzla, dolarapi, chosen_rate, applied, note)
    VALUES (v_vzla, v_api, v_chosen, v_applied, left(v_note, 500));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_bcv_rate() FROM PUBLIC, anon, authenticated;

-- 5. Cron: cada hora a los :07 (UTC) ----------------------------------
SELECT cron.schedule('sync-bcv-rate', '7 * * * *', $$SELECT public.sync_bcv_rate()$$);

-- ---------------------------------------------------------------------
-- Corrección de datos post-incidente (ejecutar una vez):
--   SELECT public.sync_bcv_rate();                    -- fija app_config con la tasa viva
--   UPDATE public.bcv_rate_history SET bcv_rate = 798.326, updated_at = now()
--     WHERE rate_date = '2026-09-01';                 -- tasa oficial real de ese día
