// Cableado del shell de escritorio (Electron). No-op / degradado en un navegador.
// Los <script> están en el <head>, así que esperamos al DOM antes de tocarlo.
(function () {
    const api = window.electronAPI;

    const STATUS_TEXT = {
        'al-dia': '✓ Estás en la última versión',
        'descargando': '⬇ Descargando actualización…',
        'lista': '✓ Actualización descargada — se instala al cerrar la app',
        'error': '⚠ No se pudo verificar (sin conexión o sin releases)',
        'desconocido': 'Verificando…'
    };

    function init() {
        const versionLine = document.getElementById('app-version-line');
        const dialog = document.getElementById('about-dialog');
        const statusEl = document.getElementById('about-update-status');
        const restartBtn = document.getElementById('about-restart');
        const checkBtn = document.getElementById('about-check');
        const closeBtn = document.getElementById('about-close');

        function render(status) {
            if (statusEl) statusEl.textContent = STATUS_TEXT[status] || STATUS_TEXT.desconocido;
            if (restartBtn) restartBtn.classList.toggle('hidden', status !== 'lista');
        }

        // Global que abre el diálogo. Lo llama el menú de Electron (via
        // executeJavaScript), así funciona aunque el puente electronAPI falle.
        window.__openAbout = function () {
            if (api && typeof api.getUpdateStatus === 'function') {
                try { render(api.getUpdateStatus()); } catch (_) {}
            }
            if (dialog) dialog.classList.remove('hidden');
        };

        if (closeBtn && dialog) closeBtn.addEventListener('click', () => dialog.classList.add('hidden'));

        if (!api) return; // navegador (o puente roto): el diálogo abre, sin controles de update

        if (versionLine) {
            try { versionLine.textContent = 'v' + api.getVersion() + ' · PC'; } catch (_) {}
            versionLine.style.cursor = 'pointer';
            versionLine.addEventListener('click', () => window.__openAbout());
        }

        render(api.getUpdateStatus());
        api.onUpdateStatus(render);

        if (checkBtn) checkBtn.addEventListener('click', () => { render('desconocido'); api.checkForUpdates(); });
        if (restartBtn) restartBtn.addEventListener('click', () => api.restartToUpdate());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
