# Offline-first POS — Fase 1 (diseño)

**Fecha:** 2026-09-02
**Estado:** aprobado para pasar a plan de implementación
**Alcance:** Fase 1 de un roadmap de 4. Esta fase deja el POS web funcionando
offline-first con sincronización multi-dispositivo. Las fases 2-4 (empaquetado
Capacitor / APK, impresora térmica ESC/POS, app de escritorio Tauri) NO son
parte de este spec — se construyen encima de esto, ya andando.

---

## 1. Problema

El POS de Casa Lucenzo (hoy PWA en `casalucenzo.com`, Supabase + JS vanilla)
asume que hay internet. Al arrancar hace `loadAllDataFromSupabase()`; hay ~25
lugares con guards `&& navigator.onLine` que apagan funciones en silencio sin
conexión. Existe una cola de escritura (`OFFLINE_QUEUE_KEY` en localStorage,
`enqueueOfflineOp`/`processOfflineQueue`, TTL 48h) pero es solo una cola de
escritura, no una arquitectura offline-first: las lecturas siguen necesitando
red y no hay base local.

El local necesita operar **un día entero sin internet, con 2-3 dispositivos en
paralelo editando estado compartido** (stock, gastos, deudas).

## 2. Requisitos (decididos con el dueño)

| # | Decisión |
|---|----------|
| R1 | **Concurrencia:** 2-3 dispositivos vendiendo en paralelo, offline hasta un día entero, editando stock/gastos/deudas compartidos. |
| R2 | **Alcance offline:** vender, ajustar stock, registrar gastos, cerrar jornada, cuentas y deudas de clientes. **Online-only:** reportes históricos, alta/baja de usuarios, cambio de precios y costos. |
| R3 | **Regla de conflicto:** las ventas nunca se rechazan (append-only). El stock puede quedar negativo → alerta al admin, no bloqueo. |
| R4 | **Motor de sync:** PowerSync (conector oficial de Supabase). |
| R5 | **Ventana de historial en el dispositivo:** 60 días para `sales` y `expenses`. Lo anterior se ve online. |
| R6 | **Bitácora offline:** `activity_logs` se escribe local y se sube al reconectar; el historial NO baja al dispositivo. |
| R7 | **Modelo de escritura:** "guardar lo que pasó, no el resultado" — 4 cambios (sección 5). |
| R8 | **Auth offline:** alta del dispositivo una vez online → desbloqueo por PIN validado localmente → refresco de token automático. Máximo **30 días** offline antes de exigir login completo. |
| R9 | **Lanzamiento:** rama aparte → modo sombra 1 semana → una tablet real 1 semana → resto. Sin big-bang. |

## 3. Arquitectura de 3 niveles

```
Nivel 1 — cada dispositivo (tablet / PC)
  SQLite local (PowerSync SDK; OPFS en web, nativo en Capacitor)
  = fuente de verdad para OPERAR. El POS lee y escribe SIEMPRE contra esta base.
  La UI nunca espera red.
        ↕  (PowerSync sincroniza en segundo plano cuando hay internet)
Nivel 2 — PowerSync (servicio gestionado, plan gratis alcanza)
  Baja filas de Postgres a cada dispositivo según sync rules.
  Sube cambios locales a Postgres al reconectar.
  Si PowerSync o internet se caen: los dispositivos siguen operando; solo se
  pausa la sincronización.
        ↕
Nivel 3 — Supabase Postgres (base maestra)
  Verdad final. Corren los triggers (tasa BCV, historial, costos) y el cron.
  Reportes históricos y gestión admin leen directo de acá (online-only).
```

**Quién manda:**
- Operar (vender, ver stock, cobrar, gastos, cierre, deudas): la SQLite local.
- Verdad final (reportes, auditoría, tasa BCV, consolidado): Postgres.

**Flujo de una venta offline:**
1. Se cobra → INSERT en SQLite local → la UI ya lo muestra (0 espera).
2. PowerSync encola el cambio.
3. Vuelve internet → PowerSync sube a Postgres → corren los triggers
   (`fill_missing_sale_bcv_rate`, `fill_missing_sale_cost`, etc.).
