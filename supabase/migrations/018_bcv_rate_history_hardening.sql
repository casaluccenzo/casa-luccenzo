-- Migration 018: Harden the two new trigger functions from 017
--
-- Both are trigger functions, never meant to be called directly via
-- PostgREST RPC (fill_missing_sale_bcv_rate needs a real NEW.bcv_rate/trigger
-- context; record_bcv_rate_history is SECURITY DEFINER specifically so the
-- trigger can write to bcv_rate_history regardless of who fired the
-- app_config update). Triggers fire regardless of EXECUTE grants on the
-- function itself, so revoking public/anon/authenticated EXECUTE only closes
-- the direct-RPC path the advisor flagged, without touching normal operation.

BEGIN;

ALTER FUNCTION public.fill_missing_sale_bcv_rate() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.fill_missing_sale_bcv_rate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_bcv_rate_history() FROM PUBLIC, anon, authenticated;

COMMIT;
