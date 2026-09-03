// Throwaway headless smoke test del shell Electron. Corre: npx electron smoke.js
const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WWW_DIR = path.normalize(path.join(__dirname, '..', 'www'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const V = require('./package.json').version;
ipcMain.on('app:getVersion', (e) => { e.returnValue = V; });

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'sistema/index.html';
    const filePath = path.normalize(path.join(WWW_DIR, rel));
    if (filePath !== WWW_DIR && !filePath.startsWith(WWW_DIR + path.sep)) return new Response('nf', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') } });
  require('./updater').initUpdater(win);

  const failures = [];
  win.webContents.on('did-fail-load', (_e, code, desc, url) => failures.push(`did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on('console-message', (_e, level, message, line, src) => {
    if (level >= 2) failures.push(`console[${level}]: ${message} (${src}:${line})`);
  });

  const q = async (label, js) => {
    try { console.log('SMOKE ' + label + '=' + JSON.stringify(await win.webContents.executeJavaScript(js))); }
    catch (e) { console.log('SMOKE ' + label + ' THREW: ' + (e && e.message)); }
  };

  win.loadURL('app://bundle/sistema/index.html').catch((e) => console.log('SMOKE loadURL rejected: ' + (e && e.message)));
  await new Promise((r) => setTimeout(r, 3500));

  await q('title', 'document.title');
  await q('appGlobals', '!!(window.SupabaseManager || window.UIManager || window.StorageManager)');
  await q('scriptTags', 'document.querySelectorAll("script[src]").length');
  await q('footerVersion', '(document.getElementById("app-version-line")||{}).textContent');
  await q('hasAboutDialog', '!!document.getElementById("about-dialog")');
  await q('swController', 'navigator.serviceWorker ? String(!!navigator.serviceWorker.controller) : "no-sw-api"');
  await q('electronAPI.getVersion', 'window.electronAPI && window.electronAPI.getVersion()');
  await q('electronAPI.keys', 'window.electronAPI ? Object.keys(window.electronAPI).sort().join(",") : "MISSING"');
  await win.webContents.executeJavaScript('window.electronAPI && window.electronAPI.checkForUpdates()').catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  await q('statusAfterCheck', 'window.electronAPI && window.electronAPI.getUpdateStatus()');

  console.log('SMOKE failures=' + JSON.stringify(failures, null, 2));
  app.quit();
});
