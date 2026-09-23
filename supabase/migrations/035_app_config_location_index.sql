-- Migration 035: índice faltante en app_config.location_id
-- El advisor de performance de Supabase marca la FK app_config_location_id_fkey
-- (agregada en 016b_multi_tenant_locations.sql) sin índice de cobertura. Las
-- otras 11 tablas con location_id sí lo tienen -- app_config quedó afuera
-- porque producción nunca la indexó a mano en su momento (ver 016b). Con una
-- sola fila (id=1) el impacto real es nulo, pero cierra la asimetría con el
-- resto de las tablas y calla el advisor.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_app_config_location_id ON public.app_config(location_id);

COMMIT;
