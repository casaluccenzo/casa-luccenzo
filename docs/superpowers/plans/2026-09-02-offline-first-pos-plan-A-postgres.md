# Offline-first POS — Plan A: modelo de datos append-only en Postgres

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar a Postgres las tablas y triggers append-only (stock, deudas,
cierres, anulaciones) que van a alimentar la sincronización offline, sin tocar
todavía el frontend ni romper la app en producción.

**Architecture:** Todo es aditivo y corre en modo sombra. Las tablas nuevas
(`stock_movements`, `debt_payments`, `day_closes`) y las columnas nuevas
(`sales.voided_at`, `products.*_computed`) se crean vacías/dormidas. Un trigger
recalcula columnas *sombra* en `products` (`stock_computed`, etc.) a partir de
los movimientos; la app sigue leyendo y escribiendo las columnas reales
(`stock`, `initial_stock`). Al final se compara sombra vs real sobre los datos
vivos. El frontend que empieza a *escribir* movimientos y a *leer* las columnas
sombra es Plan B.

**Tech Stack:** Supabase Postgres 17, migraciones `.sql` aplicadas vía el MCP
de Supabase (`apply_migration`), **un 2º proyecto Supabase gratis**
(`casa-lucenzo-dev`) para aislar — la org está en plan free y el branching
requiere Pro; el free tier permite 2 proyectos. Scripts de aserción SQL
(`DO $$ ... RAISE EXCEPTION $$`) vía `execute_sql`.

**Spec:** `docs/superpowers/specs/2026-09-02-offline-first-pos-design.md`
(secciones 5, 5.1, 5.1a, 8; contexto en 2, 3, 4).

## Global Constraints

- Migraciones numeradas siguiendo la serie actual: la última es
  `024_pin_functions_search_path` (`schema_migrations` version `20260902014500`).
  Las nuevas van `025`, `026`, … con nombre `NNN_<snake_case>` y version
  timestamp `AAAAMMDDHHMMSS`. Se aplican PRIMERO al proyecto dev; a producción
  (`xttpaqokeyywjaajvjyu`) recién cuando Plan A pasa el gate de la Task 10.
- Toda tabla nueva: `ENABLE ROW LEVEL SECURITY` + políticas explícitas antes de
  cualquier `GRANT`. Patrón de las tablas existentes: lectura por rol
  (`authenticated`), escritura para `venta`/`cocina`/`admin` según corresponda.
  Nunca dejar una tabla con RLS activa y sin política (lo marca el advisor 0008).
- Funciones nuevas: `SECURITY DEFINER` solo si hace falta escribir saltando RLS;
  siempre `SET search_path = public` (o `public, extensions` si usan pgcrypto).
  `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` salvo que deba ser RPC.
- `location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'`
  en toda tabla nueva (multi-tenant, hoy una sola location).
- Nada de esto se aplica al proyecto de producción (`xttpaqokeyywjaajvjyu`)
  hasta que Plan A entero pase sus aserciones en el proyecto dev. La app en
  `casalucenzo.com` NO debe cambiar de comportamiento al terminar Plan A.
- PKs de tablas append-only: `uuid` (texto o `uuid`), generado por el cliente,
  igual que `sales.uuid` / `debts.uuid` hoy (son `text`).

---

## File Structure

| Archivo | Responsabilidad |
|---------|-----------------|
| `supabase/migrations/025_stock_movements.sql` | Tabla `stock_movements` + RLS + índices |
| `supabase/migrations/026_day_closes.sql` | Tabla `day_closes` + RLS + `last_close_at()` |
| `supabase/migrations/027_debt_payments.sql` | Tabla `debt_payments` + RLS |
| `supabase/migrations/028_sales_void_columns.sql` | `sales.voided_at`, `sales.void_reason` |
| `supabase/migrations/029_products_shadow_columns.sql` | `products.stock_computed`, `initial_stock_computed`, `max_computed` |
| `supabase/migrations/030_stock_recompute.sql` | Función `recompute_product_stock(text)` + triggers en `stock_movements` y `day_closes` |
| `supabase/migrations/031_stock_alerts_view.sql` | Vista `v_stock_alerts` |
| `supabase/migrations/032_backfill_stock_movements.sql` | Un `stock_movements` inicial por producto que reproduce el estado actual |
| `supabase/tests/planA_assertions.sql` | Script de aserciones (no es migración; se corre a mano en el proyecto dev) |

Cada migración envuelta en `BEGIN; … COMMIT;` como las existentes (ver
`017_bcv_rate_history.sql`). Cada una con un ROLLBACK companion solo si revertir
no es trivial (patrón de `010_close_public_rls_ROLLBACK.sql`).

---

## Task 0: Entorno de trabajo aislado

**Files:** ninguno (setup).

**Interfaces:**
- Produces: una rama git `feature/offline-first` y un 2º proyecto Supabase
  gratis (`casa-lucenzo-dev`) con las 24 migraciones de producción ya aplicadas,
  donde corren las migraciones 025-032 sin tocar producción.

- [ ] **Step 1: Crear la rama git**

