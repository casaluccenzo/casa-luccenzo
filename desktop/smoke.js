// Throwaway smoke test: load app://bundle/sistema/index.html headlessly, report, quit.
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WWW_DIR = path.normalize(path.join(__dirname, '..', 'www'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'sistema/index.html';
    const filePath = path.normalize(path.join(WWW_DIR, rel));
    if (filePath !== WWW_DIR && !filePath.startsWith(WWW_DIR + path.sep)) return new Response('nf', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });

  const { ipcMain } = require('electron');
  const V = require('./package.json').version; ipcMain.on('app:getVersion', (e) => { e.returnValue = V; });
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') } });
  const failures = [];
  win.webContents.on('did-fail-load', (_e, code, desc, url) => failures.push(`did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on('console-message', (_e, level, message, line, src) => {
    if (level >= 2) failures.push(`console[${level}]: ${message} (${src}:${line})`);
  });

  try {
    await win.loadURL('app://bundle/sistema/index.html');
    await new Promise((r) => setTimeout(r, 3000));
    const title = await win.webContents.executeJavaScript('document.title');
    const hasApp = await win.webContents.executeJavaScript('!!(window.SupabaseManager || window.UIManager || window.StorageManager)');
    const scriptsLoaded = await win.webContents.executeJavaScript('document.querySelectorAll("script[src]").length');
    const apiVersion = await win.webContents.executeJavaScript('window.electronAPI && window.electronAPI.getVersion()');
    const apiStatus = await win.webContents.executeJavaScript('window.electronAPI && window.electronAPI.getUpdateStatus()');
    const apiKeys = await win.webContents.executeJavaScript('window.electronAPI ? Object.keys(window.electronAPI).sort().join(",") : "MISSING"');
    console.log('SMOKE title=' + JSON.stringify(title));
    console.log('SMOKE appGlobals=' + hasApp);
    console.log('SMOKE scriptTags=' + scriptsLoaded);
    console.log('SMOKE electronAPI.getVersion=' + JSON.stringify(apiVersion));
    console.log('SMOKE electronAPI.getUpdateStatus=' + JSON.stringify(apiStatus));
    console.log('SMOKE electronAPI.keys=' + apiKeys);
    console.log('SMOKE failures=' + JSON.stringify(failures, null, 2));
  } catch (e) {
    console.log('SMOKE loadURL threw: ' + e.message);
  }
  app.quit();
});
