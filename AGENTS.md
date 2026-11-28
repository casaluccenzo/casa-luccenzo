# Casa Lucenzo — guía para agentes de IA

Lo leen Antigravity (Google), Cursor, Claude Code y otros agentes al abrir el
repo. Dueño: Gustavo Beberaggi. Idioma del proyecto: **español** (código,
comentarios, commits, PR y mensajes al usuario).

## Qué es

POS (punto de venta) e inventario de una panadería venezolana de pastelitos.
PWA que funciona sin internet. Lo usan la caja, la cocina y el admin.

- Web: https://www.casalucenzo.com (landing) y `/sistema/` (el POS).
- El mismo código sirve a otro negocio, El Puño Guayanés (variable `BRAND`).
- Escritorio Windows (Electron, `desktop/`) y Android (TWA, `android/`).

## Arquitectura

- **Frontend sin framework**: HTML + CSS + JavaScript en scripts clásicos.
  Sin bundler: `scripts/build.js` solo copia a `www/` e inyecta la versión.
- **Supabase** (Postgres + Auth + RLS). Producción: proyecto `Casa Lucenzo`
  (`xttpaqokeyywjaajvjyu`). Pruebas: `casa-lucenzo-dev`
  (`kzthbjjfguivguppqeuq`), pausado por defecto.
- **Sin PowerSync** (quitado en v1.0.65): todas las cajas leen y escriben
  directo en Supabase. Necesitan internet para guardar.
- **Vercel**: hosting y funciones en `api/` (PDF de cierre, crons, bots de
  WhatsApp/Telegram, Gemini).
- **Precios en Bs y $**: tasa BCV automática (`js/exchange-rate.js`).
  `products.price_bs` = precio fijo en bolívares; si no hay, `products.price` en $.

## Mapa de carpetas

| Ruta | Qué hay |
|---|---|
| `sistema/index.html` | El POS. Carga todos los scripts **en orden**. |
| `js/app/*.js` | Lógica (antes `js/app.js`): estado, carrito, ventas, inventario, finanzas, fiados-pedidos, cierre, productos, datos, sesion, bcv, init, admin. |
| `js/ui/*.js` | Interfaz por pantalla (antes `js/ui.js`). `ui-manager.js` arma `window.UIManager`. |
| `js/app/index.js` | Solo para Node: une `js/app/` para los tests. El navegador no lo carga. |
| `js/supabase.js` | Acceso a Supabase (`window.SupabaseManager`). |
| `js/combos.js` | Combos, promo, consumo del personal, delivery, extras. |
| `js/sales.js`, `inventory.js`, `auth.js`, `analytics.js`… | Módulos con lógica testeable. |
| `api/`, `lib/` | Funciones de Vercel y su lógica compartida (Node). |
| `supabase/migrations/` | Migraciones SQL numeradas (`NNN_nombre.sql`). |
| `supabase/tests/` | Pruebas SQL para correr en dev. |
| `tests/` | Tests de Node (`npm test`). |
| `docs/MEJORAS-POS.md` | Hoja de ruta de mejoras (PR #105). |
| `docs/NOTA-DE-ENTREGA.md` | Especificación de la nota de entrega (pendiente de implementar). |
| `docs/backups.md` | Copias de seguridad y cómo restaurarlas. |

## Reglas importantes

1. **`js/app/` y `js/ui/` comparten el ámbito global.** No usan
   `import`/`export`: una función de `js/app/carrito.js` se llama desde
   `js/app/init.js` sin importarla. El orden de carga importa y está escrito
   en tres lugares que deben coincidir: `sistema/index.html`, `sw.js`
   (lista `SCRIPTS`) y `js/app/index.js` (`APP_FILES`).
   `tests/script-order.test.js` lo comprueba. Archivo nuevo en esas carpetas
   = agregarlo en los tres.
2. **Nunca rechazar ventas en el servidor.** Si un trigger de `sales` lanza
   un error, esa venta no se guarda. Validar = anotar (ver migración 050 `sale_price_alerts`), no
   bloquear. Los triggers de `sales` deben atrapar sus propios errores.
3. **Stock**: nunca escribir `products.stock` a mano. La verdad es
   `stock_movements` y un trigger recalcula `stock_computed` (migración 030).
4. **Precios de combos**: si cambias un número en `js/combos.js`, cambia
   también la migración que lo copia (hoy la 050) en una migración nueva.
   `tests/sale-price-rules.test.js` falla si no coinciden.
5. **Base de datos**: probar migraciones primero en `casa-lucenzo-dev`.
   **No aplicar nada en producción sin que Gustavo lo apruebe.** Una
   migración nueva va en un archivo nuevo con el siguiente número; nunca
   editar una migración ya aplicada. Usar `SET search_path = ''` en funciones
   y RLS en tablas nuevas (`get_user_role()` / `get_user_location()`).
6. **El repo es público.** Nunca commitear claves, `.env`, datos de clientes
   ni copias de la base sin cifrar. La anon key de Supabase es pública por
   diseño; la service key no.
7. **Roles**: `admin`, `venta` (caja), `cocina`. RLS en todas las tablas,
   filtrando por `location_id`.
8. **Versión**: `package.json` es la única fuente (`__APP_VERSION__` se
   inyecta en el build). Subirla al publicar para que el service worker
   renueve la caché de las cajas.

## Comandos

```bash
npm ci            # dependencias
npm run dev       # http://localhost:4173/sistema/ (sin Supabase real: modo local)
npm test          # tests de Node (deben pasar antes de cada PR)
npx eslint .      # lint (debe quedar sin avisos)
npm run build     # genera www/
```

`?test=true` en la URL aísla los datos locales para pruebas manuales.

## Forma de trabajo

- Ramas + Pull Request a `main`; Vercel publica `main` solo.
- CI: `.github/workflows/` corre tests y build en cada PR.
- Antes de un PR: `npm test` y `npx eslint .` en verde, y probar `/sistema/`
  en el navegador.
- Commits y PR en español, explicando el porqué.

## Copia de seguridad de la base

`.github/workflows/backup.yml` vuelca toda la base cada día a las 4:00 am
(Caracas) en un `.7z` cifrado (Actions → Copia de seguridad → Artifacts, 30
días). Trae `public.sql` (tablas, datos, funciones, triggers, RLS),
`auth-data.sql` (usuarios) y `cron-data.sql`. Se abre con la clave
`BACKUP_PASSPHRASE` que guarda Gustavo. Restaurar y montar una base local:
`docs/backups.md`. Ojo: algunas tablas de producción se crearon a mano antes
de las migraciones; para el esquema real usa `public.sql` del respaldo.
