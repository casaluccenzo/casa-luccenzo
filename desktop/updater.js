const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const FOUR_HOURS = 4 * 60 * 60 * 1000;
let lastStatus = 'desconocido';

function initUpdater(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (status) => {
    lastStatus = status;
    if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
  };

  autoUpdater.on('checking-for-update', () => send('descargando'));
  autoUpdater.on('update-available', () => send('descargando'));
  autoUpdater.on('download-progress', () => send('descargando'));
  autoUpdater.on('update-not-available', () => send('al-dia'));
  autoUpdater.on('update-downloaded', () => send('lista'));
  autoUpdater.on('error', (err) => { console.error('updater', err); send('error'); });

  ipcMain.removeAllListeners('update:check');
  ipcMain.on('update:check', () => checkNow());
  ipcMain.removeAllListeners('update:restart');
  ipcMain.on('update:restart', () => restart());

  // En dev (sin empaquetar) autoUpdater no consulta ningun feed — no romper.
  if (app.isPackaged) {
    checkNow();
    setInterval(checkNow, FOUR_HOURS);
  }
}

function checkNow() {
  autoUpdater.checkForUpdates().catch((e) => { console.error('checkForUpdates', e); });
}

function restart() {
  autoUpdater.quitAndInstall();
}

function getStatus() { return lastStatus; }

module.exports = { initUpdater, checkNow, restart, getStatus };
