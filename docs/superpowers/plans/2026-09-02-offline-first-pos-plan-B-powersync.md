# Offline-first POS — Plan B: PowerSync + reescritura del frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox (`- [ ]`).
>
> **ESTADO: BORRADOR.** La Fase de Spikes (Task 0) tiene que completarse ANTES
> de las Tasks 1-4 y puede reformarlas. Escrito 2026-09-02 en sesión autónoma
> con la doc de PowerSync verificada por WebFetch, sin instancia PowerSync real.

**Goal:** Que el POS trabaje contra una base SQLite local sincronizada por
PowerSync con Supabase: lecturas y escrituras locales, funciona online y
offline, 2-3 dispositivos, hasta un día sin conexión.

**Architecture:** `@powersync/web` mantiene una SQLite local (OPFS) que es la
fuente de verdad para operar. Un `PowerSyncBackendConnector` sube los cambios a
Postgres vía `supabase-js`. Las lecturas del POS pasan de `client.from(...)` a
`db.getAll(...)` / `db.watch(...)` contra la SQLite local. Las escrituras pasan
a `db.execute(...)` + inserción de movimientos (Plan A ya creó las tablas
append-only). Se elimina la cola offline casera. Auth: sesión de Supabase +
PIN validado localmente.

**Tech Stack:** `@powersync/web` (SQLite WASM, OPFS VFS
`OPFSCoopSyncVFS` para multi-pestaña), `@supabase/supabase-js` (ya está),
PowerSync Cloud (plan free), Sync Streams edition 3 (YAML).

**Depende de:** Plan A aplicado a producción (migraciones 025-032). Sin eso,
las tablas `stock_movements` / `debt_payments` / `day_closes` no existen.

**Spec:** `docs/superpowers/specs/2026-09-02-offline-first-pos-design.md`
(secciones 3, 4, 6, 7, 9, 10).

## Global Constraints

- La app es JS vanilla, sin bundler (scripts sueltos en `sistema/index.html`,
  versionados con `?v=NNN`). `@powersync/web` es un paquete npm con WASM y
  workers → **hace falta un paso de build/bundle** para esa dependencia
  (esbuild/vite acotado a un `js/powersync.bundle.js`), o usar el ESM CDN de
  PowerSync si existe y la CSP lo permite. **Resolver en Spike S4.**
- `build.js` hoy solo copia archivos. Si se agrega bundling, integrarlo ahí sin
  romper el resto (los demás `js/*.js` se siguen copiando tal cual).
- Cache-bust: cualquier cambio de `js/*.js` o de los `<script>` de
  `sistema/index.html` sube `APP_VERSION` en `sw.js` + los 17 `?v=` (skill
  `verifying-production-deploys`). Nuevo archivo `js/*.js` → agregarlo también a
  `SCRIPTS` en `sw.js`.
- El service worker (`sw.js`) precachea assets. La SQLite de PowerSync vive en
  OPFS, aparte del cache del SW — no hay conflicto, pero el SW NO debe
  interceptar las requests de PowerSync al endpoint `*.powersync.com`
  (añadir a la allowlist de `fetch` del SW).
- Nada toca `main` / producción hasta el modo sombra (§10). Trabajo en
  `feature/offline-first`.
- Roles del POS: `admin`, `local` (mapea a DB role `venta`), `cocina`. Ver
  `handleUserLogin` → `mappedRole`.

---

## Task 0: Spikes (feasibility — resolver antes de seguir)

Cada spike: 2-4 h, output = una respuesta escrita en
`docs/superpowers/plans/planB-spikes.md`, no código que se conserva.

