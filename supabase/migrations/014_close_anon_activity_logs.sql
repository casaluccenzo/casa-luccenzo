-- Migration 014: Stop `activity_logs` leaking to anon, and stop it being forgeable
--
-- Migration 011 went table by table dropping `anon` from leftover SELECT
-- policies and closed ingredients, replenishments and profiles. It left
-- activity_logs alone, which carries strictly more than any of them: the
-- amount and client of every sale ("Venta de 4 ítems por $8.36. Cliente: ..."),
-- every price and stock edit, every login, every failed-login alert.
--
-- Verified against production 2026-08-14 using the publishable key that ships
-- in the public page source:  GET /rest/v1/activity_logs  ->  200, full rows.
--
-- ---------------------------------------------------------------------------
-- 1. SELECT: closed outright. No cost.
-- ---------------------------------------------------------------------------
-- Nothing reads this table anonymously. fetchActivityLogs() runs from the admin
-- panel inside a session, and the "Lectura de logs solo autenticados" policy
-- already covers it.
--
-- ---------------------------------------------------------------------------
-- 2. INSERT: narrowed, NOT dropped. Dropping it would lose a real signal.
-- ---------------------------------------------------------------------------
-- The obvious move is to drop the anon INSERT too, but that quietly breaks
-- something worth keeping: handleUserLogin() calls
--     logActivity("Seguridad Alerta", `Intento fallido ... "${cleanUser}"`)
-- after 3 failed attempts -- precisely when there is NO session, because the
-- login just failed. With anon INSERT gone, that write is rejected, falls into
-- the catch, and lands in the offline queue on the attacker's own device, where
-- it is worth nothing. Failed logins from a device that never authenticates
-- would simply stop being recorded.
--
-- And there is no fallback: Supabase's own auth.audit_log_entries is empty on
-- this project (checked 2026-08-14, 0 rows total), so it is not capturing
-- failed sign-ins either.
--
-- So instead of `WITH CHECK (true)`, anon may insert exactly one kind of row.
-- That keeps the security alert working while removing the ability to forge
-- arbitrary history -- in particular rows shaped like the
-- 'Inserción Bloqueada (horario retirado)' entries that migration 012's trigger
-- writes, which are the evidence being used to decide whether it is safe to
-- retire that guard via 013. An audit trail a stranger can write freely is not
-- evidence; one where they can only append a single, clearly-labelled alert
-- type still is.
--
-- Residual risk accepted: anon can still spam 'Seguridad Alerta' rows. That is
-- noise in one bucket, not contamination of the record.

BEGIN;

-- 1. No anonymous reading of the audit trail.
DROP POLICY IF EXISTS "Permitir lecturas anonimas" ON public.activity_logs;

-- 2. Replace the blanket anonymous INSERT with a single-purpose one.
DROP POLICY IF EXISTS "Permitir inserciones anonimas" ON public.activity_logs;

CREATE POLICY "Alerta de seguridad sin sesion"
    ON public.activity_logs FOR INSERT TO anon
    WITH CHECK (action = 'Seguridad Alerta');

COMMIT;
