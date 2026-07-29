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