- [ ] **S1 — Primary keys que no se llaman `id`.**
  `sales.uuid`, `debts.uuid` son las PKs (text). Las tablas nuevas de Plan A
  usan `id` (text). PowerSync mapea la PK de Postgres a `id` en el cliente.
  Averiguar contra la doc/soporte de PowerSync si soporta PK con otro nombre
  (config de sync rules / `id` mapping) o si hay que:
  (a) renombrar `sales.uuid` → `id` y `debts.uuid` → `id` (migración + cambio
      en `js/supabase.js` insertSale/insertSales/upsertDebt), o
  (b) agregar una columna `id` generada = `uuid` y sincronizar por esa.
  **Recomendación tentativa:** (b) — columna `id text GENERATED ALWAYS AS (uuid) STORED`
  o un trigger, sin tocar el código que ya escribe `uuid`. Confirmar que
  PowerSync la acepta como PK del stream.

- [ ] **S2 — Ventana móvil de 60 días en un Sync Stream.**
  Las sync rules de PowerSync tienen SQL limitado (parámetros, no expresiones
  arbitrarias). Probar si
  `SELECT * FROM sales WHERE timestamp > (now() - interval '60 days')`
  es válido en un stream, o si `now()` no está permitido. Alternativas:
  (a) un parámetro del cliente `request.parameters()->>'since'` que el cliente
      calcula y manda al conectar/subscribe;
  (b) una columna `bucket_month` en `sales` y sincronizar los últimos N buckets;
  (c) aceptar sincronizar todo `sales` (2k filas hoy) y revisar en 1-2 años.
  **Definir cuál.**

- [ ] **S3 — Auth: sesión Supabase + expiración a 30 días offline.**
  El POS ya usa Supabase Auth email/password (`getCurrentSession`,
  `handleUserLogin`). `fetchCredentials()` puede devolver
  `session.access_token`. Verificar:
  (a) que el refresh token de Supabase dura ≥ 30 días con la config actual
      (Dashboard → Auth → Sessions), y ajustarlo si no;
  (b) qué pasa cuando `fetchCredentials` corre offline con el JWT vencido —
      PowerSync reintenta al reconectar; confirmar que no rompe la SQLite local;
  (c) que el `pin_hash` de `profiles` llega a la SQLite local vía sync stream
      para el login PIN offline (S2 aplica: `profiles` sincroniza entero).

- [ ] **S4 — Empaquetado de `@powersync/web` sin bundler.**
  El repo no tiene bundler. Probar: (a) `npm i @powersync/web` + un
  `esbuild js/powersync.entry.js --bundle --format=esm --outfile=js/powersync.bundle.js`
  metido en `build.js`; (b) ¿PowerSync publica un build ESM en CDN
  (jsDelivr/esm.sh) que cargue con `<script type="module">` y pase la CSP del
  sitio? Verificar los workers WASM (suelen necesitar mismo origen).
  **Output:** el enfoque de carga + los cambios a `build.js` y `sw.js`.

- [ ] **S5 — Regla de conflicto de stock en la subida.**
  El `uploadData` canónico hace `upsert`/`update`/`delete` por operación. Para
  `stock_movements` (append-only, solo INSERT/PUT) no hay conflicto. Confirmar
  que el cliente nunca emite PATCH/DELETE sobre `stock_movements`,
  `debt_payments`, `day_closes`, y que un `sale_return` es un INSERT nuevo, no
  un update. Verificar el orden: PowerSync sube transacciones en orden; una
  venta + su movimiento de stock deben ir en la misma `writeTransaction`.

**Gate de la Task 0:** `planB-spikes.md` con S1-S5 resueltos. Si S1 o S2
obligan a migraciones nuevas, se agregan como `033`, `034`… acá antes de la
Task 1.

---

## Task 1: Instancia PowerSync + publicación + rol de replicación

**Files:**
- Create: `supabase/migrations/033_powersync_replication.sql`
- Create: `docs/superpowers/plans/planB-powersync-setup.md` (pasos de dashboard)

**Interfaces:**
- Produces: publicación `powersync` en Postgres, rol `powersync_role` con
  `REPLICATION BYPASSRLS`, y una instancia PowerSync Cloud conectada a
  producción. El `POWERSYNC_URL`.

- [ ] **Step 1: Migración 033 — publicación + rol**

