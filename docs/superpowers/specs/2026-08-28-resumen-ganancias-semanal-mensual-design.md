# Resumen de Ganancias: Semanal y Mensual con desglose por categoría

**Status:** Draft — pending user review
**Date:** 2026-08-28
**Path del skill:** brainstorming → writing-plans (siguiente paso)

## Contexto

El dueño de Casa Lucenzo quiere un resumen de rentabilidad **semanal y
mensual** que separe con claridad:

- lo que se vendió (desglosado por categoría: pasteles, bebidas, dulces),
- lo que hay que pagarle al tercero por producir los pasteles,
- los gastos del local,
- y la ganancia neta que queda.

Hoy no existe: el tab "Análisis" (`js/analytics.js`) tiene patrones
semanales, ranking de sabores y proyección, pero **no** un P&L. El PDF de
cierre de día (`exportDayCloseToPDF` en `js/ui.js:4568`) sí muestra
Ventas / Costo de producción (terceros) / Margen real, pero solo para un
día y sin navegación histórica. `renderStats` calcula
`netMarginReal = (ventas − gastos) − costo producción` pero acotado a 7
días y sin desglose.

### Datos disponibles (verificado en el código)

- **Categorías de producto**: `pastelitos`, `bebidas`, `dulces`, `otros`.
  No hay categoría "tortas" separada.
- **`sales.cost_at_sale`** (Bs): costo del tercero congelado al momento de
  la venta. Migración 019, en producción desde **2026-08-22**. Días
  anteriores tienen `cost_at_sale = 0` (o `NULL`).
- **`sales.bcv_rate`** (numeric): tasa BCV congelada por venta. Columna
  desde migración 000, persistida de verdad desde 017.
- **`sales.productId === 'abono'`**: no es mercadería, es el cobro de una
  deuda de crédito vieja. Ya se excluye del ranking y del PDF de cierre.
- **`products.cost`** (Bs): costo actual por unidad (hoy Bs.800 por
  pastelito). Se usa para *estimar* días sin dato.
- **`expenses.amount`**: gastos, en la misma moneda que se muestran los
  totales del cierre (USD).
- `fetchStatsData()` trae 7 días; `fetchDayReport(dateStr)` trae un día;
  `fetchSalesHistory(days)` trae rango amplio pero **solo**
  `product_id, name, price, timestamp` — sin `cost_at_sale`, no sirve acá.

## Decisiones del brainstorming

| Pregunta | Decisión |
|---|---|
| Fórmula principal | **Ventas − Costo terceros − Gastos = Ganancia neta** |
| Ubicación / formato | **Tab nuevo en panel admin + botón "Reporte PDF"** |
| Períodos | **Semana lun–dom + mes calendario, con navegación ‹ ›** |
| Moneda | **Ambas, $ principal + Bs al lado** |
| Detalle por categoría | **Categoría + lista completa de productos individuales** |
| Días sin costo (pre 22-ago) | **Estimar con costo actual por unidad y marcar el total** |
| Abonos | **Aparte, NO dentro de "Ventas"** — línea informativa separada |

## Enfoque

**Aprobado: Enfoque A — módulo de cálculo puro + fetch por período.**

- La matemática vive en `js/analytics.js` (módulo dependency-free ya
  cubierto por `tests/unit.test.js`), no inline en el renderer.
- Los datos se traen por rango bajo demanda (`fetchPnlData(start, end)`),
  con cache en memoria por rango. Sin fetch masivo especulativo.
- La UI reusa `activateTab()` y el patrón `panel-*` del panel admin, y el
  PDF reusa la técnica `window.print()` + `@media print` que ya usa
  `exportDayCloseToPDF` (sin librería nueva).

Alternativas descartadas: cálculo inline en `js/ui.js` (no testeable de
forma aislada, duplica lógica); fetch masivo de 5 semanas al abrir (trae
de más en el caso común y no evita el fetch al navegar a meses viejos).

## Diseño

### 1. Capa de datos — `js/supabase.js`

Nueva función `fetchPnlData(startISO, endISO)`:

- `sales` y `expenses` en paralelo (`Promise.all`).
- `client.from('sales').select('*').gte('timestamp', startISO).lt('timestamp', endISO)`
  ordenado por `timestamp` asc, paginado con `fetchAllPages` (mismo patrón
  que `fetchStatsData` — el rango mensual puede acercarse al cap de 1000).
- `expenses` igual, `select('*')` con el mismo rango.
- Normaliza `productId` desde `product_id` como hacen las otras funciones.
- Devuelve `{ sales, expenses }` crudo. **Cero lógica de negocio.**
- Se exporta en el objeto `SupabaseManager` junto a `fetchStatsData`, etc.

### 2. Capa de cálculo — `js/analytics.js`

#### 2.1 `estimateProductionCost(sales, products)`

Extrae la lógica hoy inline en `exportDayCloseToPDF` (`js/ui.js:4580–4601`)
y la generaliza a **múltiples días**:

```
para cada día local del rango:
  costoRealDia = Σ (sale.cost_at_sale || 0)  de ese día
  si costoRealDia > 0:
     usar costoRealDia (dato confiable, no tocar)
  si costoRealDia === 0 y el día tuvo ventas no-abono
     de productos con products.cost > 0:
     costoEstimadoDia = Σ product.cost  (costo ACTUAL por unidad)
     marcar ese día como estimado
```

Retorna:

```js
{
  bs: Number,             // suma total (real + estimado) en Bs
  usd: Number,            // conversión (ver §2.3)
  isEstimated: Boolean,   // true si estimatedDays > 0
  estimatedDays: Number,  // cuántos días se rellenaron
  realDays: Number
}
```

Un día que solo tuvo abonos, o solo productos con `cost === 0`, **no**
se marca como estimado (su costo 0 es correcto).

Después de crear este helper, `exportDayCloseToPDF` se reescribe para
llamarlo (una sola implementación de la estimación en todo el código).

#### 2.2 `aggregatePnl(sales, expenses, products, opts)`

`opts = { start: Date, end: Date, periodLabel: string }`.

Retorna:

```js
{
  period: { start, end, label },      // "Semana 25–31 ago 2026" / "Agosto 2026"

  totals: {
    ventasUsd,                        // Σ price de ventas NO-abono
    costoTerceros: {                  // de estimateProductionCost()
      bs, usd, isEstimated, estimatedDays
    },
    gastosUsd,                        // Σ expenses.amount
    gananciaNetaUsd                   // ventasUsd − costoTerceros.usd − gastosUsd
  },

  categorias: [                       // solo las que tuvieron movimiento
    {
      key,                            // 'pasteles' | 'bebidas' | 'dulces' | 'otros'
      label,                          // '🥐 Pasteles y Repostería', etc.
      unidades,
      ventasUsd,
      costoTercerosUsd,               // 0 salvo pasteles (y otros con cost>0)
      margenUsd,                      // ventasUsd − costoTercerosUsd
      productos: [                    // ordenado por unidades desc
        { name, unidades, ventasUsd }
      ]
    }
  ],

  abonos: { count, montoUsd },        // informativo, fuera de ventas/ganancia

  dias: [                             // para el mini-gráfico de barras
    { fecha: 'YYYY-MM-DD', ventasUsd, gastosUsd, gananciaUsd }
  ]
}
```

Reglas de categorización (mismas que `exportDayCloseToPDF`, 3+otros):

- `product.category === 'bebidas'` → `bebidas`
- `product.category === 'dulces'` → `dulces`
- `product.category === 'pastelitos'` → `pasteles`
- sin producto / `otros`: fallback por nombre — si el nombre incluye
  `malta|refresco|agua|jugo` → `bebidas`, si no → `pasteles`.
- Nombre de producto limpiado con la misma regex que ya se usa:
  `/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/`.

#### 2.3 Conversión del costo de terceros a USD

`cost_at_sale` está en Bs. Se convierte por venta:

- si `sale.bcv_rate > 0` → `cost_at_sale / sale.bcv_rate`
- si no → `cost_at_sale / (window.bcvRate || 1)` (fallback)
- para los días **estimados**, se usa `window.bcvRate` sobre el total
  estimado del día (no hay tasa histórica confiable para un día sin datos).