```bash
git checkout main && git pull origin main
git checkout -b feature/offline-first
mkdir -p supabase/tests
git commit --allow-empty -m "chore: start offline-first Phase 1 (Plan A)"
```

- [ ] **Step 2: El usuario crea el 2º proyecto**

El usuario crea desde el dashboard un proyecto gratis `casa-lucenzo-dev`, misma
región (`us-west-2`), y pasa el `project_id`. (No lo crea el agente salvo que el
usuario lo pida explícitamente.) Anotar el `DEV_PROJECT_ID` — TODAS las
migraciones y aserciones de Plan A van contra ese id, nunca contra
`xttpaqokeyywjaajvjyu` (producción).

- [ ] **Step 3: Bootstrap del esquema mínimo en el proyecto dev**

Los archivos `supabase/migrations/*.sql` NO reflejan fielmente lo aplicado en
prod (falta el archivo de `multi_tenant_locations`; varias 010-015 no están
trackeadas). En vez de replayarlas, aplicar `supabase/tests/planA_devbootstrap.sql`
vía `execute_sql` contra `DEV_PROJECT_ID`. Crea el subconjunto mínimo que Plan A
necesita, con columnas exactas de la prod viva: `locations`, `profiles`,
`products`, `sales`, `debts` + funciones `get_user_role(uuid)`,
`get_user_location(uuid)`. Verificar: `get_user_role(null)` devuelve `'anon'`.

DEV_PROJECT_ID = `hvwpbhnnfggfdpztdmwo` (creado 2026-09-02, región us-east-2).

- [ ] **Step 4: Sembrar datos de ejemplo para el backfill**

El proyecto dev no tiene los datos de prod. Insertar ~6 productos
representativos (mix de `pastelitos` y `bebidas`/`dulces`, con `stock` e
`initial_stock` distintos, alguno con `stock < initial_stock`) y ~3 deudas.
Guardar el script en `supabase/tests/planA_seed.sql`.

```sql
-- planA_seed.sql — datos de ejemplo SOLO para el proyecto dev
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost) VALUES
  ('seed-past-a','Pastelito Queso',   14, 3, 30, 1.50, 'pastelitos', 20, 0.55),
  ('seed-past-b','Pastelito Carne',    0, 3, 30, 1.75, 'pastelitos', 18, 0.70),
  ('seed-past-c','Pastelito Pizza',    9, 3, 30, 1.60, 'pastelitos', 12, 0.60),
  ('seed-beb-a', 'Malta 355ml',       28, 6, 60, 1.20, 'bebidas',    40, 0.80),
  ('seed-beb-b', 'Agua 600ml',        11, 6, 60, 0.90, 'bebidas',    11, 0.45),
  ('seed-dul-a', 'Chocolate barra',    5, 2, 24, 2.00, 'dulces',      7, 1.10);
INSERT INTO public.debts (uuid, client_name, amount) VALUES
  ('seed-debt-a','Panadería El Sol', 120.00),
  ('seed-debt-b','Kiosco Maria',      45.50),
  ('seed-debt-c','Cliente Frecuente', 8.00);
```

- [ ] **Step 5: Commit del scaffold**

```bash
git add supabase/tests/planA_seed.sql
git commit -m "chore: Plan A dev-project seed data"
```

---

## Task 1: Tabla `stock_movements`

**Files:**
- Create: `supabase/migrations/025_stock_movements.sql`

**Interfaces:**
- Produces: tabla `public.stock_movements` con columnas
  `id text pk, product_id text, delta int, type text, source_uuid text,
   device_id text, created_at timestamptz, location_id uuid, note text`.
  `type ∈ ('load','sale','sale_return','count_down','open_carry')`.

- [ ] **Step 1: Escribir la aserción de que la tabla NO existe todavía**

En `supabase/tests/planA_assertions.sql`, agregar al principio:

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='stock_movements') THEN
    RAISE EXCEPTION 'planA: stock_movements ya existe antes de la migracion 025';
  END IF;
END $$;
```

Correr ese bloque solo vía `execute_sql` contra el proyecto dev. Expected: pasa (no
lanza) porque la tabla aún no existe.

- [ ] **Step 2: Escribir la migración 025**

```sql
-- Migration 025: stock_movements — registro append-only de movimientos de vitrina
-- Ver spec §5.1a. Dormida en Plan A: nadie inserta todavía.
BEGIN;

CREATE TABLE public.stock_movements (
    id          text PRIMARY KEY,
    product_id  text NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    delta       integer NOT NULL,
    type        text NOT NULL CHECK (type IN
                  ('load','sale','sale_return','count_down','open_carry')),
    source_uuid text,
    device_id   text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    note        text
);

CREATE INDEX idx_stock_movements_product_created
    ON public.stock_movements (product_id, created_at);
CREATE INDEX idx_stock_movements_source
    ON public.stock_movements (source_uuid) WHERE source_uuid IS NOT NULL;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de stock_movements" ON public.stock_movements;
CREATE POLICY "Lectura de stock_movements" ON public.stock_movements
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Venta y cocina y admin insertan movimientos" ON public.stock_movements;
CREATE POLICY "Venta y cocina y admin insertan movimientos" ON public.stock_movements
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('venta','cocina','admin'));

