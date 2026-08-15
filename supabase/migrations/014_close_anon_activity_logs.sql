-- Migration 014: Close `activity_logs` to anonymous read AND write
--
-- Migration 011 went table by table dropping `anon` from leftover SELECT
-- policies, and closed ingredients, replenishments and profiles. It missed
-- activity_logs, which carries strictly more than any of them: every sale
-- amount and client name ("Venta de 4 ítems por $8.36. Cliente: ..."), every
-- price and stock edit, every login, and every failed-login security alert.
--
-- Verified against production on 2026-08-14 with the publishable key that
-- ships in the public page source:
--
--   GET /rest/v1/activity_logs  ->  200, full rows
--
-- The INSERT side is the sharper problem. "Permitir inserciones anonimas" is
-- WITH CHECK (true), so anyone holding that same public key can forge audit
-- entries. That includes rows shaped like the ones migration 012's trigger
-- writes ('Inserción Bloqueada (horario retirado)') -- which is precisely the
-- signal being used to decide whether it is safe to retire that guard via 013.
-- An audit log a stranger can write to cannot be used as evidence.
--
-- Both `authenticated` policies already exist and are unchanged, so the app
-- itself is unaffected: every writer of this table (logActivity ->
-- insertActivityLog) runs inside a signed-in session, and the 012 trigger's
-- own INSERT is wrapped in EXCEPTION WHEN OTHERS THEN NULL.

BEGIN;

DROP POLICY IF EXISTS "Permitir lecturas anonimas"    ON public.activity_logs;
DROP POLICY IF EXISTS "Permitir inserciones anonimas" ON public.activity_logs;

COMMIT;
