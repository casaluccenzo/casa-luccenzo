-- Migration 015: Drop the unused TOTP columns from app_config
--
-- NOT APPLIED YET -- ON PURPOSE. Deliberately held back from the v284 batch
-- (2026-08-14, the night before reopening): this is an irreversible schema
-- change whose benefit today is exactly zero, so there is no reason for it to
-- share a window with fixes that do need to ship. Apply it on a calm day.
--
-- WHY IT EXISTS
--
-- `app_config` is readable by `anon` ("Lectura de app_config", SELECT to
-- {anon,authenticated} USING true) because the keepalive cron pings it with
-- the publishable key. That policy is row-level, so it exposes every column,
-- including `totp_secret`.
--
-- Right now that leaks nothing: verified against production on 2026-08-14,
-- `totp_secret` is the empty string and `totp_enabled` is false. And a
-- repo-wide search finds no reader or writer of either column anywhere --
-- not in js/, not in api/, not in lib/. They appear only in their own CREATE
-- TABLE in 000_core_tables.sql. They are dead schema.
--
-- The hazard is purely prospective: the day someone wires up 2FA, the secret
-- lands in a column that anyone holding the public key can read, and nothing
-- in the 2FA work itself would surface that. Removing the column now means
-- that future feature has to choose a home deliberately.
--
-- WHY DROP RATHER THAN REVOKE
--
-- The column-level alternative is:
--     REVOKE SELECT ON public.app_config FROM anon;
--     GRANT SELECT (id, bcv_rate, use_auto_bcv, updated_at, last_close_time)
--         ON public.app_config TO anon;
-- but fetchAppConfig() issues `select('*')`, and PostgREST expands that to
-- every column -- so an anon-context call (the lock screen, before anyone has
-- signed in) would start failing outright on a permission error. Dropping the
-- dead columns keeps `select('*')` working for every role.
--
-- BEFORE APPLYING: re-confirm the columns are still unused and still empty.
--     SELECT totp_secret, totp_enabled FROM public.app_config;
--     grep -rn "totp" --include=*.js --include=*.html .

BEGIN;

ALTER TABLE public.app_config DROP COLUMN IF EXISTS totp_secret;
ALTER TABLE public.app_config DROP COLUMN IF EXISTS totp_enabled;

COMMIT;
