# Hoja de ruta de mejoras del POS

Origen: comparación con PosVen (posven.io) del 18/11/2026 y revisión del código en v1.0.51.
Regla: todo se prueba primero en el proyecto Supabase `casa-lucenzo-dev` antes de producción.

## Lo que ya tenemos (no hace falta copiarlo de PosVen)

- Caja sin internet con PowerSync (`js/powersync/`): ventas en cola que suben al volver la conexión.
- Facturas con numeración en el servidor (RPC `issue_invoice`, `void_invoice`, `renumber_invoice`…).
- Recetas (`js/recipes.js`), combos, clientes frecuentes, supervisor.
- Tasa BCV automática con historial, cierres y reportes diarios en PDF (crons de Vercel).
- App de escritorio (Electron, `desktop/`) y Android (`android/`).
- CI con tests, build y `npm audit`; workflow de respaldo (`backup.yml`).
- 52 migraciones SQL versionadas y RLS en todas las tablas.

## Mejoras de datos (por prioridad)

1. **Ventas por ticket.** `sales` guarda una fila por unidad vendida, sin cantidad, método de pago, cajero ni cliente.
   Agregar una tabla `orders` como cabecera (cliente, cajero, método de pago, descuento, total) y dejar `sales` como detalle con cantidad.
2. **Método de pago por venta** y verificación de la referencia de Pago Móvil; cierre de caja cuadrado por forma de pago.
3. **Tabla `customers`** (nombre, teléfono, cédula/RIF). Hoy `debts.client_name` es texto libre → Cuentas por Cobrar reales.
4. **Recetas que descuenten `ingredients` al vender** (verificar qué cubre hoy `recipes.js`) y den el costo real.
5. **Ficha de producto:** SKU o código de barras, foto, impuesto (exento/IVA), estado publicado/oculto, margen visible, categorías como tabla.
6. **Descuentos/promociones** con registro propio (quién, cuánto, cuándo).
7. **Catálogo digital público** desde los productos publicados, conectado a `pedido.html` y WhatsApp.
8. Detalles: tasa EUR además de USD, buscador de menú (Ctrl+K), aviso claro cuando el rol no tiene acceso.
9. `expenses` y `replenishments` están vacías en producción: usarlas (gastos/compras → utilidad real) o retirarlas.

## Mejoras de código

1. **Partir los archivos gigantes.** `js/ui.js` (~8.400 líneas) y `js/app.js` (~6.700) concentran casi todo.
   Separarlos por pantalla (caja, inventario, reportes, facturas, configuración) con módulos ES (`import`/`export`).
2. **Bundler real (Vite).** `scripts/build.js` hoy solo copia archivos: sin minificar, sin nombres con hash,
   y supabase-js, bcryptjs y Sentry se cargan desde CDN sin `integrity`. Vite resolvería las tres cosas.
3. **Validar la venta en el servidor.** El precio y el total de cada venta deberían comprobarse en Postgres
   (trigger o RPC) contra `products`, igual que ya se hace con las facturas y el guard de precios (migración 038).
4. **Componentes gradualmente** (Vue 3, como PosVen, o React), empezando por la pantalla de caja, una vez hechos 1 y 2.
5. **TypeScript o JSDoc con `// @ts-check`** para detectar errores de tipos antes de publicar.
6. **Separar caja y panel de administración** (PosVen usa `app.posven.io` para la caja y `posven.io` para el panel).
7. **Repositorio público:** valorar pasarlo a privado. La anon key es pública por diseño, pero el esquema,
   la lógica de negocio y las herramientas de `tools/` quedan a la vista de cualquiera.

Orden sugerido: código 1–3 y datos 1–3 primero; luego componentes junto con el rediseño de la caja.