-- Sin UPDATE ni DELETE: es append-only. Correcciones = un movimiento nuevo.

COMMIT;
```

- [ ] **Step 3: Aplicar la migración al proyecto dev**

MCP `apply_migration` contra `DEV_PROJECT_ID`, `name: "025_stock_movements"`.
Expected: `{"success": true}`.

- [ ] **Step 4: Aserciones de estructura**

Agregar a `planA_assertions.sql` y correr vía `execute_sql`:

```sql
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='stock_movements') = 9,
         'planA: stock_movements debe tener 9 columnas';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.stock_movements'::regclass),
         'planA: RLS no activo en stock_movements';
  ASSERT (SELECT count(*) FROM pg_policies WHERE tablename='stock_movements') = 2,
         'planA: stock_movements debe tener 2 politicas';
END $$;
```

Expected: no lanza.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/025_stock_movements.sql supabase/tests/planA_assertions.sql
git commit -m "feat(db): stock_movements append-only table (dormant)"
```

---

## Task 2: Tabla `day_closes` + `last_close_at()`

**Files:**
- Create: `supabase/migrations/026_day_closes.sql`

**Interfaces:**
- Consumes: nada.
- Produces:
  - tabla `public.day_closes (id text pk, closed_at timestamptz, device_id text,
    totals jsonb, location_id uuid, created_at timestamptz)`.
  - función `public.last_close_at() RETURNS timestamptz` — devuelve
    `MAX(closed_at)` o `'-infinity'::timestamptz` si no hay cierres. `STABLE`,
    `SECURITY DEFINER`, `SET search_path=public`. Es la frontera que usa el
    recálculo de stock (Task 6).

- [ ] **Step 1: Escribir la migración 026**

```sql
-- Migration 026: day_closes — cada cierre de jornada es una fila (append-only).
-- last_close_at() es la frontera para el calculo de stock de pastelitos (§5.1a).
BEGIN;

CREATE TABLE public.day_closes (
    id          text PRIMARY KEY,
    closed_at   timestamptz NOT NULL DEFAULT now(),
    device_id   text,
    totals      jsonb,
    location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_day_closes_closed_at ON public.day_closes (closed_at DESC);

ALTER TABLE public.day_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de day_closes" ON public.day_closes;
CREATE POLICY "Lectura de day_closes" ON public.day_closes
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Venta y admin cierran jornada" ON public.day_closes;
CREATE POLICY "Venta y admin cierran jornada" ON public.day_closes
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('venta','admin'));

CREATE OR REPLACE FUNCTION public.last_close_at()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(MAX(closed_at), '-infinity'::timestamptz) FROM public.day_closes;
$$;

REVOKE EXECUTE ON FUNCTION public.last_close_at() FROM PUBLIC, anon;
-- authenticated lo necesita: lo llaman las vistas de reporte del cliente.

COMMIT;
```

- [ ] **Step 2: Aplicar al proyecto dev**

MCP `apply_migration`, `name: "026_day_closes"`. Expected: `{"success": true}`.

- [ ] **Step 3: Aserciones**

Agregar a `planA_assertions.sql`:

```sql
DO $$ BEGIN
  ASSERT public.last_close_at() = '-infinity'::timestamptz,
         'planA: last_close_at() con day_closes vacia debe dar -infinity';
END $$;

INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-1', '2026-09-01T23:00:00Z');
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-2', '2026-09-02T22:00:00Z');
DO $$ BEGIN
  ASSERT public.last_close_at() = '2026-09-02T22:00:00Z'::timestamptz,
         'planA: last_close_at() debe dar el MAX(closed_at)';
END $$;
DELETE FROM public.day_closes WHERE id IN ('t-close-1','t-close-2');
```

Expected: no lanza. (El `DELETE` de limpieza es válido acá porque es el proyecto dev de
test y estas filas son sintéticas; en producción `day_closes` es append-only.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/026_day_closes.sql supabase/tests/planA_assertions.sql
git commit -m "feat(db): day_closes table + last_close_at() boundary fn"
```

---

## Task 3: Tabla `debt_payments`

**Files:**
- Create: `supabase/migrations/027_debt_payments.sql`

**Interfaces:**
- Consumes: `public.debts (uuid text pk, amount numeric, ...)`.
- Produces: tabla `public.debt_payments (id text pk, debt_uuid text,
  amount numeric, method text, device_id text, created_at timestamptz,
  location_id uuid)`. Saldo de una deuda = `debts.amount − Σ debt_payments.amount`
  (spec §5.3). `debts.amount` pasa a ser el total inmutable; el backfill deja
  `debt_payments` vacía y `debts.amount` = el remanente actual (los abonos
  viejos viven en `sales` como `product_id='abono'`, no se pueden re-linkear).

- [ ] **Step 1: Escribir la migración 027**

```sql
-- Migration 027: debt_payments — abonos append-only.
-- Saldo = debts.amount - SUM(debt_payments.amount). Dormida en Plan A.
BEGIN;

CREATE TABLE public.debt_payments (
    id          text PRIMARY KEY,
    debt_uuid   text NOT NULL REFERENCES public.debts(uuid) ON DELETE CASCADE,
    amount      numeric NOT NULL CHECK (amount > 0),
    method      text,
    device_id   text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    location_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
);

CREATE INDEX idx_debt_payments_debt ON public.debt_payments (debt_uuid, created_at);

ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de debt_payments" ON public.debt_payments;
CREATE POLICY "Lectura de debt_payments" ON public.debt_payments
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Venta y admin registran abonos" ON public.debt_payments;
CREATE POLICY "Venta y admin registran abonos" ON public.debt_payments
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('venta','admin'));