4. PowerSync baja la versión confirmada a los otros dispositivos.

## 4. Reglas de sincronización

**Bajan al dispositivo (funcionan offline):**

| Tabla | Qué baja |
|-------|----------|
| `products` | todo (~29 filas) |
| `ingredients` | todo (~5 filas) |
| `profiles` | todo (~3 filas) — incluye `pin_hash` para el login offline |
| `app_config` | la fila única (`id = 1`) — tasa BCV, PINs, `last_close_time` |
| `sales` | ventana móvil: `timestamp >= now() - 60 días` |
| `expenses` | ventana móvil: 60 días |
| `debts` | abiertas + cerradas de los últimos 60 días |
| `debt_payments` | (tabla nueva) mismos 60 días |
| `stock_movements` | (tabla nueva) desde el último `day_close` para pastelitos; 60 días para el resto |
| `replenishments` | día en curso + 7 días previos |
| `day_closes` | (tabla nueva) últimas ~10 filas |

**Online-only (no bajan; requieren internet):**

| Tabla | Motivo |
|-------|--------|
| `activity_logs` | se escribe local y se sube; el historial se ve solo online |
| `bcv_rate_history`, `bcv_sync_log` | los maneja el cron del servidor |
| `pedidos_online` | pedidos de clientes por la web |
| `whatsapp_conversations` | el bot |
| Reportes históricos / stats | consultas agregadas directas a Postgres |

**Regla general:** baja lo necesario para operar un día; queda online lo
histórico, lo administrativo y lo que maneja el servidor. Cada dispositivo
carga unos pocos miles de filas.

## 5. Modelo de escritura — "guardar lo que pasó"

El código de hoy guarda el valor final (`updateProductStock(id, 4)`). Con 2-3
dispositivos offline eso se pisa al sincronizar y se pierden restas. La regla
nueva: cada dispositivo **solo agrega hechos, nunca pisa**; el total se calcula
sumando. Cuatro cambios:

### 5.1 Stock → `stock_movements` (append-only)

- Tabla nueva: `stock_movements (id uuid pk, product_id, delta int, type, source_uuid, created_at, device_id)`.
  `type ∈ {sale, replenishment, adjustment, void}`.
- Cada línea de venta inserta `delta = -cantidad, type = 'sale', source_uuid = <sale uuid>`.
- Cada carga de cocina: `delta = +N, type = 'replenishment'`.
- Ajuste manual: `delta = ±N, type = 'adjustment'`.
- `products.stock` deja de escribirse desde el dispositivo. Pasa a ser **cache
  calculado por Postgres** (trigger sobre `stock_movements`):
  - Productos categoría `pastelitos`: `stock = Σ delta WHERE created_at > último day_close`,
    donde "último day_close" = `MAX(day_closes.closed_at)` (ver 5.4).
  - Productos empaquetados (`bebidas`, `dulces`): `stock = Σ delta` (todo el historial).
- **`day_closes` es un marcador de frontera, no genera un movimiento
  compensatorio.** Una venta que sincroniza tarde (de antes del cierre) cuenta
  para el reporte de ese día cerrado pero no afecta el stock de hoy, porque su
  `created_at` cae antes de la frontera.
- El stock puede dar negativo → el trigger/edge deja una fila en una vista de
  alertas para el admin ("se vendió N de más de X").

### 5.2 Anular venta → `voided_at` (no `DELETE`)

- Columna nueva `sales.voided_at timestamptz` + `sales.void_reason text`.
- "Deshacer" = `UPDATE sales SET voided_at = now(), void_reason = ...` + un
  `stock_movements` de tipo `void` con `delta = +cantidad`.
- Los reportes y el cálculo de caja ignoran filas con `voided_at IS NOT NULL`.
- **Nunca se hace `DELETE` de una fila ya sincronizada.** Se retiran del código
  `deleteSale`, `deleteSales`, `deleteSalesByTimestamp` (o quedan solo para
  paths de mantenimiento server-side).

### 5.3 Deudas → `debt_payments` (append-only)

