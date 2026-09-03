# Casa Lucenzo — App de escritorio Electron (diseño)

**Fecha:** 2026-09-02
**Estado:** aprobado para pasar a plan de implementación
**Alcance:** empaquetar el POS actual como app de escritorio Windows, con
versión visible y auto-actualización. **Independiente** del trabajo
offline-first (Plan A/B) — se puede construir y shippear ahora; el frontend
offline-first se empaqueta después vía el mismo auto-update.

---

## 1. Objetivo

Una app de escritorio para Windows (`Casa Lucenzo.exe`) que:
- Empaqueta el frontend adentro → abre instantáneo, sin depender de que
  casalucenzo.com responda para dibujar la pantalla.
- Muestra su versión al usuario (footer + diálogo "Acerca de").
- Se actualiza sola: al publicar una versión nueva, las PC del local la bajan
  en segundo plano y la aplican al cerrar la app, sin reinstalar nada.
- "Sólida, sin fallas": una sola ventana, sin sorpresas, sin interrumpir una
  venta.

## 2. Decisiones (tomadas con el dueño)

| # | Decisión |
|---|----------|
| D1 | **Frontend empaquetado** dentro del `.exe` (no carga la web en vivo). |
| D2 | **Auto-update vía GitHub Releases** (repo público `casaluccenzo/casa-luccenzo`). Instaladores públicos — aceptable, el POS igual pide PIN. |
| D3 | **Sin firma de código.** Advertencia de SmartScreen una vez por PC en la instalación inicial; los auto-updates posteriores son silenciosos. |
| D4 | **Update silencioso**: descarga en segundo plano, se aplica **al cerrar la app**. Nunca interrumpe. Botón opcional "Reiniciar ahora". |
| D5 | **Solo Windows.** |
| D6 | **Versión visible**: footer (navegador + Electron) + diálogo "Acerca de" (solo Electron, con estado del update). |
| D7 | **Se shippea ahora**, envolviendo el frontend actual (online-only). El frontend offline-first llega después por el mismo auto-update. |
| D8 | Código Electron en `desktop/` **en el mismo repo**. |
| D9 | Versión unificada: `package.json` → `version` es la **única fuente**. Reemplaza el `APP_VERSION = '320'` suelto de `sw.js`. Primera versión unificada: **`1.0.0`** (el `320` era una clave de cache interna, sin valor para el usuario). *Taste call — el dueño puede preferir `3.20.0` para encadenar con el 320.* |

## 3. Arquitectura

```
Casa Lucenzo.exe  (Electron, Windows)
├── proceso principal (desktop/main.js)
│   ├── registra el protocolo app://  → sirve www/ empaquetado
│   ├── crea 1 ventana, carga app://sistema/index.html
│   ├── electron-updater: chequea GitHub Releases al abrir + cada 4h
│   └── menú mínimo: Acerca de · Recargar · Salir
├── preload (desktop/preload.js)
│   └── expone window.electronAPI = { getVersion, getUpdateStatus,
│                                     onUpdateStatus, checkForUpdates,
│                                     restartToUpdate }
└── www/  (el frontend, copiado por build.js — idéntico al de la web)
    └── sistema/index.html + js/ + css/ + img/
```

**Carga del frontend — protocolo `app://`:**
`sistema/index.html` usa rutas absolutas (`/js/app.js`, `/css/main.css`). Con
`file://` esas rutas apuntan a la raíz del disco y se rompe todo. Solución:

1. Antes de `app.whenReady()`:
   ```js
   protocol.registerSchemesAsPrivileged([{
     scheme: 'app',
     privileges: { standard: true, secure: true, supportFetchAPI: true }
   }]);
   ```
2. Tras `whenReady`: `protocol.handle('app', (req) => ...)` que mapea
   `app://sistema/index.html` → archivo real en `<resources>/www/sistema/index.html`,
   `app://js/app.js` → `<resources>/www/js/app.js`, etc. (streaming de archivos,
   con el `Content-Type` correcto por extensión).
3. La ventana carga `app://sistema/index.html`. Ahora `/js/app.js` resuelve
   como `app://js/app.js` → bien.

**Ventana:**
- 1 sola. `show: false` hasta `ready-to-show`, después `maximize()`.
- `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`,
  `preload: <desktop/preload.js>`, `sandbox: true`.
- `autoHideMenuBar: true` + un `Menu` mínimo (Acerca de / Recargar / Salir).
- `app.requestSingleInstanceLock()` — doble click en el ícono enfoca la
  ventana existente, no abre otra.

**Sesión / auth:** Electron persiste `localStorage` en su `userData`. La sesión
de Supabase (email/password) queda guardada → login una sola vez por PC. Esto
adelanta el concepto "dispositivo provisionado" de Plan B.