COMMIT;
```

- [ ] **Step 2: Aplicar al proyecto dev**

MCP `apply_migration`, `name: "027_debt_payments"`. Expected: `{"success": true}`.

- [ ] **Step 3: Aserción de saldo**

Agregar a `planA_assertions.sql`:

```sql
INSERT INTO public.debts (uuid, client_name, amount) VALUES ('t-debt-1', 'Test', 100);
INSERT INTO public.debt_payments (id, debt_uuid, amount) VALUES ('t-pay-1', 't-debt-1', 30);
INSERT INTO public.debt_payments (id, debt_uuid, amount) VALUES ('t-pay-2', 't-debt-1', 20);
DO $$
DECLARE saldo numeric;
BEGIN
  SELECT d.amount - COALESCE(SUM(p.amount),0) INTO saldo
    FROM public.debts d LEFT JOIN public.debt_payments p ON p.debt_uuid = d.uuid
   WHERE d.uuid = 't-debt-1' GROUP BY d.amount;
  ASSERT saldo = 50, 'planA: saldo esperado 50, dio ' || saldo;
END $$;
DELETE FROM public.debt_payments WHERE debt_uuid = 't-debt-1';
DELETE FROM public.debts WHERE uuid = 't-debt-1';
```

Expected: no lanza.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/027_debt_payments.sql supabase/tests/planA_assertions.sql
git commit -m "feat(db): debt_payments append-only table (dormant)"
```

---

## Task 4: Columnas de anulación en `sales`

**Files:**
- Create: `supabase/migrations/028_sales_void_columns.sql`

**Interfaces:**
- Produces: `sales.voided_at timestamptz NULL`, `sales.void_reason text NULL`.
  Los reportes filtrarán `voided_at IS NULL` (eso lo hace Plan B en el cliente;
  acá solo se agregan las columnas, nulas).

- [ ] **Step 1: Escribir la migración 028**

```sql
-- Migration 028: anulacion de ventas por marca, no por DELETE (spec §5.2).
BEGIN;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS voided_at   timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS void_reason text;
CREATE INDEX IF NOT EXISTS idx_sales_active
    ON public.sales (timestamp) WHERE voided_at IS NULL;
COMMIT;
```

- [ ] **Step 2: Aplicar al proyecto dev**

MCP `apply_migration`, `name: "028_sales_void_columns"`. Expected: `{"success": true}`.

- [ ] **Step 3: Aserción**

```sql
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sales'
            AND column_name IN ('voided_at','void_reason')) = 2,
         'planA: faltan columnas de anulacion en sales';
END $$;
```

Expected: no lanza.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/028_sales_void_columns.sql
git commit -m "feat(db): sales.voided_at / void_reason columns"
```

---

## Task 5: Columnas sombra en `products`

**Files:**
- Create: `supabase/migrations/029_products_shadow_columns.sql`

**Interfaces:**
- Produces: `products.stock_computed int`, `products.initial_stock_computed int`,
  `products.max_computed int`, todas NULL al inicio. El trigger de Task 6 las
  llena. La app NO las lee todavía (Plan B). Comparar sombra vs real es el
  criterio de "modo sombra OK" del spec §10.

- [ ] **Step 1: Escribir la migración 029**

```sql
-- Migration 029: columnas sombra. El trigger de 030 las mantiene; la app las
-- ignora hasta Plan B. Sirven para comparar el calculo nuevo contra el real.
BEGIN;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_computed         integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS initial_stock_computed integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS max_computed           integer;
COMMIT;
```

- [ ] **Step 2: Aplicar + aserción**

MCP `apply_migration`, `name: "029_products_shadow_columns"`.

```sql
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='products'
            AND column_name LIKE '%_computed') = 3,
         'planA: faltan columnas sombra en products';
