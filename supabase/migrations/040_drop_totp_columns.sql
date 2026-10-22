-- Migration 040: quitar las columnas TOTP de app_config (reemplaza a la 015).
--
-- app_config se puede leer con la clave pública: la política "Lectura de
-- app_config" (SELECT a {anon,authenticated} USING true) existe porque el
-- menú web y la pantalla de bloqueo leen bcv_rate antes de que alguien inicie
-- sesión, y el keepalive la usa como ping. Esa política es por fila, así que
-- expone TODAS las columnas, incluida totp_secret.
--
-- Verificado en producción el 2026-10-22 (solo lectura): totp_secret está
-- vacío (largo 0) y totp_enabled = false, igual que el 2026-08-14 cuando se
-- escribió la 015. Nunca se guardó un secreto real, así que no se filtró
-- nada. Ningún código lee ni escribe totp_secret (búsqueda en js/, api/,
-- lib/), y totp_enabled solo se convertía a booleano en mapAppConfigRow sin
-- que nadie lo usara.
--
-- Se borran las columnas en vez de un REVOKE por columna porque
-- fetchAppConfig() hace select('*'): con un GRANT por columna, PostgREST
-- expandiría '*' a totp_secret y la lectura anónima fallaría por permisos.
-- Si algún día se activa 2FA, el secreto debe ir en una tabla propia sin
-- acceso para anon.
--
-- PowerSync: la regla de sync es SELECT * FROM app_config, así que deja de
-- mandar estas columnas sin tocar nada más.
--
-- La 015 nunca se aplicó; esta la reemplaza con una guarda: si alguien llegó
-- a guardar un secreto o activar 2FA, la migración se detiene y no borra nada.

BEGIN;

DO $$
BEGIN
    -- IF anidado: si la columna ya no existe, la consulta de adentro ni se
    -- prepara (en un solo IF con AND fallaría por columna inexistente).
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_config'
          AND column_name = 'totp_secret'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM public.app_config
            WHERE coalesce(totp_secret, '') <> '' OR totp_enabled IS TRUE
        ) THEN
            RAISE EXCEPTION 'app_config tiene un secreto TOTP o 2FA activo; revisar antes de borrar';
        END IF;
    END IF;
END $$;

ALTER TABLE public.app_config DROP COLUMN IF EXISTS totp_secret;
ALTER TABLE public.app_config DROP COLUMN IF EXISTS totp_enabled;

COMMIT;
