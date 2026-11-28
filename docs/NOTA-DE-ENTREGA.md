# Nota de entrega (despacho a cliente)

Pedido de Gustavo, 2026-11-28. Implementada por Claude en v1.0.67.

Archivos: `supabase/migrations/054_delivery_notes.sql` (+ `supabase/tests/054_delivery_notes.sql`),
`js/delivery-note.js` (dibujo del PDF), `js/ui/notas-entrega.js` (pantallas de la caja),
`js/supabase.js` (llamadas) y `tests/delivery-note.test.js`.

## Para qué

Cuando se le entrega mercancía a un cliente (encargo, pedido, delivery o
venta a crédito), la caja imprime una **nota de entrega** numerada. El
cliente (o quien recibe) la firma, y Casa Lucenzo se queda con la copia
firmada como prueba de que recibió lo que dice ahí.

- Sale en **PDF para imprimir y firmar** (carta, con original y copia).
- **No es una factura**: lleva la leyenda "Documento sin valor fiscal".
  Si el cliente necesita factura, se emite aparte con lo que ya existe
  (`issue_invoice`). Gustavo debe confirmar con su contador si hace falta
  algún dato más para su caso.
- **No mueve stock.** El stock ya lo descuenta la venta. La nota solo
  documenta la entrega.

## Alcance

### Fase 1 (esta)

1. Emitir una nota desde una **cuenta cobrada** (ventas agrupadas por
   `timestamp`, igual que la factura). Sirve también para ventas a crédito,
   que ya quedan registradas como venta.
2. Emitir una nota desde un **pedido en línea** confirmado
   (`pedidos_online`), con la dirección de delivery si la tiene.
3. Reimprimir: pedir la nota de la misma venta o pedido devuelve **la misma
   nota**, nunca un número nuevo.
4. Marcar la nota como **entregada**: quién recibió, su cédula y la hora.
5. **Anular** (solo admin), con motivo. El número no se reusa.
6. Lista de notas en la caja, con buscador por N°, cliente o fecha.

### Fuera de esta fase

- Nota "manual" sin venta ni pedido detrás (abre la puerta a sacar
  mercancía sin registrar la venta; si se quiere, se diseña aparte con su
  movimiento de stock).
- Firma digital en pantalla, envío por Telegram, verificación pública con QR.

## Base de datos — migración `054_delivery_notes.sql`

Probar primero en `casa-lucenzo-dev`. **No aplicar en producción sin la
aprobación de Gustavo.**

### Tablas

```sql
CREATE TABLE public.delivery_note_counters (
    location_id uuid PRIMARY KEY REFERENCES public.locations(id),
    next_number integer NOT NULL CHECK (next_number > 0)
);
-- Arranca en 1 para el local principal. RLS activado, sin políticas.

CREATE TABLE public.delivery_notes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                    REFERENCES public.locations(id),
    number          integer NOT NULL,
    source          text NOT NULL CHECK (source IN ('venta', 'pedido')),
    sale_timestamp  timestamptz,          -- si source = 'venta'
    pedido_id       uuid REFERENCES public.pedidos_online(id), -- si source = 'pedido'
    client_name     text NOT NULL,
    client_rif      text,                 -- cédula/RIF, opcional
    client_phone    text,
    delivery_address   text,
    delivery_reference text,
    items           jsonb NOT NULL,       -- [{desc, qty, price, total}] copia fija
    total_usd       numeric(14,2) NOT NULL,
    bcv_rate        numeric(14,4),
    total_bs        numeric(16,2),
    show_prices     boolean NOT NULL DEFAULT true,
    notes           text,                 -- observaciones (máx. 300)
    status          text NOT NULL DEFAULT 'emitida'
                    CHECK (status IN ('emitida', 'entregada', 'anulada')),
    received_by_name text,
    received_by_rif  text,
    delivered_at     timestamptz,
    void_reason      text,
    issued_at       timestamptz NOT NULL DEFAULT now(),
    issued_by       uuid DEFAULT auth.uid(),
    UNIQUE (location_id, number),
    UNIQUE (location_id, sale_timestamp),
    UNIQUE (location_id, pedido_id),
    CHECK ((source = 'venta'  AND sale_timestamp IS NOT NULL AND pedido_id IS NULL)
        OR (source = 'pedido' AND pedido_id IS NOT NULL AND sale_timestamp IS NULL))
);
CREATE INDEX idx_delivery_notes_issued_at ON public.delivery_notes (issued_at DESC);
```

- RLS: `admin` y `venta` **leen** las notas de su local
  (`get_user_location()`), igual que `invoices`. Nadie inserta ni edita
  directo: todo pasa por las funciones de abajo.
- `GRANT` explícito a `authenticated` y `service_role` (Supabase ya no lo da
  solo a tablas nuevas, ver migración 045).

### Funciones (todas `SECURITY DEFINER`, `SET search_path = ''`)

**`issue_delivery_note(p_source text, p_sale_timestamp timestamptz, p_pedido_id uuid, p_client_name text, p_client_rif text, p_client_phone text, p_show_prices boolean, p_notes text, p_bcv_rate numeric) RETURNS jsonb`**