END $$;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/029_products_shadow_columns.sql
git commit -m "feat(db): products shadow-compute columns"
```

---

## Task 6: Función de recálculo + triggers

**Files:**
- Create: `supabase/migrations/030_stock_recompute.sql`

**Interfaces:**
- Consumes: `stock_movements`, `day_closes`, `last_close_at()`, `products`.
- Produces:
  - `public.recompute_product_stock(p_product_id text) RETURNS void` — recalcula
    las 3 columnas `*_computed` de ESE producto según §5.1a. `SECURITY DEFINER`,
    `SET search_path=public`.
  - trigger `trg_stock_movements_recompute` AFTER INSERT ON `stock_movements`
    FOR EACH ROW → `recompute_product_stock(NEW.product_id)`.
  - trigger `trg_day_close_recompute` AFTER INSERT ON `day_closes`
    FOR EACH STATEMENT → recalcula TODOS los productos (cambió la frontera).

- [ ] **Step 1: Escribir la migración 030**

```sql
-- Migration 030: recalculo de stock sombra desde stock_movements (§5.1a).
BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_product_stock(p_product_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cat        text;
    v_t0         timestamptz := public.last_close_at();
    v_stock      integer;
    v_initial    integer;
    v_max_cfg    integer;
BEGIN
    SELECT category, max INTO v_cat, v_max_cfg
      FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN RETURN; END IF;

    IF v_cat = 'pastelitos' THEN
        -- stock: todos los movimientos desde el ultimo cierre
        SELECT COALESCE(SUM(delta),0) INTO v_stock
          FROM public.stock_movements
         WHERE product_id = p_product_id AND created_at > v_t0;
        -- base del dia: solo las cargas desde el ultimo cierre
        SELECT COALESCE(SUM(delta),0) INTO v_initial
          FROM public.stock_movements
         WHERE product_id = p_product_id AND created_at > v_t0 AND type = 'load';
    ELSE
        -- empaquetados: stock = todo el historial
        SELECT COALESCE(SUM(delta),0) INTO v_stock
          FROM public.stock_movements
         WHERE product_id = p_product_id;
        -- base del dia: stock al momento del ultimo cierre + cargas desde entonces
        SELECT
          COALESCE((SELECT SUM(delta) FROM public.stock_movements
                     WHERE product_id = p_product_id AND created_at <= v_t0), 0)
          + COALESCE((SELECT SUM(delta) FROM public.stock_movements
                       WHERE product_id = p_product_id AND created_at > v_t0 AND type = 'load'), 0)
          INTO v_initial;
    END IF;

    UPDATE public.products
       SET stock_computed         = v_stock,
           initial_stock_computed = v_initial,
           max_computed           = GREATEST(v_initial, COALESCE(v_max_cfg, 0))
     WHERE id = p_product_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_product_stock(text)
    FROM PUBLIC, anon, authenticated;

-- Trigger por fila: un movimiento nuevo recalcula su producto
CREATE OR REPLACE FUNCTION public.tg_stock_movements_recompute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.recompute_product_stock(NEW.product_id);
    RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.tg_stock_movements_recompute() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stock_movements_recompute ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_recompute
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.tg_stock_movements_recompute();

-- Trigger por statement: un cierre nuevo mueve la frontera -> recalcular todo
CREATE OR REPLACE FUNCTION public.tg_day_close_recompute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id FROM public.products LOOP
        PERFORM public.recompute_product_stock(r.id);
    END LOOP;
    RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION public.tg_day_close_recompute() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_day_close_recompute ON public.day_closes;
CREATE TRIGGER trg_day_close_recompute
AFTER INSERT ON public.day_closes
FOR EACH STATEMENT EXECUTE FUNCTION public.tg_day_close_recompute();

COMMIT;
```

- [ ] **Step 2: Aplicar al proyecto dev**

MCP `apply_migration`, `name: "030_stock_recompute"`. Expected: `{"success": true}`.

- [ ] **Step 3: Test de cálculo — pastelito, un día sin cierre**

Agregar a `planA_assertions.sql`:

```sql
-- producto pastelito de prueba
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-past-1','Test Pastelito',0,2,20,1.5,'pastelitos',0,0.5);

INSERT INTO public.stock_movements (id,product_id,delta,type) VALUES
  ('m1','t-past-1', 12,'load'),
  ('m2','t-past-1', -1,'sale'),
  ('m3','t-past-1', -1,'sale'),
  ('m4','t-past-1', -2,'count_down');

DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s, i
    FROM public.products WHERE id='t-past-1';
  ASSERT s = 8,  'planA: pastelito stock_computed esperado 8, dio ' || s;      -- 12-1-1-2
  ASSERT i = 12, 'planA: pastelito initial_stock_computed esperado 12, dio ' || i;
  -- vendido POS = 2 ; diferencia fisica = 12-8 = 4 ; conciliacion = 4-2 = 2
END $$;
```

Expected: no lanza.

- [ ] **Step 4: Test de cálculo — el cierre resetea el pastelito**

```sql
INSERT INTO public.day_closes (id, closed_at) VALUES ('t-close-A', now());
DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s, i
    FROM public.products WHERE id='t-past-1';
  ASSERT s = 0, 'planA: tras el cierre el pastelito debe dar stock 0, dio ' || s;
  ASSERT i = 0, 'planA: tras el cierre initial del pastelito debe dar 0, dio ' || i;
END $$;
```

Expected: no lanza.

- [ ] **Step 5: Test de cálculo — bebida (empaquetado) cruza el cierre**

```sql
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-beb-1','Test Bebida',0,1,50,2.0,'bebidas',0,1.0);

-- antes del cierre t-close-A: carga 24, vende 4  -> quedan 20
INSERT INTO public.stock_movements (id,product_id,delta,type,created_at) VALUES
  ('b1','t-beb-1', 24,'load',       now() - interval '2 hours'),
  ('b2','t-beb-1', -4,'sale',       now() - interval '90 minutes');
-- (el cierre t-close-A ya existe, con closed_at = ~ahora-... ver step 4; ajustar
--  para que estos dos movimientos caigan ANTES de closed_at)
```

Nota para el implementador: en el step 4 se insertó `t-close-A` con
`closed_at = now()`. Para este test, o (a) insertar los movimientos `b1/b2` con
`created_at` claramente anterior a ese `closed_at`, o (b) usar un `closed_at`
fijo conocido. Recomendado (b): reescribir `t-close-A` con
`closed_at = '2026-09-02T20:00:00Z'` y datar `b1/b2` a las 18:00 y 19:00 de ese
día, y los movimientos "de hoy" del step 6 después de las 20:00.

```sql
-- despues del cierre: carga 12 mas, vende 3
INSERT INTO public.stock_movements (id,product_id,delta,type,created_at) VALUES
  ('b3','t-beb-1', 12,'load','2026-09-02T21:00:00Z'),
  ('b4','t-beb-1', -3,'sale','2026-09-02T21:30:00Z');

DO $$
DECLARE s int; i int;
BEGIN
  SELECT stock_computed, initial_stock_computed INTO s, i
    FROM public.products WHERE id='t-beb-1';
  ASSERT s = 29, 'planA: bebida stock_computed esperado 29, dio ' || s;   -- 24-4+12-3
  ASSERT i = 32, 'planA: bebida initial esperado 32, dio ' || i;          -- (24-4 al cierre) + 12 carga
END $$;
```

Expected: no lanza.

- [ ] **Step 6: Limpieza de datos de prueba**

```sql
DELETE FROM public.stock_movements WHERE product_id IN ('t-past-1','t-beb-1');
DELETE FROM public.day_closes WHERE id = 't-close-A';
DELETE FROM public.products WHERE id IN ('t-past-1','t-beb-1');
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/030_stock_recompute.sql supabase/tests/planA_assertions.sql
git commit -m "feat(db): stock recompute fn + triggers (shadow columns)"
```

---

## Task 7: Vista `v_stock_alerts`

**Files:**
- Create: `supabase/migrations/031_stock_alerts_view.sql`

**Interfaces:**
- Consumes: `products.stock_computed`.
- Produces: vista `public.v_stock_alerts (product_id, name, stock_computed, faltante)`
  con las filas donde `stock_computed < 0`. La lee el panel admin (Plan B).

- [ ] **Step 1: Escribir la migración 031**

```sql
-- Migration 031: alerta de stock negativo para el admin (spec §5.1a).
BEGIN;
CREATE OR REPLACE VIEW public.v_stock_alerts AS
SELECT id AS product_id,
       name,
       stock_computed,
       -stock_computed AS faltante
  FROM public.products
 WHERE stock_computed IS NOT NULL AND stock_computed < 0;

ALTER VIEW public.v_stock_alerts SET (security_invoker = true);
GRANT SELECT ON public.v_stock_alerts TO authenticated;
COMMIT;
```

- [ ] **Step 2: Aplicar + test**

MCP `apply_migration`, `name: "031_stock_alerts_view"`.

```sql
INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost)
VALUES ('t-neg-1','Test Neg',0,1,10,1,'pastelitos',0,0);
INSERT INTO public.stock_movements (id,product_id,delta,type) VALUES
  ('n1','t-neg-1', 2,'load'),
  ('n2','t-neg-1', -5,'sale');   -- vendio 5, habia 2 -> -3
