# 🥖 Casa Lucenzo — Sistema POS & Control de Inventario

Sistema Web/PWA de Punto de Venta (POS), control de inventario en tiempo real, comandas de cocina y panel administrativo de métricas para **Casa Lucenzo**.

---

## 🚀 Arquitectura Técnica

- **Frontend**: HTML5 + Vanilla CSS + JavaScript Modular (ES6) (sin frameworks, ultra-rápido y liviano).
- **Backend & Persistencia**: Supabase PostgreSQL + Supabase Auth + Row Level Security (RLS) + LocalStorage.
- **Sincronización Multi-Dispositivo**: Supabase Realtime Postgres Changes.
- **Resiliencia Offline & PWA**: Service Worker (`sw.js`) con cola de sincronización automática (`syncOfflineQueue`).
- **Tasa de Cambio BCV**: Conector automático multi-proveedor con fallback resiliente (`js/exchange-rate.js`).
- **Asistente IA**: Integración con Google Gemini API protegida vía Vercel Serverless Function (`/api/gemini.js`).
- **Despliegue**: Vercel (Compilación estática vía `node scripts/build.js` ➔ `www/`).

---

## 🔑 Autenticación & Roles (Post-Migración Supabase Auth)

El sistema utiliza **Supabase Auth** respaldado por la tabla `public.profiles` protegida por **Row Level Security (RLS)**:

- `admin`: Control total (Métricas, inventario, usuarios, tasa BCV, cierre de caja).
- `venta`: Punto de venta (Vitrina, ventas, historial, cobro de fiados).
- `cocina`: Monitor de comandas, despachos y recetas.

---

## 🛠️ Desarrollo Local & Modo Pruebas (Sandbox)

### Ejecutar Localmente:
Puedes abrir `index.html` directamente en tu navegador o usar un servidor local en el puerto `8080`.

### Activar Modo Pruebas (Sandbox Isolado):
Para evitar alterar los datos reales de producción durante pruebas, activa el modo sandbox agregando `?test=true` a la URL:
```
http://localhost:8080/?test=true
```

---

## 🧬 Entornos: Producción vs Staging

Existen dos proyectos Supabase separados para no mezclar pruebas con datos reales del negocio:

| Entorno | Proyecto Supabase | Ref |
|---|---|---|
| Producción | `Casa Lucenzo` | `xttpaqokeyywjaajvjyu` |
| Staging | `casa-lucenzo-staging` | `iwwymgxsqxfrkpryabnk` |

Para trabajar contra staging: `npx supabase link --project-ref iwwymgxsqxfrkpryabnk` y luego `npx supabase db push` (aplica `supabase/migrations/*`). Para volver a producción: `npx supabase link --project-ref xttpaqokeyywjaajvjyu`.

> ⚠️ Las tablas base (`products`, `sales`, `expenses`, `debts`, `replenishments`, `ingredients`, `app_config`, `active_sessions`) se crearon a mano en el dashboard de producción antes de que existiera la carpeta `supabase/migrations/`, así que **no están capturadas en ningún archivo de migración**. Si staging aparece sin esas tablas, restaurarlas ahí es un paso manual único (Supabase Dashboard → Database → Backups, o exportar/importar el schema). Las migraciones `001`-`006` sí están versionadas y se aplican igual en ambos entornos.

La contraseña de la base de datos de staging quedó guardada localmente en `.staging-db-password.txt` (ignorado por git, no se sube a ningún lado).

---

## 🧪 Pruebas Unitarias

El proyecto incluye una suite de pruebas unitarias livianas para validar cálculos de dinero, inventario y permisos:

```bash
node tests/unit.test.js
```

---

## 📦 Compilación y Despliegue

Para levantar el sitio en local, tal cual lo sirve Vercel (raíz del repo):

```bash
npm run dev
```

Queda en `http://localhost:4173/` (landing) y `http://localhost:4173/sistema/`
(el POS). Ojo: `js/supabase.js` cae a la URL y llave publishable del proyecto
real, así que estás hablando con la base de producción.

Para generar la carpeta de producción `www/` con inyección de variables de entorno:

```bash
node scripts/build.js
```

Variables de entorno configurables en Vercel:
- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_ANON_KEY`: Llave pública anónima de Supabase.
- `GEMINI_API_KEY`: Clave API para el Asistente IA.
- `PEDIDOS_ONLINE_ENABLED`: debe valer `true` para que `/api/notify-pedido` avise
  al staff por WhatsApp. Con cualquier otro valor el endpoint responde 503. El
  pedido se guarda igual en Supabase; lo único que se pierde es la notificación.
- `CRON_SECRET`: string aleatorio (16+ caracteres) que autoriza a los crons
  diarios (`/api/keepalive` y `/api/sales-monitor`) definidos en
  `vercel.json`. Vercel lo envía solo como header al disparar cada cron; sin
  esta variable ambos endpoints rechazan toda petición.
- `SALES_MONITOR_ENABLED`: debe valer `true` para que `/api/sales-monitor`
  (cron diario, 9pm hora Venezuela) mande un resumen de ventas del día por
  WhatsApp a `WHATSAPP_ADMIN_PHONE`. Con cualquier otro valor responde 503 y
  no manda nada. Reutiliza el mismo cálculo de patrón semanal/tendencia/
  reseñas que la pestaña "Análisis" y su informe PDF (`js/analytics.js`).
- `SUPABASE_SERVICE_ROLE_KEY`: clave de rol de servicio de Supabase. La
  necesitan los endpoints que escriben o leen tablas protegidas por RLS sin
  una sesión de usuario real: los bots de WhatsApp/Telegram (`update_bcv`,
  `add_stock`/`set_stock`) y el cron `/api/bcv-rate-sync`. Sin esta variable,
  esos endpoints no pueden escribir en `app_config`/`products` ni leer
  `sales`.

### `/api/bcv-rate-sync` (cron diario, tasa BCV)

`js/exchange-rate.js`/`js/app.js` solo refrescan la tasa BCV desde un
navegador abierto (al cargar la app, cada 6h con la pestaña abierta, al
volver a la pestaña si está desactualizada, o al cerrar caja). Si un día
nadie abre el POS antes de que el BCV publique su tasa, el valor queda
congelado en el de ayer sin ningún aviso. Este cron (30 18 * * * UTC ⇒
2:30pm hora Venezuela, después de que el BCV suele publicar) llama a los
mismos dos proveedores que usa el cliente (DolarVZLA, DolarAPI) y escribe
directo en `app_config.bcv_rate` con la service role key, independientemente
de si algún dispositivo tiene la app abierta. Respeta una tasa fijada a mano
(`use_auto_bcv = false`) y deja un registro en `activity_logs` cuando
efectivamente cambia el valor.

## Versionado de assets

`sistema/index.html` pide cada `.js`/`.css` con `?v=NNN` y `sw.js` define
`APP_VERSION = 'NNN'`. **Los dos números tienen que subir juntos en cada
release**: el service worker cachea por URL completa, así que si no coinciden el
precache queda huérfano y los usuarios siguen ejecutando código viejo.