`window.bcvRate` se lee una vez y se pasa como parámetro a `aggregatePnl`
(el módulo se mantiene sin `window.*` en tiempo de llamada, para los tests).
Firma real: `aggregatePnl(sales, expenses, products, { start, end, periodLabel, bcvRate })`.

### 3. Semántica de períodos y casos borde

- **Semana**: lunes 00:00:00 hora local → lunes siguiente 00:00:00
  (rango `[start, end)`).
- **Mes**: día 1 00:00:00 → día 1 del mes siguiente 00:00:00.
- Navegación ‹ › mueve una semana / un mes. **No** se puede navegar a un
  período que empieza en el futuro (el período actual es el tope).
- **Período sin ventas**: la vista muestra "Sin ventas en este período";
  el PDF se puede generar igual (todo en $0).
- **Ganancia neta negativa**: se muestra en rojo, sin ocultar.
- **Banner de estimación**: si `costoTerceros.estimatedDays > 0`, banner
  ámbar arriba de la cascada:
  "Incluye N día(s) con costo de producción estimado — antes del 22 ago
  no se registraba el costo real."
- **Abonos**: nunca suman a `ventasUsd` ni al desglose por categoría.
  Solo la línea `abonos`.
- Fechas: se usa la convención de `parseTimestamp` que ya está en
  `analytics.js` (zone-less = UTC), y el agrupamiento por día es en hora
  local, igual que `aggregateSalesByDay`.

### 4. UI — panel admin

#### 4.1 Navegación

- Botón nuevo en el sidebar admin (`sistema/index.html`), **grupo
  OPERACIÓN, después de "Análisis"**. Label **"Ganancias"**, icono
  `fa-sack-dollar`. `id="admin-tab-btn-pnl"`, panel `id="admin-panel-pnl"`.
- Se engancha al `activateTab(btn, panel)` existente (`js/app.js:4332`) —
  no se toca la máquina de estados, solo se agrega el par botón/panel y su
  `getElementById` + listener junto a los otros 8.
- Rol: **solo admin** (el panel entero ya lo es).

#### 4.2 Header del panel

`[ Semana | Mes ]  ‹  Semana del 25–31 ago 2026  ›     [ 📄 Reporte PDF ]`

- Toggle Semana/Mes: mismo estilo que `btn-stats-cat-day/week`.
- Al cambiar toggle o flecha → recalcular rango → `loadPnl(range)`.

#### 4.3 Cuerpo

1. **Cascada de resultado** (tarjetas o filas):

   | | USD | Bs |
   |---|---|---|
   | Ventas de mercadería | $X | Bs X |
   | − Costo de producción (terceros)`[Estimado]` | −$X | −Bs X |
   | − Gastos del local | −$X | −Bs X |
   | **= Ganancia neta** | **$X** | **Bs X** |

2. **Mini-gráfico de barras por día** — reusa las clases `.chart-bar-row
   / .chart-bar-track / .chart-bar-fill / .chart-bar-val` que ya existen
   en `renderStats`. Barra = ventas del día; opcional overlay de ganancia.

