// Base de clientes (panel de administrador, pestaña "Clientes"). La lista la
// arma la base con get_customer_base() (migración 046), que solo responde a un
// admin: cédula/RIF de las cuentas y facturas, teléfono de facturas, wifi y
// pedidos web. Aquí solo se muestra y se descarga en Excel o CSV. Necesita
// conexión; no pasa por PowerSync.
(function () {
    // SheetJS solo se baja cuando alguien pide el Excel.
    const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    const COLUMNS = [
        ['nombre', 'Nombre'],
        ['apellido', 'Apellido'],
        ['cedula_rif', 'Cédula / RIF'],
        ['telefono', 'Teléfono'],
        ['direccion', 'Dirección'],
        ['visitas', 'Visitas'],
        ['facturas', 'Facturas'],
        ['primera_visita', 'Primera visita'],
        ['ultima_visita', 'Última visita'],
        ['origen', 'De dónde salió']
    ];
    let clientes = [];
    let loading = null;

    function el(id) { return document.getElementById(id); }

    function toast(text, icon) {
        if (window.UIManager) window.UIManager.showToast(text, icon || 'fa-solid fa-address-book');
    }

    function fmtDate(d) {
        if (!d) return '';
        const [y, m, day] = String(d).split('-');
        return day && m ? `${day}/${m}/${y}` : String(d);
    }

    function renderResumen() {
        const box = el('clientes-resumen');
        if (!box) return;
        const total = clientes.length;
        if (!total) { box.textContent = ''; return; }
        const conCedula = clientes.filter(c => c.cedula_rif).length;
        const conTel = clientes.filter(c => c.telefono).length;
        const pct = (n) => Math.round((n / total) * 100);
        box.innerHTML = `<b style="color:#E2E8F0;">${total} clientes</b> · ` +
            `${conCedula} con cédula/RIF (${pct(conCedula)}%) · ` +
            `${conTel} con teléfono (${pct(conTel)}%)`;
    }

    function renderTable() {
        const tbody = el('clientes-tbody');
        if (!tbody) return;
        const q = (el('clientes-search') ? el('clientes-search').value : '').trim().toLowerCase();
        const rows = q
            ? clientes.filter(c => [c.nombre, c.apellido, c.cedula_rif, c.telefono].join(' ').toLowerCase().includes(q))
            : clientes;
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted);padding:1.25rem 0;">${clientes.length ? 'Nadie coincide con la búsqueda.' : 'Todavía no hay clientes con datos.'}</td></tr>`;
            return;
        }
        tbody.innerHTML = rows.map(c => `
            <tr>
                <td>${escapeHtml(c.nombre || '')}</td>
                <td>${escapeHtml(c.apellido || '')}</td>
                <td style="white-space:nowrap;">${escapeHtml(c.cedula_rif || '—')}</td>
                <td style="white-space:nowrap;">${escapeHtml(c.telefono || '—')}</td>
                <td style="text-align:right;">${Number(c.visitas) || 0}</td>
                <td style="text-align:right;white-space:nowrap;">${escapeHtml(fmtDate(c.ultima_visita))}</td>
            </tr>`).join('');
    }

    async function load() {
        const client = window.SupabaseManager && window.SupabaseManager.getClient();
        const tbody = el('clientes-tbody');
        if (!tbody) return;
        if (!client) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#F87171;padding:1.25rem 0;">Sin conexión. Intenta de nuevo.</td></tr>';
            return;
        }
        if (loading) return loading;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted);padding:1.25rem 0;">Cargando clientes...</td></tr>';
        loading = (async () => {
            const { data, error } = await client.rpc('get_customer_base');
            if (error) {
                console.error('Clientes:', error);
                const msg = error.code === '42501' ? 'Solo el administrador puede ver la base de clientes.' : 'No se pudo cargar la lista.';
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#F87171;padding:1.25rem 0;">${msg}</td></tr>`;
                clientes = [];
            } else {
                clientes = data || [];
                renderTable();
            }
            renderResumen();
        })();
        try { await loading; } finally { loading = null; }
    }

    function fileName(ext) {
        return `clientes-casa-lucenzo-${new Date().toISOString().slice(0, 10)}.${ext}`;
    }

    function download(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function asRows() {
        return clientes.map(c => COLUMNS.map(([key]) => {
            if (key === 'primera_visita' || key === 'ultima_visita') return fmtDate(c[key]);
            if (key === 'visitas' || key === 'facturas') return Number(c[key]) || 0;
            return c[key] == null ? '' : String(c[key]);
        }));
    }

    async function ensureData() {
        if (!clientes.length) await load();
        if (!clientes.length) { toast('⚠️ No hay clientes para descargar.'); return false; }
        return true;
    }

    async function exportCsv() {
        if (!(await ensureData())) return;
        const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
        const lines = [COLUMNS.map(([, label]) => label)].concat(asRows()).map(r => r.map(q).join(','));
        download(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), fileName('csv'));
        toast('📥 Base de clientes descargada (CSV).', 'fa-solid fa-file-csv');
    }

    function loadXlsx() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = XLSX_URL;
            s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX no cargó')));
            s.onerror = () => reject(new Error('No se pudo bajar el generador de Excel'));
            document.head.appendChild(s);
        });
    }

    async function exportExcel() {
        if (!(await ensureData())) return;
        let XLSX;
        try {
            XLSX = await loadXlsx();
        } catch (e) {
            console.error('Clientes Excel:', e);
            toast('⚠️ No se pudo armar el Excel; se descarga en CSV.');
            return exportCsv();
        }
        const ws = XLSX.utils.aoa_to_sheet([COLUMNS.map(([, label]) => label)].concat(asRows()));
        ws['!cols'] = [14, 16, 14, 14, 30, 8, 8, 13, 13, 18].map(wch => ({ wch }));
        // Cédula y teléfono como texto, para que Excel no se coma el 0 inicial.
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let r = 1; r <= range.e.r; r++) {
            [2, 3].forEach(cIdx => {
                const cell = ws[XLSX.utils.encode_cell({ r, c: cIdx })];
                if (cell) { cell.t = 's'; cell.z = '@'; }
            });
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName('xlsx'));
        toast('📥 Base de clientes descargada (Excel).', 'fa-solid fa-file-excel');
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!el('admin-panel-clientes')) return;
        el('btn-clientes-excel').addEventListener('click', () => { exportExcel().catch(e => console.error('Clientes:', e)); });
        el('btn-clientes-csv').addEventListener('click', () => { exportCsv().catch(e => console.error('Clientes:', e)); });
        el('btn-clientes-refresh').addEventListener('click', () => { load().catch(e => console.error('Clientes:', e)); });
        el('clientes-search').addEventListener('input', renderTable);
    });

    window.ClientesManager = { load };
})();
