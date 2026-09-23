# Plan A — reporte de verificación en modo sombra

Ver `docs/superpowers/plans/2026-09-02-offline-first-pos-plan-A-postgres.md`, Task 10.

## Corrida 1: proyecto dev (`casa-lucenzo-dev`, `kzthbjjfguivguppqeuq`) — ✅ OK

**Fecha:** 2026-09-23

**Migraciones aplicadas** (en orden, sobre el estado real de producción
reconstruido — ver Task 0 del plan para el detalle de por qué no son
simplemente `001`-`024`):

```
000_core_tables, 001_auth_and_rls, 002_fix_rls_gaps, 003_quick_pin,
004_fix_admin_pin_privesc, 005_pin_rate_limit, 006_fix_signup_role_privesc,
007_whatsapp_conversation_memory, 008_pedidos_online, 009_fix_missing_categories,
010_close_public_rls, 011_close_anon_reads, 012_retire_guaira_zombie_timestamp,
014_close_anon_activity_logs, 016_add_activity_logs_actor_name,
016b_multi_tenant_locations, 017_bcv_rate_history, 018_bcv_rate_history_hardening,
019_product_cost, 019b_fix_cost_trigger_search_path, 020_expense_categories,
021_server_side_bcv_sync, 022_bcv_sync_afternoon_window, 023_harden_rpc_surface,
024_pin_functions_search_path,
025_stock_movements, 026_day_closes, 027_debt_payments,
028_sales_void_columns, 029_products_shadow_columns, 030_stock_recompute,
031_stock_alerts_view, 032_backfill_stock_movements
```

(`013_drop_guaira_zombie_guard` y `015_drop_unused_totp_columns` deliberadamente
NO aplicadas, igual que en producción — ver sus propios headers.)

**Step 1 — diff sombra vs real** sobre los 6 productos de ejemplo
(`supabase/tests/planA_seed.sql`) tras el backfill (Task 8):

```sql
SELECT id, name, category, stock, stock_computed, initial_stock, initial_stock_computed
  FROM public.products
 WHERE stock_computed IS DISTINCT FROM stock
    OR initial_stock_computed IS DISTINCT FROM initial_stock;
```

**Resultado: 0 filas.**

**Step 2 — triggers sobre las tablas que la app escribe hoy**
(`products`, `sales`, `debts`, `expenses`, `replenishments`, `app_config`):

```sql
SELECT tgname, tgrelid::regclass::text, tgenabled
  FROM pg_trigger
 WHERE NOT tgisinternal
   AND tgrelid::regclass::text IN ('public.products','public.sales','public.debts',
                                   'public.expenses','public.replenishments','public.app_config');
```

**Resultado en dev: 0 filas. Resultado en producción (`xttpaqokeyywjaajvjyu`): 0 filas.**
Coinciden — ninguna migración de Plan A agregó un trigger `BEFORE`/`AFTER` sobre
esas seis tablas. Los únicos triggers nuevos (`trg_stock_movements_recompute`,
`trg_day_close_recompute`) viven en las tablas NUEVAS (`stock_movements`,
`day_closes`), no en las que el POS ya usa.

Además, la suite completa `supabase/tests/planA_assertions.sql` (Tasks 1-8)
corre de punta a punta sin excepción y sin dejar filas de prueba (Task 9).

**Conclusión de la corrida 1: Plan A pasa el gate en dev.**

## Corrida 2: producción (`xttpaqokeyywjaajvjyu`) — ✅ OK

**Fecha:** 2026-09-23, con confirmación explícita del usuario para aplicar a
producción.

**Migraciones aplicadas** (mismo orden y mismo SQL que en dev): `025_stock_movements`,
`026_day_closes`, `027_debt_payments`, `028_sales_void_columns`,
`029_products_shadow_columns`, `030_stock_recompute`, `031_stock_alerts_view`,
`032_backfill_stock_movements`. Todas `{"success": true}`.

**Step 1 — diff sombra vs real** sobre los 29 productos reales:

```sql
SELECT id, name, category, stock, stock_computed, initial_stock, initial_stock_computed
  FROM public.products
 WHERE stock_computed IS DISTINCT FROM stock
    OR initial_stock_computed IS DISTINCT FROM initial_stock;
```

**Resultado: 0 filas.**

**Step 2 — triggers** sobre `products`, `sales`, `debts`, `expenses`,
`replenishments`, `app_config`, post-migración:

**Resultado: 0 filas — idéntico al baseline pre-migración.** Ningún trigger
nuevo tocó las tablas que la app ya escribe; los dos triggers nuevos
(`trg_stock_movements_recompute`, `trg_day_close_recompute`) viven únicamente
en las tablas nuevas.

`get_advisors` (security) post-migración: mismos hallazgos que antes de Plan A,
más `last_close_at()` apareciendo en la lista de funciones `SECURITY DEFINER`
ejecutables por `authenticated` — esperado y a propósito, tal como documenta
la migración 026 ("`authenticated` lo necesita: lo llaman las vistas de
reporte del cliente"). No es un hallazgo nuevo sin explicar.

**Conclusión de la corrida 2 (OK definitivo de Plan A):** las 29 columnas
sombra de producción coinciden exactamente con las columnas reales que la app
sigue leyendo y escribiendo hoy, y el esquema que ve `casalucenzo.com` no
cambió de comportamiento. Plan A — Fase 1 (modelo de datos append-only) queda
**completo y verificado en producción**, en modo sombra/dormido. El frontend
NO lee ni escribe ninguna de estas tablas/columnas todavía: conectar el
cliente (POS, cierre de jornada, abonos, anulaciones) a `stock_movements`,
`day_closes`, `debt_payments`, `voided_at` y las columnas `*_computed` es
**Plan B**, que a la fecha de este reporte ni siquiera está escrito.