```sql
-- Migration 033: prerequisitos de replicación para PowerSync.
-- El rol powersync_role lo usa SOLO el servicio PowerSync para leer el WAL.
BEGIN;

DROP PUBLICATION IF EXISTS powersync;
CREATE PUBLICATION powersync FOR TABLE
    public.products,
    public.sales,
    public.debts,
    public.debt_payments,
    public.stock_movements,
    public.day_closes,
    public.replenishments,
    public.app_config,
    public.profiles;
-- NO se publican: activity_logs, bcv_rate_history, bcv_sync_log,
-- pedidos_online, whatsapp_conversations, locations (§4).

-- El password real se setea fuera de git (dashboard SQL o vault).
-- Placeholder documentado: reemplazar '<POWERSYNC_ROLE_PASSWORD>' al aplicar.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
    EXECUTE format(
      'CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD %L',
      current_setting('app.powersync_pw', true));
  END IF;
END $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;

COMMIT;
```

Nota: `current_setting('app.powersync_pw', true)` devuelve NULL si no se
seteó; en ese caso el `CREATE ROLE` falla claro. Al aplicar: primero
`SET app.powersync_pw = '<pw generado>';` en la misma sesión, o crear el rol a
mano en el SQL editor y aplicar el resto.

- [ ] **Step 2: Aplicar 033 al proyecto DEV primero** (`hvwpbhnnfggfdpztdmwo`),
  verificar `SELECT * FROM pg_publication_tables WHERE pubname='powersync'`.

- [ ] **Step 3: Crear la instancia PowerSync Cloud**
  Dashboard PowerSync → nueva instancia, región cercana a us-east-2/us-west-2.
  Database Connections → conectar a la DEV con el connection string + usuario
  `powersync_role`. Client Auth → activar "Supabase Auth". Anotar
  `POWERSYNC_URL` en `planB-powersync-setup.md`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/033_powersync_replication.sql docs/superpowers/plans/planB-powersync-setup.md
git commit -m "feat(db): PowerSync replication publication + role [planB task 1]"
```

---

## Task 2: Sync Streams (qué baja a cada dispositivo)

**Files:**
- Create: `supabase/powersync/sync-streams.yaml`

**Interfaces:**
- Consumes: el resultado de S2 (cómo se expresa la ventana de 60 días).
- Produces: la config YAML desplegada en el dashboard PowerSync. Define que
  cada dispositivo recibe: todos los `products`/`profiles`/`ingredients`/
  `app_config`; `sales`/`expenses`/`debts`/`debt_payments`/`stock_movements`
  de los últimos 60 días; `replenishments` de la última semana; `day_closes`
  últimas 10.

- [ ] **Step 1: Escribir `sync-streams.yaml`** (forma tentativa, ajustar por S2)

```yaml
config:
  edition: 3
streams:
  operacion:
    auto_subscribe: true
    queries:
      - SELECT * FROM products
      - SELECT * FROM ingredients
      - SELECT * FROM profiles
      - SELECT * FROM app_config
      - SELECT * FROM day_closes ORDER BY closed_at DESC LIMIT 10
      # ventana de 60 dias — sintaxis final segun S2:
      - SELECT * FROM sales        WHERE "timestamp" > request.parameters() ->> 'since_60d'
      - SELECT * FROM expenses     WHERE created_at  > request.parameters() ->> 'since_60d'
      - SELECT * FROM debts        WHERE "timestamp" > request.parameters() ->> 'since_60d'
      - SELECT * FROM debt_payments WHERE created_at > request.parameters() ->> 'since_60d'
      - SELECT * FROM stock_movements WHERE created_at > request.parameters() ->> 'since_60d'
      - SELECT * FROM replenishments  WHERE "timestamp" > request.parameters() ->> 'since_7d'
