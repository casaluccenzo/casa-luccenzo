// Cableado del shell de escritorio (Electron). No-op en un navegador normal.
(function () {
    const api = window.electronAPI;
    const versionLine = document.getElementById('app-version-line');

    // El footer ya trae el número inyectado en build. En Electron, si el
    // package.json del shell difiere, preferimos el del shell.
    if (api && versionLine) {
        try { versionLine.textContent = 'v' + api.getVersion(); } catch (_) {}
    }

    if (!api) return; // navegador: nada más que hacer

    const dialog = document.getElementById('about-dialog');
    const statusEl = document.getElementById('about-update-status');
    const restartBtn = document.getElementById('about-restart');
    const checkBtn = document.getElementById('about-check');
    const closeBtn = document.getElementById('about-close');

    const STATUS_TEXT = {
        'al-dia': '✓ Estás en la última versión',
        'descargando': '⬇ Descargando actualización…',
        'lista': '✓ Actualización descargada — se instala al cerrar la app',
        'error': '⚠ No se pudo verificar (sin conexión o sin releases)',
        'desconocido': 'Verificando…'
    };

    function render(status) {
        if (statusEl) statusEl.textContent = STATUS_TEXT[status] || STATUS_TEXT.desconocido;
        if (restartBtn) restartBtn.classList.toggle('hidden', status !== 'lista');
    }

    render(api.getUpdateStatus());
    api.onUpdateStatus(render);

    if (versionLine) {
        versionLine.style.cursor = 'pointer';
        versionLine.addEventListener('click', () => {
            render(api.getUpdateStatus());
            if (dialog) dialog.classList.remove('hidden');
        });
    }
    if (checkBtn) checkBtn.addEventListener('click', () => { render('desconocido'); api.checkForUpdates(); });
    if (restartBtn) restartBtn.addEventListener('click', () => api.restartToUpdate());
    if (closeBtn) closeBtn.addEventListener('click', () => { if (dialog) dialog.classList.add('hidden'); });
})();
