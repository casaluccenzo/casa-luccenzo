const { app, BrowserWindow } = require('electron');

// Doble click en el icono no abre una segunda ventana.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });

  app.whenReady().then(() => {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.loadURL('data:text/html,<h1>Casa Lucenzo &mdash; scaffold OK</h1>');
  });

  app.on('window-all-closed', () => app.quit());
}