DO $$
DECLARE f int;
BEGIN
  SELECT faltante INTO f FROM public.v_stock_alerts WHERE product_id='t-neg-1';
  ASSERT f = 3, 'planA: v_stock_alerts faltante esperado 3, dio ' || COALESCE(f::text,'NULL');
END $$;
DELETE FROM public.stock_movements WHERE product_id='t-neg-1';
DELETE FROM public.products WHERE id='t-neg-1';
```

Expected: no lanza.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/031_stock_alerts_view.sql supabase/tests/planA_assertions.sql
git commit -m "feat(db): v_stock_alerts view for negative stock"
```

---

## Task 8: Backfill — reproducir el estado actual

**Files:**
- Create: `supabase/migrations/032_backfill_stock_movements.sql`

**Interfaces:**
- Consumes: `products.stock`, `products.initial_stock` (las columnas REALES,
  vivas).
- Produces: por cada producto, 1 o 2 filas en `stock_movements` tal que
  `recompute_product_stock` deje `stock_computed = stock` e
  `initial_stock_computed = initial_stock` (spec §5.1a "Backfill").

- [ ] **Step 1: Escribir la migración 032**

```sql
-- Migration 032: backfill. Por producto:
--   - un 'load' con delta = initial_stock actual
--   - si stock < initial_stock: un 'count_down' con delta = stock - initial_stock
-- Con day_closes vacia, last_close_at() = -infinity, asi que TODO movimiento
-- cuenta.
--   stock_computed  = SUM(todos los delta) = initial_stock + (stock - initial_stock) = stock
--   initial_computed (pastelitos)   = SUM(delta type='load') = initial_stock
--   initial_computed (empaquetados) = SUM(delta <= t0) + SUM(load > t0)
--                                   = 0 + initial_stock = initial_stock
-- => sombra == real para ambas categorias.
BEGIN;

INSERT INTO public.stock_movements (id, product_id, delta, type, note, created_at)
SELECT
  'backfill-load-' || p.id,
  p.id,
  GREATEST(p.initial_stock, 0),
  'load',
  'backfill 032: base del dia al momento de la migracion',
  now() - interval '1 second'          -- antes que el count_down
FROM public.products p;

INSERT INTO public.stock_movements (id, product_id, delta, type, note, created_at)
SELECT
  'backfill-cd-' || p.id,
  p.id,
  p.stock - p.initial_stock,           -- negativo
  'count_down',
  'backfill 032: diferencia fisica al momento de la migracion',
  now()
FROM public.products p
WHERE p.stock < p.initial_stock;

COMMIT;
```