```

- [ ] **Step 2: Desplegar y validar en el dashboard.** Conectar un cliente de
  prueba (el demo de PowerSync o un script), confirmar que baja solo lo
  esperado.

- [ ] **Step 3: Commit**

```bash
git add supabase/powersync/sync-streams.yaml
git commit -m "feat: PowerSync sync streams config [planB task 2]"
```

---

## Task 3: Esquema cliente + PowerSyncDatabase

**Files:**
- Create: `js/powersync/schema.js` — el `Schema` de `@powersync/web`
- Create: `js/powersync/db.js` — instancia `PowerSyncDatabase` + `connect()`

**Interfaces:**
- Produces:
  - `AppSchema` (Schema) con tablas `products`, `profiles`, `app_config`,
    `sales`, `expenses`, `debts`, `debt_payments`, `stock_movements`,
    `day_closes`, `replenishments`, `ingredients`. Columnas segun el esquema de
    prod. **NO declarar `id`** (PowerSync lo agrega).
  - `window.PowerSync.db` — la instancia, `dbFilename: 'casa_lucenzo.db'`,
    `vfs: WASQLiteVFS.OPFSCoopSyncVFS`.
  - `window.PowerSync.ready` — promesa que resuelve cuando `db.hasSynced`.

- [ ] **Step 1: schema.js**

```javascript
import { column, Schema, Table } from '@powersync/web';

const products = new Table({
  name: column.text, stock: column.integer, min: column.integer,
  max: column.integer, unit: column.text, price: column.real,
  category: column.text, updated_at: column.text,
  initial_stock: column.integer, cost: column.real,
  stock_computed: column.integer, initial_stock_computed: column.integer,
  max_computed: column.integer, location_id: column.text
});

const stock_movements = new Table({
  product_id: column.text, delta: column.integer, type: column.text,
  source_uuid: column.text, device_id: column.text, created_at: column.text,
  location_id: column.text, note: column.text
}, { indexes: { by_product: ['product_id', 'created_at'] } });

// … sales, debts, debt_payments, day_closes, expenses, profiles,
//    app_config, replenishments, ingredients — mismas columnas que prod,
//    numeric -> column.real, timestamptz -> column.text, jsonb -> column.text

export const AppSchema = new Schema({
  products, stock_movements /*, … */
});
```

- [ ] **Step 2: db.js**

```javascript
import { PowerSyncDatabase, WASQLiteVFS } from '@powersync/web';
import { AppSchema } from './schema.js';
import { CasaLucenzoConnector } from './connector.js';

const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: 'casa_lucenzo.db', vfs: WASQLiteVFS.OPFSCoopSyncVFS }
});

let _resolveReady;
const ready = new Promise((r) => { _resolveReady = r; });

async function start() {
  await db.connect(new CasaLucenzoConnector());
  if (db.currentStatus?.hasSynced) _resolveReady();
  db.registerListener?.({
    statusChanged: (s) => { if (s.hasSynced) _resolveReady(); }
  });
}

window.PowerSync = { db, ready, start };
```

- [ ] **Step 3: Test** — cargar en una página en blanco con las credenciales de
  DEV, confirmar que `db.getAll('SELECT * FROM products')` devuelve los 6 seed
  tras el primer sync.

- [ ] **Step 4: Commit**

```bash
git add js/powersync/schema.js js/powersync/db.js
git commit -m "feat: PowerSync client schema + database instance [planB task 3]"
```

---

## Task 4: El connector (fetchCredentials + uploadData)

**Files:**
- Create: `js/powersync/connector.js`

**Interfaces:**
- Consumes: `window.SupabaseManager` (cliente supabase-js ya inicializado),
  `POWERSYNC_URL` (inyectado en build como `js/supabase.js` hace con la URL).
- Produces: `CasaLucenzoConnector` con `fetchCredentials()` (token de la sesión
  Supabase) y `uploadData()` (patrón canónico verificado:
  `getNextCrudTransaction` → switch `op.op` PUT/PATCH/DELETE →
  `supabase.from(op.table).upsert/update/delete` → `transaction.complete()`).

- [ ] **Step 1: connector.js** (adaptado del demo oficial `SupabaseConnector.ts`)

```javascript
import { UpdateType } from '@powersync/web';

