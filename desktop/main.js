const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// app.getVersion() devuelve la version de Electron cuando NO esta empaquetado.
// Leemos package.json directo para que dev y prod reporten lo mismo.
const APP_VERSION = require('./package.json').version;

// www/ está al lado de main.js en dev; en resources/ cuando está empaquetado.
const WWW_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'www')
  : path.join(__dirname, '..', 'www');

// Host fijo. La ventana carga app://bundle/sistema/index.html y las rutas
// absolutas del frontend (/js/app.js, /css/main.css) resuelven como
// app://bundle/js/app.js — el pathname es la ruta bajo www/.
const APP_ORIGIN = 'app://bundle';

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });

  app.whenReady().then(() => {
    ipcMain.on('app:getVersion', (e) => { e.returnValue = APP_VERSION; });
    ipcMain.on('update:check', () => {});    // Task 4
    ipcMain.on('update:restart', () => {});  // Task 4

    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url);
      let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
      if (rel === '' || rel.endsWith('/')) rel += 'sistema/index.html';
      const filePath = path.normalize(path.join(WWW_DIR, rel));
      // Anti path-traversal: el archivo tiene que quedar dentro de WWW_DIR
      if (filePath !== WWW_DIR && !filePath.startsWith(WWW_DIR + path.sep)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    });

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.loadURL(`${APP_ORIGIN}/sistema/index.html`);

    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('did-fail-load', code, desc, url);
    });
  });

  app.on('window-all-closed', () => app.quit());
}