- [ ] **Step 2: Aplicar al proyecto dev**

MCP `apply_migration`, `name: "032_backfill_stock_movements"`. Expected: `{"success": true}`.

- [ ] **Step 3: Aserción — sombra == real para TODOS los productos**

Agregar a `planA_assertions.sql`:

```sql
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.products
   WHERE stock_computed IS DISTINCT FROM stock
      OR initial_stock_computed IS DISTINCT FROM initial_stock;
  ASSERT bad = 0,
    'planA: ' || bad || ' productos con sombra != real tras el backfill';
END $$;
```

Expected: no lanza. **Si lanza, el backfill o el recálculo están mal — parar y
revisar antes de seguir.**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/032_backfill_stock_movements.sql supabase/tests/planA_assertions.sql
git commit -m "feat(db): backfill stock_movements to match current products state"
```

---

## Task 9: Suite de aserciones completa + corrida limpia

**Files:**
- Modify: `supabase/tests/planA_assertions.sql` (encabezado + orden)

**Interfaces:**
- Produces: un `planA_assertions.sql` que corre de principio a fin sobre un
  proyecto dev recién migrado sin lanzar ninguna excepción, y deja la DB sin filas de
  prueba (`t-*`, `m*`, `b*`, `n*`).

- [ ] **Step 1: Ordenar el archivo**

Reordenar los bloques agregados en las tasks 1-8 en este orden: estructura
(1,2,3,4,5) → cálculo pastelito (6.3) → cierre (6.4) → empaquetado (6.5) →
limpieza (6.6) → alerta (7.2) → backfill sombra==real (8.3). Encabezar con:

```sql
-- planA_assertions.sql — correr entero vía execute_sql contra la RAMA de
-- desarrollo (NO produccion). Cada bloque que pasa no imprime nada; una falla
-- lanza EXCEPTION con prefijo 'planA:'. Al final no debe quedar ninguna fila
-- con id que empiece en 't-', 'm', 'b', 'n', 'backfill-'.
```

- [ ] **Step 2: Correr la suite entera**

Pegar el archivo completo en `execute_sql` contra `DEV_PROJECT_ID`.
Expected: sin error. Si alguna aserción lanza, arreglar la migración
correspondiente, re-aplicar (recrear el proyecto dev o borrar a mano las tablas 025-032), re-correr.

- [ ] **Step 3: Verificar que no quedó basura de test**

```sql
SELECT 'movimientos' AS t, count(*) FROM public.stock_movements WHERE id LIKE 't-%' OR id ~ '^[mbn][0-9]'
UNION ALL SELECT 'day_closes', count(*) FROM public.day_closes WHERE id LIKE 't-%'
UNION ALL SELECT 'debts', count(*) FROM public.debts WHERE uuid LIKE 't-%'
UNION ALL SELECT 'debt_payments', count(*) FROM public.debt_payments WHERE id LIKE 't-%'
UNION ALL SELECT 'products test', count(*) FROM public.products WHERE id LIKE 't-%';
```

Expected: todas las cuentas en 0. (Las filas `backfill-*` de `stock_movements` SÍ
quedan — son el backfill real, no test.)

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/planA_assertions.sql
git commit -m "test(db): Plan A assertion suite passes clean on a fresh branch"
```

---

## Task 10: Comparación sombra vs real sobre datos vivos (gate de Plan A)

**Files:** ninguno (verificación).

**Interfaces:**
- Consumes: (a) el proyecto dev con las 8 migraciones + backfill sobre los datos
  de ejemplo (gate en dev), y (b) producción `xttpaqokeyywjaajvjyu` DESPUÉS de
  aplicarle 025-032 (gate real sobre los datos vivos).
- Produces: evidencia de que `stock_computed == stock` e
  `initial_stock_computed == initial_stock` para los ~29 productos reales, y de
  que ninguna migración cambió una tabla que la app de producción escribe.

