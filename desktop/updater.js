const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const FOUR_HOURS = 4 * 60 * 60 * 1000;

function initUpdater(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (status) => {
    if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
  };

  autoUpdater.on('checking-for-update', () => send('descargando'));
  autoUpdater.on('update-available', () => send('descargando'));
  autoUpdater.on('download-progress', () => send('descargando'));
  autoUpdater.on('update-not-available', () => send('al-dia'));
  autoUpdater.on('update-downloaded', () => send('lista'));
  autoUpdater.on('error', (err) => { console.error('updater', err); send('error'); });

  ipcMain.removeAllListeners('update:check');
  ipcMain.on('update:check', () => {
    autoUpdater.checkForUpdates().catch(() => send('error'));
  });
  ipcMain.removeAllListeners('update:restart');
  ipcMain.on('update:restart', () => autoUpdater.quitAndInstall());

  // En dev (sin empaquetar) autoUpdater no consulta ningun feed — no romper.
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((e) => console.error('updater init', e));
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), FOUR_HOURS);
  }
}

module.exports = { initUpdater };