- Tabla nueva: `debt_payments (id uuid pk, debt_id, amount, method, created_at, device_id)`.
- La deuda no guarda saldo. `saldo = debts.total - Σ debt_payments.amount`.
- Dos dispositivos cobrando abonos del mismo cliente offline: entran los dos,
  el saldo baja bien.

### 5.4 Cierre de jornada → `day_closes` (append-only)

- Tabla nueva: `day_closes (id uuid pk, closed_at, device_id, totals jsonb)`.
- Cada cierre es una fila. `app_config.last_close_time` (o una vista) =
  `MAX(closed_at)`.
- Dos dispositivos cierran offline = dos filas; gana la más nueva; sin romperse.
- El reset de stock de pastelitos ya no necesita escritura: por 5.1, el stock
  de pastelitos se calcula desde el último `day_close`, así que al aparecer la
  fila de cierre el stock "se resetea" solo.
- `closeDayAndResetLogs()` deja de borrar `salesLog`/`expenses` y de escribir
  `products.stock`; solo inserta la fila en `day_closes`.

### 5.5 Sin cambios

`sales` y `expenses` ya son append-only (fila nueva con UUID propio por venta /
gasto). No se tocan. Por eso nunca tuvieron conflictos.

## 6. Autenticación offline

**Tres momentos:**

1. **Alta del dispositivo** (una vez, con internet): un admin entra con correo +
   contraseña. Se guarda el refresh token de larga vida de Supabase de forma
   segura en el dispositivo (Capacitor Secure Storage en Fase 2; en la web,
   el storage de sesión de Supabase).
2. **Uso diario** (online u offline, igual): desbloqueo por **PIN validado
   localmente** contra `profiles.pin_hash` que PowerSync ya replicó a la SQLite.
   El lockout por 3 intentos fallidos (`pin_failed_attempts` /
   `pin_locked_until`) pasa a evaluarse local. Cero red.
   - La función `verify_quick_pin` (hoy RPC SECURITY DEFINER) se replica como
     lógica cliente sobre la SQLite local; el RPC server-side queda como
     fallback online.
3. **Sincronizar** (al volver internet): el JWT venció (~1h) pero el refresh
   token no. La app renueva la sesión sola y PowerSync sincroniza.

**PowerSync auth:** token derivado de la sesión de Supabase, refrescado
automáticamente online. PowerSync usa su conector de Supabase (JWT del usuario).

**Bordes:**
- Offline un día / de noche online / repetir: transparente.
- Requiere volver a entrar con contraseña si: el dispositivo estuvo **> 30
  días** offline (refresh token vencido, y regla explícita de la app), un admin
  desactivó al usuario (`profiles.active = false`, se aplica al sincronizar), o
  se borró el storage del dispositivo.

**Seguridad — dispositivo perdido:** el admin desactiva al usuario / dispositivo
desde el panel; se aplica apenas ese dispositivo toca internet. El lockout por
PIN sigue activo. El límite de 30 días acota la ventana de una tablet perdida
que nunca se reconecta.

## 7. Refactor del frontend

1. **Capa de datos** (`js/supabase.js`, el grueso): las funciones de lectura
   (`fetchProfiles`, `fetchDayReport`, cargas de productos, `fetchPnlData` para
   los rangos que caen dentro de 60 días, etc.) pasan de `client.from(...)` a
   consultar la SQLite local de PowerSync. Las de escritura pasan de `.upsert()`
   a `INSERT`/`UPDATE` en la SQLite local.
2. **Se elimina la cola offline actual**: `OFFLINE_QUEUE_KEY`, `enqueueOfflineOp`,
   `processOfflineQueue`, la lógica de TTL de 48h, y los reintentos en
   `online`/`visibilitychange`. PowerSync lo reemplaza entero.
3. **Se retiran los ~25 `&& navigator.onLine`**: lecturas y escrituras funcionan
   siempre. Un indicador de estado de sync (sincronizado / pendiente / offline)
   reemplaza el "Actualizado hace X".
4. **Reportes online-only** (`aggregatePnl` sobre rangos > 60 días, stats,
   bitácora, gestión de usuarios/precios): siguen consultando Postgres directo,
   con un mensaje claro de "necesitás conexión" cuando no hay red.
