const { contextBridge, ipcRenderer } = require('electron');

let currentStatus = 'desconocido';
const listeners = new Set();

ipcRenderer.on('update:status', (_e, status) => {
  currentStatus = status;
  for (const cb of listeners) { try { cb(status); } catch (_) {} }
});

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.sendSync('app:getVersion'),
  getUpdateStatus: () => currentStatus,
  onUpdateStatus: (cb) => { if (typeof cb === 'function') listeners.add(cb); },
  checkForUpdates: () => ipcRenderer.send('update:check'),
  restartToUpdate: () => ipcRenderer.send('update:restart')
});
