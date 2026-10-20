-- Migration 040: GRANT explícitos para la Data API (supabase-js / PostgREST).
--
-- Desde el 30-10-2026 Supabase deja de dar GRANT automático a anon,
-- authenticated y service_role sobre las tablas nuevas de "public". Eso
-- incluye las que se recrean desde cero con estas migraciones: preview
-- branches, proyectos nuevos y `supabase db reset`. Sin el GRANT, la API
-- responde "permission denied" aunque la política RLS lo permita.
--
-- En producción no cambia nada: las tablas ya tienen estos permisos (y más),
-- así que correr esto ahí es un no-op. Acá lo dejamos escrito para que una
-- base recreada quede igual que producción en lo que la API puede usar.
--
-- Quién ve o toca qué fila lo sigue decidiendo RLS (activo en todas estas
-- tablas); el GRANT solo abre la puerta de la tabla, igual que antes.
--
-- Convención desde ahora: cada migración que crea una tabla en public lleva
-- sus GRANT en la misma migración (ver supabase/migrations/README.md).
BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.products,
    public.sales,
    public.expenses,
    public.debts,
    public.replenishments,
    public.ingredients,
    public.app_config,
    public.active_sessions,
    public.activity_logs,
    public.profiles,
    public.whatsapp_conversations,
    public.pedidos_online,
    public.locations,
    public.bcv_rate_history,
    public.bcv_sync_log,
    public.stock_movements,
    public.day_closes,
    public.debt_payments,
    public.invoice_counters,
    public.invoices,
    public.invoice_verify_attempts
TO anon, authenticated, service_role;

-- La vista es security_invoker (031): respeta el RLS de las tablas de abajo.
GRANT SELECT ON public.v_stock_alerts TO anon, authenticated, service_role;

COMMIT;
