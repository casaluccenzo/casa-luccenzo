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

Para generar la carpeta de producción `www/` con inyección de variables de entorno:

```bash
node scripts/build.js
```

Variables de entorno configurables en Vercel:
- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_ANON_KEY`: Llave pública anónima de Supabase.
- `GEMINI_API_KEY`: Clave API para el Asistente IA.