- Solo `admin` o `venta`.
- Si ya hay nota para esa venta o pedido, la devuelve tal cual (reimpresión).
- **Los productos los saca la base, no el cliente** (a diferencia de la
  factura, que recibe `p_items`):
  - `venta`: lee `public.sales` del local con ese `timestamp`, con
    `voided_at IS NULL` (migración 028), agrupa por producto y suma
    cantidad y total. Si no hay filas, error "No se encontró la venta".
  - `pedido`: lee `pedidos_online.items` y exige `status = 'confirmado'`.
    Copia `delivery_address`, `delivery_reference`, `customer_name` y
    `customer_phone` si no vienen en los parámetros.
- `client_name` obligatorio (máx. 200). Si viene vacío en una venta, usar
  "Cliente".
- Número: `UPDATE delivery_note_counters ... RETURNING` en la misma
  transacción, como en la 039, para que no queden huecos.
- `total_bs = round(total_usd * p_bcv_rate, 2)` si hay tasa.
- Devuelve la fila como JSON (lo que dibuja el PDF).

**`mark_delivery_note_delivered(p_id uuid, p_received_by_name text, p_received_by_rif text) RETURNS jsonb`**

- `admin` o `venta`. Solo si está `emitida`. Guarda `delivered_at = now()`.

**`void_delivery_note(p_id uuid, p_reason text) RETURNS jsonb`**

- Solo `admin`. Motivo obligatorio. No toca la venta ni el stock.

`REVOKE ALL ... FROM PUBLIC, anon` y `GRANT EXECUTE ... TO authenticated`
en las tres.

Ninguna de estas funciones toca `sales` ni tiene triggers sobre `sales`,
así que la regla 2 de `AGENTS.md` (nunca rechazar ventas) no corre peligro.

### Pruebas SQL — `supabase/tests/054_delivery_notes.sql`

- Dos llamadas para la misma venta → mismo número.
- Venta inexistente → error. Pedido `pendiente` → error.
- Rol `cocina` → error. `anon` no puede ejecutar.
- Correlativo seguido sin huecos aunque una emisión falle.
- `venta` no puede anular; `admin` sí.

## Frontend

### `js/delivery-note.js` (nuevo)

Mismo patrón que `js/invoice.js`: módulo autocontenido que expone
`window.DeliveryNote = { render, mount, print, fmtNumber }`, sin depender
del ámbito global de `js/app/`. Reusar `COMPANY` de `window.InvoiceRenderer` en vez
de copiar los datos de la empresa.

Si se carga en `sistema/index.html`, agregarlo también a `SCRIPTS` en
`sw.js` (y a `APP_FILES` en `js/app/index.js` solo si va dentro de
`js/app/` o `js/ui/`). Correr `tests/script-order.test.js`.

### Diseño del PDF (hoja carta, `window.print()`)

La hoja carta se divide en dos mitades iguales con línea de corte:
**ORIGINAL – CLIENTE** arriba y **COPIA – CASA LUCENZO** abajo. Cada
mitad lleva:

1. Logo, razón social, RIF, dirección y teléfono (de `InvoiceRenderer.COMPANY`).
2. Título **NOTA DE ENTREGA**, **N° NE-000001** (6 dígitos) y fecha y hora
   de emisión en hora de Venezuela (`America/Caracas`).
3. Cliente: nombre, cédula/RIF, teléfono y, si hay, dirección y punto de
   referencia del delivery.
4. Tabla: Cant. | Descripción | P. unit. | Total. Con `show_prices = false`
   solo Cant. y Descripción.
5. Total en $ y en Bs (con la tasa usada), si muestra precios.
6. Observaciones.
7. Firmas, dos casillas: **Entregado por** y **Recibido conforme**
   (nombre, C.I., firma, fecha y hora). Si la nota ya está entregada, los
   datos de quien recibió salen impresos.
8. Pie: "Documento sin valor fiscal. La factura, si corresponde, se emite
   por separado."
9. Si está anulada: marca de agua "ANULADA".

Si la lista no cabe en media hoja (más de unos 12 productos), imprimir
original y copia en hojas separadas en vez de achicar la letra.

### Dónde aparece en la caja

- Botón **"Nota de entrega"** junto al de factura en
  `js/ui/historial.js`, `js/ui/cobro-facturas.js` y el detalle de cuentas
  de `js/ui/cierre.js`.
- Botón **"Nota de entrega"** en cada pedido confirmado de la pestaña
  Pedidos (`js/ui/fiados-pedidos.js`).
- Al tocarlo: formulario corto (nombre y cédula prellenados con
  `ClientesFrecuentes` si existe, teléfono, casilla "Mostrar precios",
  observaciones) → `issue_delivery_note` → vista previa → Imprimir.
- Lista **"Notas de entrega"** (botón en Historial y en Pedidos): N°, fecha, cliente, total y estado, con
  botones Reimprimir, Marcar entregada y Anular (este último solo admin).
- Todo requiere internet (sin PowerSync desde v1.0.65). Si no hay conexión,
  avisar "Necesitas internet para emitir la nota" y no dejar el botón
  colgado.

### Tests de Node — `tests/delivery-note.test.js`

- `render` con precios y sin precios.
- Formato del número `NE-000001`.
- Fecha en hora de Venezuela aunque el equipo esté en otra zona.
- Escapa HTML en nombre, observaciones y descripción.
- Nota anulada lleva la marca.

## Para cerrar el PR

- `npm test` y `npx eslint .` en verde.
- Probar en `/sistema/` contra `casa-lucenzo-dev`: emitir, reimprimir,
  marcar entregada, anular, imprimir a PDF desde PC y desde teléfono.
- Subir la versión en `package.json`.
- Pedir a Gustavo que apruebe la migración antes de aplicarla en
  producción.
