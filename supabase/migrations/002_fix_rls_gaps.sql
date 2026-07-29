-- Migration 002: Fix RLS gaps for activity_logs and active_sessions
-- Restricts activity_logs and active_sessions to authenticated users only.

-- 1. Fix RLS policies on public.activity_logs
ALTER TABLE IF EXISTS public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura e inserción de logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Lectura de logs solo autenticados" ON public.activity_logs;
DROP POLICY IF EXISTS "Inserción de logs solo autenticados" ON public.activity_logs;

CREATE POLICY "Lectura de logs solo autenticados" ON public.activity_logs
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "Inserción de logs solo autenticados" ON public.activity_logs
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- Note: No UPDATE or DELETE policies are granted on activity_logs to preserve audit trail immutability.

-- 2. Fix RLS policies on public.active_sessions
ALTER TABLE IF EXISTS public.active_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir sesiones activas" ON public.active_sessions;
DROP POLICY IF EXISTS "Gestión de sesiones solo autenticados" ON public.active_sessions;

CREATE POLICY "Gestión de sesiones solo autenticados" ON public.active_sessions
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);
