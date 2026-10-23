// Wifi de clientes (pestaña Pedidos): clave de la red de invitados y lista de
// quienes se registraron en casalucenzo.com/wifi. La base decide quién ve qué
// (migración 041): admin y venta ven la lista, solo admin cambia la clave o
// borra un registro. Necesita conexión; no pasa por PowerSync.
(function () {
    const LOCATION_ID = '00000000-0000-0000-0000-000000000001';
    const RED_LABEL = { instagram: 'Instagram', tiktok: 'TikTok' };
    let registros = [];

    function el(id) { return document.getElementById(id); }

    function setMsg(text, ok) {
        const m = el('wifi-msg');
        if (!m) return;
        m.textContent = text || '';
        m.style.color = ok ? 'var(--color-success)' : '#F87171';
        m.classList.toggle('hidden', !text);
    }

    function renderList() {
        const list = el('wifi-registros-list');
        const count = el('wifi-count');
        if (!list) return;
        if (count) count.textContent = registros.length ? `(${registros.length})` : '';
        if (!registros.length) {
            list.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);font-size:0.85rem;padding:1.5rem 0;">Todavía no hay clientes registrados.</div>';
            return;
        }
        list.innerHTML = registros.map(r => {
            let when = '';
            try {
                const d = new Date(r.created_at);
                when = d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) + ' ' +
                    d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
            } catch (e) { /* fecha rara: se muestra vacía */ }
            return `
                <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.85rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;color:#E2E8F0;">${escapeHtml(r.nombre)}</div>
                        <div style="color:var(--color-text-muted);font-size:0.78rem;">${escapeHtml(r.telefono || 'Sin WhatsApp')} · ${RED_LABEL[r.red_social] || ''}</div>
                    </div>
                    <div style="color:var(--color-text-muted);font-size:0.75rem;white-space:nowrap;">${escapeHtml(when)}</div>
                    <button type="button" data-wifi-del="${escapeHtml(r.id)}" title="Borrar registro (si el cliente lo pide)" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;padding:0.25rem;"><i class="fa-solid fa-trash-can"></i></button>
                </div>`;
        }).join('');
    }

    async function load() {
        const client = window.SupabaseManager && window.SupabaseManager.getClient();
        if (!client || !el('wifi-panel')) return;
        const [cfg, regs] = await Promise.all([
            client.from('wifi_config').select('red, clave').eq('location_id', LOCATION_ID).maybeSingle(),
            client.from('wifi_registros').select('id, nombre, telefono, red_social, created_at')
                .order('created_at', { ascending: false }).limit(500)
        ]);
        if (cfg.data) {
            el('wifi-red').value = cfg.data.red || '';
            el('wifi-clave').value = cfg.data.clave || '';
        }
        registros = regs.data || [];
        renderList();
    }

    async function saveClave() {
        const client = window.SupabaseManager && window.SupabaseManager.getClient();
        const red = el('wifi-red').value.trim();
        const clave = el('wifi-clave').value.trim();
        if (!client) return setMsg('Sin conexión. Intenta de nuevo.');
        if (!red) return setMsg('Escribe el nombre de la red.');
        if (clave.length < 8) return setMsg('La clave del wifi debe tener al menos 8 caracteres.');
        const { data, error } = await client.from('wifi_config')
            .update({ red, clave, updated_at: new Date().toISOString() })
            .eq('location_id', LOCATION_ID).select('location_id');
        if (error || !data || !data.length) {
            return setMsg('No se pudo guardar. Solo un administrador puede cambiar la clave.');
        }
        setMsg('Clave guardada. La página del wifi ya muestra la nueva.', true);
    }

    async function deleteRegistro(id) {
        const client = window.SupabaseManager && window.SupabaseManager.getClient();
        if (!client) return;
        const { data, error } = await client.from('wifi_registros').delete().eq('id', id).select('id');
        if (error || !data || !data.length) {
            return setMsg('No se pudo borrar. Solo un administrador puede borrar registros.');
        }
        registros = registros.filter(r => r.id !== id);
        renderList();
        setMsg('Registro borrado.', true);
    }

    function exportCsv() {
        if (!registros.length) return setMsg('No hay registros para descargar.');
        const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const rows = [['Fecha', 'Nombre', 'WhatsApp', 'Red']].concat(
            registros.map(r => [new Date(r.created_at).toLocaleString('es-VE'), r.nombre, r.telefono || '', RED_LABEL[r.red_social] || ''])
        );
        const csv = '﻿' + rows.map(r => r.map(q).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `clientes-wifi-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const panel = el('wifi-panel');
        if (!panel) return;
        el('wifi-save').addEventListener('click', saveClave);
        el('wifi-export').addEventListener('click', exportCsv);
        el('wifi-registros-list').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-wifi-del]');
            if (!btn) return;
            if (btn.dataset.confirm === '1') {
                deleteRegistro(btn.dataset.wifiDel);
            } else {
                btn.dataset.confirm = '1';
                btn.style.color = '#F87171';
                btn.title = 'Toca otra vez para borrar';
                setMsg('Toca la papelera otra vez para borrar ese registro.');
            }
        });
        const tab = el('btn-pedidos');
        if (tab) tab.addEventListener('click', () => { load().catch(e => console.error('Wifi:', e)); });
    });

    window.WifiManager = { load };
})();