3. **Tabla por categoría** — una fila por categoría con
   unidades / ventas $ / costo terceros / margen; click expande a la lista
   completa de productos (mismo patrón desplegable que "Ventas por
   Categoría", `category-stat-row` / `category-stat-dropdown`).

4. **Línea de abonos cobrados** — "Abonos cobrados en el período: N
   operaciones · $X" — visualmente separada, fuera del cálculo.

#### 4.4 Carga de datos

```
loadPnl(range):
  key = `${range.mode}:${range.startISO}`
  si cache.has(key): render(cache.get(key)); return
  mostrar spinner
  { sales, expenses } = await SupabaseManager.fetchPnlData(range.startISO, range.endISO)
  pnl = AnalyticsManager.aggregatePnl(sales, expenses, window.products,
        { start, end, periodLabel, bcvRate: window.bcvRate })
  cache.set(key, pnl)
  render(pnl)
```

- Cache: `Map` a nivel de módulo en `js/ui.js` (o `js/app.js`, donde viva
  el handler). Se limpia al cerrar sesión / cambiar de rol (junto con el
  resto del estado admin).
- Error de red: mensaje "No se pudo cargar el resumen, reintentá" + botón.

### 5. PDF — `js/ui.js`

`exportPnlToPDF(pnl)` nueva:

- Misma técnica que `exportDayCloseToPDF`: construye un `<div>` oculto con
  estilos `@media print`, llama `window.print()`, lo remueve después.
- Encabezado: "Casa Lucenzo — Resumen [Semanal|Mensual] — [período]",
  fecha de generación, tasa BCV usada.
- Contenido: la cascada, la tabla por categoría **con productos**, la
  línea de abonos, y el aviso de días estimados si aplica.
- Sin librería PDF (no hay ninguna cargada hoy; el patrón `window.print()`
  ya se usa en 4+ lugares).

### 6. Testing

**Unit (`tests/unit.test.js`)** — fixtures nuevas:

- `estimateProductionCost`:
  - rango todo con `cost_at_sale` real → `isEstimated: false`.
  - rango todo anterior al 22-ago → `isEstimated: true`, `estimatedDays`
    correcto, `bs` = Σ `product.cost`.
  - rango mixto que cruza el 22-ago → solo los días viejos estimados.
  - día solo-abonos → no cuenta como estimado.
  - producto con `cost: 0` → no infla el estimado.
- `aggregatePnl`:
  - totales y cascada correctos (`ganancia = ventas − terceros − gastos`).
  - abonos fuera de `ventasUsd` y del desglose.
  - categorización correcta incluyendo fallback por nombre.
  - `productos[]` ordenado por unidades desc.
  - período vacío → estructura válida con ceros.
  - margen negativo se propaga (no se hace `Math.max(0, …)`).
  - conversión Bs→USD por `sale.bcv_rate` vs. fallback.

**Manual (dev server, rol admin):**

- Abrir tab "Ganancias", togglear Semana/Mes, navegar ‹ › varios períodos.
- Cuadrar el total de una semana contra la suma de los PDF de cierre de
  esos días.
- Verificar el banner de estimación en el mes de agosto 2026 (cruza el 22).
- Generar PDF semanal y mensual; revisar que el desglose por producto
  aparezca y los números coincidan con la pantalla.
- Período sin ventas (navegar a un mes futuro-tope o uno viejo vacío).

### 7. Riesgo de despliegue

- **No** toca `js/supabase.js` en la parte de auth/RLS, ni `vercel.json`,
  ni `sw.js`, ni `api/*`. Sí toca `sistema/index.html` (markup del panel
  nuevo) y, si se agrega un archivo JS nuevo, sus `<script>` tags + el
  `APP_VERSION`/`SCRIPTS`/`?v=` que hay que mantener sincronizados (ver
  [[feedback_production_deploy_caution]] / memoria de deploy).
- **No hay migración de base de datos** — usa columnas que ya existen
  (`cost_at_sale`, `bcv_rate`). Esto lo distingue del spec del sidebar,
  que sí tenía riesgo de orden de deploy.
- El plan de implementación debe cerrar: ¿el cálculo nuevo va en
  `js/analytics.js` (ya cargado) sin archivo nuevo? Si es así, no hay
  cambio de `<script>` tags y el riesgo baja más. Preferir esa opción.
- Verificar en `casalucenzo.com` después de deploy, no solo en local
  (memoria: es un POS en vivo, dominio único).

## Fuera de alcance

- Rediseño del tab "Análisis" o del PDF de cierre de día (solo se
  refactoriza la estimación de costo a un helper compartido).
- Categoría "tortas" separada — hoy no existe y no se crea acá.
- Backfill de `cost_at_sale` en filas históricas (la estimación es en
  tiempo de lectura, nunca se escribe).
- Exportar a Excel/CSV — solo PDF.
- Comparación período contra período (ej. "este mes vs. mes pasado") —
  posible extensión futura, no en esta pasada.
- Reseñas/insights en texto (estilo `buildPerformanceInsights`) dentro del
  reporte — el pedido es números detallados, no narrativa.