## 4. Auto-update (electron-updater)

- Paquete: `electron-updater` (par de `electron-builder`).
- Config: `autoDownload: true`, `autoInstallOnAppQuit: true`.
- `autoUpdater.checkForUpdates()` en `app.whenReady()` + `setInterval` cada 4h.
- Eventos (`update-available`, `download-progress`, `update-downloaded`,
  `error`) → el main los traduce a un estado simple
  (`al-dia` | `descargando` | `lista` | `error`) y lo emite al renderer por
  `webContents.send('update:status', ...)`. El preload lo re-expone como
  `onUpdateStatus(cb)`.
- `restartToUpdate()` → `autoUpdater.quitAndInstall()`.
- El feed lo arma `electron-builder` al publicar: sube el `.exe` (NSIS) + el
  `latest.yml` a la Release. `electron-updater` lee ese `latest.yml`.

**Instalador (NSIS, config de electron-builder):**
`oneClick: true`, `perMachine: false` (por-usuario, sin pedir admin),
`allowToChangeInstallationDirectory: false`. Instalación sin fricción; el
auto-updater reemplaza el binario en su lugar.

**Si una release sale mal:** como el update se aplica al cerrar, la ventana de
exposición es corta. Arreglo: publicar enseguida una versión más alta con el
fix — las PC la toman al siguiente cierre. Todos los instaladores viejos quedan
en GitHub Releases para reinstalar a mano una versión anterior si hiciera falta.
**Antes de cada `--publish`: probar el `.exe` en una PC.**

## 5. Versión unificada

- `package.json` → `version` (semver) es la fuente. Arranca en `1.0.0` (ver D9).
- `scripts/build.js` lee `require('../package.json').version` y sobre los
  archivos copiados a `www/`:
  - reemplaza el token `__APP_VERSION__` en `www/sistema/index.html` (footer +
    diálogo "Acerca de") — mismo patrón que el `__SUPABASE_URL__` que build.js
    ya maneja;
  - reemplaza cada `?v=320` de `www/sistema/index.html` por `?v=<version>`
    (regex sobre el atributo, no `.replace` simple);
  - reemplaza `const APP_VERSION = '320'` en `www/sw.js` por la versión
    unificada.
  Los archivos fuente (`sistema/index.html`, `sw.js`) quedan con `__APP_VERSION__`
  / un valor placeholder; el número real solo existe en `package.json` y en el
  `www/` construido.
- `sw.js`: `const APP_VERSION` se inyecta desde la versión unificada en el build
  (hoy está hardcodeado). Se mantiene el requisito de la skill
  `verifying-production-deploys` (el `?v=` de todos los `<script>` y el
  `APP_VERSION` del SW coinciden — ahora automáticamente, porque salen del
  mismo número).

## 6. Comandos (package.json scripts)

```
npm run build          → genera www/ (con la versión inyectada). Sin cambios de comportamiento salvo la inyección.
npm run release        → npm version <patch|minor> && build && release:web && release:desktop
npm run release:web    → git push (Vercel deploya casalucenzo.com)
npm run release:desktop→ electron-builder --win --publish always   (sube .exe + latest.yml a GitHub Releases)
```

- `electron-builder --publish` necesita `GH_TOKEN` (PAT con scope `public_repo`)
  en el entorno. Se guarda en `.env` local (gitignored), **nunca commiteado**.
- Los builds corren **en la PC del dueño** para arrancar. Mover a GitHub
  Actions es una mejora opcional posterior (build en ambiente limpio); no es
  necesaria para la v1.

## 7. Frontend — cambios

- **`sistema/index.html`**: agregar `v<VERSION>` al `<footer>` existente
  (después de "HECHO EN VENEZUELA"); agregar el HTML del diálogo "Acerca de"
  (oculto por defecto, `[hidden]`).
- **`js/app.js`** (o un `js/desktop.js` nuevo cargado solo si `window.electronAPI`):
  - Guardar el registro del service worker:
    `if (!window.electronAPI && 'serviceWorker' in navigator) { ...register... }`.
  - Poblar la versión del footer desde `window.electronAPI?.getVersion?.()` o
    la constante inyectada por build.
  - Cablear el diálogo "Acerca de": mostrar versión, suscribir
    `window.electronAPI.onUpdateStatus`, botón "Buscar actualizaciones"
    (`window.electronAPI.checkForUpdates()` → `autoUpdater.checkForUpdates()` en
    el main) y botón "Reiniciar ahora"
    (`window.electronAPI.restartToUpdate()`), visible solo cuando el estado es
    `lista`.