Nota: el gate tiene dos corridas. Primero en dev con datos de ejemplo (barato,
iterás). Cuando pasa, se aplican 025-032 a producción (son aditivas/dormidas,
la app no cambia) y se corre el mismo diff sombra-vs-real contra los 29
productos reales. Ese segundo diff en 0 es el OK definitivo.

- [ ] **Step 1: Diff sombra vs real en los productos reales**

```sql
SELECT id, name, category,
       stock, stock_computed,
       initial_stock, initial_stock_computed
  FROM public.products
 WHERE stock_computed IS DISTINCT FROM stock
    OR initial_stock_computed IS DISTINCT FROM initial_stock;
```

Expected: 0 filas.

- [ ] **Step 2: Confirmar que las columnas/t’ablas que la app escribe hoy no cambiaron**

Revisar que ninguna migración 025-032 hizo `ALTER` sobre `products.stock`,
`products.initial_stock`, `products.max`, ni agregó triggers `BEFORE`/`AFTER`
sobre `products`, `sales` (salvo columnas nuevas nulas), `debts`, `expenses`,
`replenishments`, `app_config`. Solo columnas aditivas y tablas nuevas.

Run:
```sql
SELECT tgname, tgrelid::regclass, tgenabled
  FROM pg_trigger
 WHERE NOT tgisinternal
   AND tgrelid::regclass::text IN ('public.products','public.sales','public.debts',
                                   'public.expenses','public.replenishments','public.app_config');
```
Expected: la MISMA lista que en producción antes de Plan A (comparar contra
`xttpaqokeyywjaajvjyu`). Ningún trigger nuevo.

- [ ] **Step 3: Escribir el reporte de gate**

Crear `docs/superpowers/plans/planA-shadow-report.md` con: fecha, project_id de
el DEV_PROJECT_ID, el resultado del step 1 (0 filas), el diff de triggers (sin cambios), y
la lista de migraciones aplicadas. Este archivo es el "OK para mergear Plan A a
producción" — pero el merge real y el arranque de PowerSync son Plan B.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/planA-shadow-report.md
git commit -m "docs: Plan A shadow-mode verification report"
```

---

## Self-Review

**1. Spec coverage:**
- §5 / §5.1 / §5.1a (modelo de stock) → Tasks 1, 5, 6, 8. ✔
- §5.2 (voided_at) → Task 4. La lógica cliente de "deshacer" y "editar cuenta"
  es Plan B. ✔ (acá solo las columnas)
- §5.3 (debt_payments) → Task 3. ✔
- §5.4 (day_closes) → Task 2. El cambio en `closeDayAndResetLogs()` es Plan B. ✔
- §8 (migraciones, RLS, vista de alertas, publicación para PowerSync) →
  Tasks 1-3 (RLS), 7 (vista). **La configuración de replicación/publicación de
  PowerSync se movió a Plan B** — depende de decisiones de PowerSync (sync
  rules) que no existen en Plan A. Anotado como gap deliberado.
- §9 (testing) → Tasks 9, 10 cubren la parte SQL. El harness de 2 clientes
  PowerSync es Plan B.
- §10 (rollout modo sombra) → Tasks 5 (columnas sombra) + 10 (gate). El merge a
  prod y "una tablet primero" son Plan B.

**2. Placeholder scan:** El único "a completar por el implementador" es el
ajuste de timestamps en Task 6 Step 5 (los `created_at` de los movimientos de
prueba relativos al `closed_at`). Está descrito con la solución recomendada
(usar `closed_at` fijo `'2026-09-02T20:00:00Z'` y datar los movimientos
alrededor), no es un placeholder abierto.

**3. Type consistency:**
- `stock_movements.id` es `text` (PK), consistente con `sales.uuid`/`debts.uuid`
  que son `text`. ✔
- `last_close_at()` devuelve `timestamptz`, usado como `v_t0 timestamptz` en
  `recompute_product_stock`. ✔
- `recompute_product_stock(text)` — firma consistente entre la migración 030 y
  las llamadas de los dos triggers. ✔
- Columnas sombra: `stock_computed` / `initial_stock_computed` / `max_computed`
  — mismos nombres en 029, 030, 031, y las aserciones 6.3-6.5, 8.3, 10.1. ✔

**Gap deliberado documentado:** la publicación lógica / replication slot para el
conector de PowerSync NO está en Plan A. Va en Plan B, primera task, porque su
forma depende de las sync rules (qué tablas, qué filtros) que se definen recién
ahí.

---

## Execution Handoff

Plan completo y guardado en
`docs/superpowers/plans/2026-09-02-offline-first-pos-plan-A-postgres.md`.

**Plan B** (PowerSync + reescritura del frontend) se escribe DESPUÉS de que
Plan A pase el gate de la Task 10 — así Plan B referencia el esquema real ya
aplicado.

Dos formas de ejecutar Plan A:

1. **Subagente por task (recomendado)** — un subagente fresco por task, revisión
   entre tasks. `superpowers:subagent-driven-development`.
2. **Inline** — ejecutar las tasks en esta sesión con checkpoints.
   `superpowers:executing-plans`.
