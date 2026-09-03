const { Menu, dialog } = require('electron');
const updater = require('./updater');

const APP_VERSION = require('./package.json').version;

function buildMenu(win) {
  const openAbout = () => {
    // Abre el diálogo HTML "Acerca de". Via executeJavaScript para no depender
    // de que el preload/electronAPI haya cargado bien.
    win.webContents
      .executeJavaScript('window.__openAbout ? (window.__openAbout(), true) : false')
      .then((ok) => {
        if (!ok) {
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'Acerca de Casa Lucenzo',
            message: 'Casa Lucenzo',
            detail: `Versión ${APP_VERSION} (Windows)`
          });
        }
      })
      .catch(() => {});
  };

  const template = [
    {
      label: 'Casa Lucenzo',
      submenu: [
        { label: 'Acerca de', click: openAbout },
        { label: 'Buscar actualizaciones', click: () => updater.checkNow() },
        { type: 'separator' },
        { label: 'Salir', role: 'quit' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Deshacer', role: 'undo' },
        { label: 'Rehacer', role: 'redo' },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Pegar', role: 'paste' },
        { label: 'Seleccionar todo', role: 'selectAll' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Recargar', role: 'reload' },
        { label: 'Pantalla completa', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Herramientas de desarrollo', role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Ventana',
      submenu: [
        { label: 'Minimizar', role: 'minimize' },
        { label: 'Cerrar', role: 'close' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