- **`js/ui.js`**: el trigger para abrir el diálogo "Acerca de" (click en la
  versión del footer).
- **`sw.js`**: `APP_VERSION` inyectado en build (ver §5).

Ningún cambio en la lógica de negocio, Supabase, o el trabajo offline-first.

## 8. Archivos nuevos (`desktop/`)

```
desktop/
├── main.js               proceso principal (protocolo, ventana, updater, menú)
├── preload.js            el puente window.electronAPI
├── package.json          deps de Electron + bloque "build" de electron-builder
├── build/
│   ├── icon.ico          256x256 (derivado del logo de img/)
│   └── installerIcon.ico
└── .env.example          GH_TOKEN=...
```

`desktop/package.json` "build" (electron-builder):
```json
{
  "appId": "com.casaluccenzo.pos",
  "productName": "Casa Lucenzo",
  "directories": { "output": "desktop/dist" },
  "files": ["desktop/main.js", "desktop/preload.js"],
  "extraResources": [{ "from": "www", "to": "www" }],
  "win": { "target": "nsis", "icon": "desktop/build/icon.ico" },
  "nsis": { "oneClick": true, "perMachine": false },
  "publish": { "provider": "github", "owner": "casaluccenzo", "repo": "casa-luccenzo" }
}
```

## 9. Riesgos y cómo se manejan

| Riesgo | Mitigación |
|--------|-----------|
| CSP de `sistema/index.html` bloquea el origen `app://` o algún host (Font Awesome, Supabase). | Revisar el `<meta http-equiv="Content-Security-Policy">` actual; agregar `app:` a `default-src`/`script-src`/`style-src` y confirmar los hosts externos. Spike de 30 min en la Task 1 del plan. |
| Supabase rechaza requests desde el origen `app://` (CORS). | Supabase REST acepta cualquier origen con la anon key. Si falla, el handler de `session.webRequest.onHeadersReceived` puede ajustar, o `webSecurity: false` como último recurso (no ideal). Verificar en la Task 1. |
| Una release mala llega a las 3 PC. | Update se aplica al cerrar (ventana corta) + publicar fix con versión más alta + probar el `.exe` antes de `--publish` + instaladores viejos disponibles. |
| SmartScreen bloquea el instalador sin firmar en una PC con políticas estrictas. | El dueño hace la instalación inicial (una vez). Si una PC lo bloquea duro, es la señal para pasar a Azure Trusted Signing (~US$10/mes) — decisión futura, no bloquea la v1. |
| El service worker viejo (registrado antes de instalar Electron, si la PC ya usaba la PWA) interfiere. | El guard `!window.electronAPI` evita registrarlo de nuevo; además el origen `app://` es distinto del origen web, así que el SW de la PWA no aplica en Electron. |
| `GH_TOKEN` se commitea por error. | `.env` en `.gitignore` (verificar), `.env.example` sin el valor real. |
| Errores del proceso principal de Electron (crash silencioso). | `process.on('uncaughtException')` + log a un archivo en `userData/logs/`. Sentry opcional (la infra de DSN ya existe en build.js) — fuera de alcance de la v1, anotado. |

## 10. Testing

- **Build:** `electron-builder --win` produce un `.exe` válido sin errores.
  (Se puede meter en CI como check.)
- **Smoke manual** (checklist en el plan): instala, abre, carga el POS, login
  contra Supabase funciona, la versión se ve en el footer y en "Acerca de".
- **Auto-update:** publicar `0.0.1` y `0.0.2` como releases de prueba (o un
  repo/tag de prueba), instalar `0.0.1`, verificar que detecta `0.0.2`, la baja,
  y la aplica al cerrar.
- **Regresión web:** `npm run build` + abrir `www/sistema/index.html` servido
  localmente — el frontend en navegador sigue igual, con la versión nueva en el
  footer y el SW registrándose normal.

## 11. Rollout

1. Rama `feature/electron-desktop`.
2. Construir la v1 localmente, probar el `.exe` en una PC.
3. Publicar la primera Release (`v1.0.0`) — instalar a mano en las 3 PC.
4. Probar el ciclo de auto-update con una `v1.0.1` de prueba (cambio trivial).
5. De ahí en más, `npm run release` para cada cambio.

## 12. Fuera de alcance

- Mac / Linux.
- Firma de código (revisable si SmartScreen molesta demasiado).
- GitHub Actions para los builds (mejora posterior).
- Modo kiosco / bloquear la PC en el POS.
- Cambios al frontend más allá de la versión + el guard del SW + el diálogo.
- El trabajo offline-first (Plan A/B) — llega al escritorio solo, por el
  auto-update, cuando esté listo.