5. **Storage**: se pasa de localStorage (límite ~5 MB, síncrono) a SQLite vía
   PowerSync. ~3-5k filas por dispositivo = trivial.

## 8. Cambios en Postgres (migraciones)

- Tablas nuevas: `stock_movements`, `debt_payments`, `day_closes`.
- Columnas nuevas: `sales.voided_at`, `sales.void_reason`.
- Trigger: recalcular `products.stock` desde `stock_movements` (con la lógica
  pastelitos-desde-último-cierre vs empaquetados-histórico de 5.1).
- Vista de alertas de stock negativo para el admin.
- **RLS en todas las tablas nuevas** (mismo patrón que las existentes: lectura
  por rol, escritura por venta/cocina/admin). PowerSync define qué baja; RLS
  sigue validando en la subida.
- Publicación lógica / configuración que PowerSync necesita para el conector de
  Supabase (replication slot).

## 9. Testing

- **Unit** (extiende `tests/unit.test.js`): funciones puras de agregación —
  `stock = Σ movimientos` (con la frontera de cierre), `saldo = total − abonos`,
  `last_close = MAX(closed_at)`. Igual que los tests de `aggregatePnl`.
- **Integración**: dos clientes PowerSync en un harness — los dos offline, los
  dos escriben (ventas + movimientos de stock del mismo producto), reconectan,
  se verifica convergencia y que ninguna venta se perdió.
- **Manual**: dos pestañas / dos dispositivos en modo avión → vender en ambos →
  reconectar → chequear que el stock cierra, que el negativo dispara alerta, y
  que las dos ventas están.

## 10. Lanzamiento

1. **Rama aparte.** Nada toca producción hasta el final.
2. **Modo sombra** (~1 semana): PowerSync sincroniza en segundo plano; la app
   sigue leyendo/escribiendo como hoy. Se compara que los datos coincidan.
3. **Una tablet real** al build nuevo (~1 semana). Las otras 2 siguen en la PWA
   de producción actual.
4. Si sale limpio → las otras tablets. Recién ahí se retira el código de la cola
   vieja y se hace la limpieza final.

## 11. Esfuerzo

El cambio más grande al código desde el inicio del proyecto. Semanas de trabajo
cuidadoso: migraciones (~1 día), setup PowerSync + sync rules + conector (~1
día), reescritura de la capa de datos (varios días, el grueso), retiro de
`navigator.onLine` + UI de estado (~1-2 días), harness de tests (~1-2 días),
modo sombra + rollout (~2 semanas de calendario, poco trabajo activo).

## 12. Fuera de alcance (fases siguientes)

- **Fase 2:** wrapper Capacitor → APK Android que abre aunque `casalucenzo.com`
  esté caído (assets empaquetados en el APK).
- **Fase 3:** impresora térmica ESC/POS (plugin Bluetooth de Capacitor) para el
  ticket que hoy va a WhatsApp/PDF.
- **Fase 4:** app de escritorio Windows (Tauri o Capacitor-Electron), mismo
  frontend, instalador `.exe`.

## 13. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| PowerSync es otro SaaS en la cadena (ya hay Supabase + Vercel). Riesgo de precio/continuidad. | La app opera offline si PowerSync se cae. El plan gratis alcanza para años a esta escala. Reevaluable — el modelo de datos append-only es portable a otro motor de sync. |
| El refactor de `js/supabase.js` es grande y toca el corazón del POS. | Modo sombra + una tablet primero. Rama aislada. Tests de convergencia antes de tocar prod. |
| La lógica de stock (pastelitos vs empaquetados, frontera de cierre) es sutil. | Tests unit dedicados a esa lógica antes de escribir nada de UI. |
| Login offline con PIN = tablet robada operable hasta sincronizar. | Desactivación remota (se aplica al reconectar) + límite de 30 días + lockout por PIN. |
| Interacción sync rules ↔ RLS mal configurada expone o esconde filas. | RLS explícita en tablas nuevas; test manual por rol (venta / cocina / admin) en modo sombra. |