const POWERSYNC_URL = '__POWERSYNC_URL__'; // inyectado en build.js
const FATAL = [/^22\d{3}$/, /^23\d{3}$/, /^42501$/];

export class CasaLucenzoConnector {
  async fetchCredentials() {
    const { data: { session } } =
      await window.SupabaseManager.client.auth.getSession();
    if (!session) throw new Error('Sin sesión Supabase — login requerido');
    return { endpoint: POWERSYNC_URL, token: session.access_token };
  }

  async uploadData(database) {
    const tx = await database.getNextCrudTransaction();
    if (!tx) return;
    let lastOp = null;
    const sb = window.SupabaseManager.client;
    try {
      for (const op of tx.crud) {
        lastOp = op;
        const t = sb.from(op.table);
        let res;
        if (op.op === UpdateType.PUT) {
          res = await t.upsert({ ...op.opData, id: op.id });
        } else if (op.op === UpdateType.PATCH) {
          res = await t.update(op.opData ?? {}).eq('id', op.id);
        } else if (op.op === UpdateType.DELETE) {
          res = await t.delete().eq('id', op.id);
        }
        if (res?.error) throw res.error;
      }
      await tx.complete();
    } catch (ex) {
      if (typeof ex.code === 'string' && FATAL.some((r) => r.test(ex.code))) {
        console.error('PowerSync upload — descartando tx:', lastOp, ex);
        await tx.complete();
      } else {
        throw ex; // reintento automático
      }
    }
  }
}
```

- [ ] **Step 2: Inyección de `__POWERSYNC_URL__` en `build.js`** — mismo patrón
  que `__SUPABASE_URL__` (línea ~59), con fallback hardcodeado.

- [ ] **Step 3: Test** — escribir un `stock_movements` local con
  `db.execute(...)`, verificar que aparece en Postgres DEV en unos segundos.

- [ ] **Step 4: Commit**

```bash
git add js/powersync/connector.js scripts/build.js
git commit -m "feat: PowerSync Supabase connector (auth + upload) [planB task 4]"
```

---

## Task 5-10: Reescritura del frontend (resumen — se detalla tras Task 4)

Cada una es su propia sub-plan con TDD contra la SQLite local. Orden:

- **Task 5 — Lecturas.** `js/supabase.js`: `fetchProfiles`, cargas de
  productos, `fetchDayReport` (rango ≤ 60d), `fetchPnlData` (rango ≤ 60d),
  `fetchExpensesRange`, etc. pasan de `client.from(...)` a
  `window.PowerSync.db.getAll(...)`. Las que consultan rangos > 60 días o
  `activity_logs` / stats históricos quedan contra `client.from(...)` con un
  guard "necesitás conexión". `js/app.js`: `loadAllDataFromSupabase()` pasa a
  leer de la SQLite local (o se elimina — `db.watch` alimenta las vistas).

- **Task 6 — Escrituras de venta/gasto.** `insertSale`/`insertSales`/
  `insertExpense` → `db.writeTransaction`: INSERT en `sales`/`expenses` +
  INSERT en `stock_movements` (`type='sale'`, `delta=-1`, `source_uuid`=uuid de
  la venta) por unidad, en la MISMA transacción (S5).

- **Task 7 — Auth PIN offline.** `verifyQuickPin` (hoy RPC) → función cliente
  que lee `pin_hash` / `pin_failed_attempts` / `pin_locked_until` de la SQLite
  local, compara con bcrypt (lib JS, p.ej. `bcryptjs`), y escribe los intentos
  fallidos vía `db.execute` (que sincroniza). El RPC server-side queda como
  fallback online. Regla de los 30 días: al arrancar, si
  `now() - session.expires_at` (o la última sync exitosa) > 30 días → forzar
  login email/password.

- **Task 8 — Sacar la cola vieja + `navigator.onLine`.** Borrar
  `OFFLINE_QUEUE_KEY`, `enqueueOfflineOp`, `processOfflineQueue`, los reintentos
  en `online`/`visibilitychange`. Quitar los ~25 `&& navigator.onLine` de
  lecturas/escrituras (quedan solo en los paths online-only). Indicador de
  estado de sync (de `db.onSyncStatusChanged`) que reemplaza "Actualizado
  hace X".

- **Task 9 — Cierre de jornada.** `closeDayAndResetLogs()`: en vez de
  `upsertAppConfig({lastCloseTime})` + `updateProductStock(0)` + limpiar
  `salesLog`, hace `db.execute("INSERT INTO day_closes ...")`. El stock de
  pastelitos vuelve a 0 solo (trigger de Plan A). El reporte de WhatsApp se
  arma de la SQLite local. `last_close_time` se lee como
  `MAX(day_closes.closed_at)`.

- **Task 10 — Ajustes de stock.** `adjustStock`, `applyStockLoad`,
  `applyStockCount`, la devolución al sacar del carrito, el "deshacer venta"
  (`handleUndoSale` → `UPDATE sales SET voided_at` + `stock_movements`
  `sale_return`), y editar cuenta (anular + reinsertar). Todos pasan de
  `updateProductStock(absoluto)` a insertar el `stock_movements` correspondiente.

- **Task 11 — Harness de convergencia.** Test (Node o dos contextos de browser)
  con dos `PowerSyncDatabase` (dbFilenames distintos), los dos offline, los dos
  venden la última unidad de un producto, reconectan, se verifica: las dos
  ventas están, `stock_computed` = -1, `v_stock_alerts` lista el producto.
  Extiende `tests/unit.test.js` para la lógica pura.

- **Task 12 — Modo sombra + rollout.** PowerSync corriendo en paralelo una
  semana sin que la app lo use para leer/escribir; comparar SQLite local vs
  Postgres. Después: una tablet al build nuevo, las otras en la PWA actual. Si
  limpio, el resto + se borra el código de la cola vieja.

---

## Self-Review

**Spec coverage:**
- §3 (arquitectura 3 niveles) → Tasks 1-4. ✔
- §4 (sync rules) → Task 2 + Spike S2. ✔
- §6 (auth offline) → Task 7 + Spike S3. ✔
- §7 (refactor frontend) → Tasks 5, 6, 8, 9, 10. ✔
- §9 (testing) → Task 11. ✔
- §10 (rollout) → Task 12. ✔

**Placeholders conocidos (deliberados, resueltos por spikes):**
- Sintaxis exacta de la ventana de 60d en el YAML → S2.
- Nombre de la PK (`id` vs `uuid`) → S1, puede agregar migraciones 034+.
- Empaquetado de `@powersync/web` → S4, define cambios a `build.js`/`sw.js`.
- El detalle fino de Tasks 5-10 se escribe DESPUÉS de la Task 4 (cuando el
  conector funciona y se conoce el shape real de `db`).

**Tipos:** `window.PowerSync.db` (de Task 3) usado en Tasks 5-10. `op.table` /
`op.id` / `op.op` / `op.opData` (de `getNextCrudTransaction`, verificado contra
la fuente del demo oficial) en Task 4.

---

## Execution Handoff

Este plan NO está listo para ejecutar sin antes:
1. Aplicar Plan A a producción (Task 10 Step 2 de Plan A) — requiere OK del usuario.
2. Correr la Fase de Spikes (Task 0) — puede reformar Tasks 1-4.
3. Re-detallar Tasks 5-10 con el shape real del SDK tras la Task 4.

Fuentes PowerSync verificadas: [Supabase + PowerSync](https://docs.powersync.com/integration-guides/supabase-+-powersync),
[JS Web SDK](https://docs.powersync.com/client-sdk-references/javascript-web),
[SupabaseConnector demo](https://github.com/powersync-ja/powersync-js/blob/main/demos/react-supabase-todolist/src/library/powersync/SupabaseConnector.ts).
