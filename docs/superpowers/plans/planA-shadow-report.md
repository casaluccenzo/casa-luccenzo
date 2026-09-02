# Plan A — reporte de verificación (modo sombra)

**Fecha:** 2026-09-02
**Rama git:** `feature/offline-first`
**Proyecto dev:** `casa-lucenzo-dev` / `hvwpbhnnfggfdpztdmwo` (us-east-2)
**Ejecutado por:** sesión autónoma nocturna (autorizada por el usuario), SIN
tocar producción.

## Migraciones aplicadas al proyecto dev

| # | Nombre | Estado |
|---|--------|--------|
| 025 | `stock_movements` | ✅ aplicada |
| 026 | `day_closes` + `last_close_at()` | ✅ aplicada |
| 027 | `debt_payments` | ✅ aplicada |
| 028 | `sales_void_columns` | ✅ aplicada |
| 029 | `products_shadow_columns` | ✅ aplicada |
| 030 | `stock_recompute` (fn + 2 triggers) | ✅ aplicada |
| 031 | `stock_alerts_view` | ✅ aplicada |
| 032 | `backfill_stock_movements` | ✅ aplicada |

Bootstrap del esquema dev: `supabase/tests/planA_devbootstrap.sql` (mínimo
equivalente a prod: `locations`, `profiles`, `products`, `sales`, `debts`,
`get_user_role`, `get_user_location`). Datos de ejemplo: `planA_seed.sql`
(6 productos, 3 deudas).

## Suite de aserciones

`supabase/tests/planA_assertions.sql` — corrida completa contra dev:
**`SUITE OK`**, 0 filas de prueba remanentes.

Cubre: estructura de las 3 tablas nuevas + RLS + políticas; `last_close_at()`
vacía y con MAX; saldo de deuda = total − Σ abonos; columnas de anulación;
columnas sombra; recálculo de stock pastelito (8/12 → tras cierre 0/0);
recálculo bebida cruzando un cierre (29/32); `v_stock_alerts` (faltante 3);
y **sombra == real para los 6 productos tras el backfill**.

## Gate (Task 10) — lado dev

- **Diff sombra vs real:** `0` productos con
  `stock_computed <> stock` o `initial_stock_computed <> initial_stock`.
- **Triggers nuevos:** SOLO `trg_stock_movements_recompute` (en
  `stock_movements`) y `trg_day_close_recompute` (en `day_closes`).
  **Cero triggers nuevos en `products`, `sales`, `debts`** → la app de
  producción escribe `products.stock` / `initial_stock` exactamente igual que
  hoy; Plan A no interfiere.

## PENDIENTE — aplicación a producción (requiere OK del usuario)

Task 10 Step 2 NO se ejecutó. Cuando el usuario apruebe:

1. En la rama git: `git checkout feature/offline-first` (o mergear a `main`).
2. Aplicar las migraciones 025-032 a `xttpaqokeyywjaajvjyu` vía MCP
   `apply_migration`, en orden. Son aditivas/dormidas: la app en
   `casalucenzo.com` NO cambia de comportamiento.
3. Correr contra prod:
   ```sql
   select count(*) from public.products
    where stock_computed is distinct from stock
       or initial_stock_computed is distinct from initial_stock;
   -- esperado: 0  (sobre los ~29 productos reales)
   ```
4. Verificar que la lista de triggers de `products`/`sales`/`debts` en prod es
   IDÉNTICA a la de antes (comparar con el snapshot que ya se tiene:
   `sales` → trg_block_guaira_zombie, trg_fill_missing_sale_bcv_rate,
   trg_fill_missing_sale_cost; `app_config` → trg_record_bcv_rate_history,
   trg_guard_app_config_bcv_rate; `products`/`debts` → ninguno). Ningún trigger
   nuevo en esas tablas.
5. Ese diff en 0 + triggers sin cambios = **Plan A OK en prod**. Recién ahí
   arranca Plan B (PowerSync + frontend).

**Precondición del backfill 032 en prod:** `day_closes` debe estar vacía al
aplicarlo (lo está — es una tabla nueva de la migración 026). Si por algún
motivo ya hubiera filas, el backfill daría stock incorrecto para pastelitos.
