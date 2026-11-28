// Notas de entrega en la caja: emitir desde una cuenta o un pedido en línea,
// ver e imprimir (PDF), marcar entregada, anular (admin) y la lista de notas.
// El dibujo está en js/delivery-note.js; la base, en la migración 054.
//
// Script clásico: comparte el ámbito global con js/ui/ (escapeHtml, showToast).
// Expone window.openDeliveryNote(ctx) y window.openDeliveryNotesList().

function dnCanUse() {
    if (!window.DeliveryNote || !window.SupabaseManager || !window.SupabaseManager.isConfigured()) {
        showToast('⚠️ Las notas de entrega necesitan conexión con el servidor.', 'fa-solid fa-triangle-exclamation');
        return false;
    }
    if (!navigator.onLine) {
        showToast('📶 Necesitas internet para las notas de entrega.', 'fa-solid fa-wifi');
        return false;
    }
    return true;
}

const DN_INPUT = 'width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 10px; color: var(--color-white); font-weight: 700; font-size: 0.85rem;';
const DN_LABEL = 'display: block; color: var(--color-text-muted); font-weight: 700; margin-bottom: 0.25rem; font-size: 0.72rem; text-transform: uppercase;';
const DN_BTN = 'height: 40px; border-radius: 8px; cursor: pointer; font-weight: 900; font-size: 0.8rem; padding: 0 0.8rem;';
const DN_GOLD = `${DN_BTN} border: none; background: var(--color-gold); color: var(--color-bg-navy);`;
const DN_GHOST = `${DN_BTN} border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: var(--color-white);`;

/** Ventana oscura con un panel; devuelve { overlay, panel, close }. */
function dnOverlay(maxWidth = '880px') {
    const overlay = document.createElement('div');
    overlay.className = 'dn-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', zIndex: '3200', padding: '1rem', boxSizing: 'border-box', overflowY: 'auto'
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
        width: '100%', maxWidth, backgroundColor: '#111827', border: '1px solid rgba(212,175,55,0.4)',
        borderRadius: '14px', color: '#FFFFFF', padding: '1rem', boxSizing: 'border-box', margin: 'auto 0'
    });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    return { overlay, panel, close };
}

function dnHeader(title, withBack = false) {
    return `
        <div class="dn-noprint" style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem; margin-bottom: 0.9rem;">
            <h3 style="font-family: var(--font-serif); font-size: 1rem; color: var(--color-gold); font-weight: 900; margin: 0; text-transform: uppercase; display: flex; align-items: center; gap: 0.4rem;">
                ${withBack ? '<button type="button" class="btn-dn-back" aria-label="Volver" style="background: none; border: none; color: var(--color-gold); cursor: pointer; font-size: 1rem;"><i class="fa-solid fa-arrow-left"></i></button>' : ''}
                <i class="fa-solid fa-truck-ramp-box"></i> ${title}
            </h3>
            <button type="button" class="btn-dn-close" aria-label="Cerrar" style="background: none; border: none; color: var(--color-text-muted); font-size: 1.25rem; cursor: pointer;">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>`;
}

function dnIsAdmin() {
    return !!(window.getCurrentRole && window.getCurrentRole() === 'admin');
}

/**
 * Muestra una nota ya emitida en `panel`: imprimir, marcar entregada, anular.
 * `onBack` (opcional) vuelve a la lista.
 */
function dnShowNote(ctx, note, onBack = null) {
    const { panel, close, overlay } = ctx;
    const DN = window.DeliveryNote;
    const num = DN.fmtNumber(note.number);
    const canDeliver = note.status === 'emitida';
    const canVoid = note.status !== 'anulada' && dnIsAdmin();
    const statusColor = { emitida: '#FBBF24', entregada: '#34D399', anulada: '#F87171' }[note.status] || '#fff';

    panel.innerHTML = `
        ${dnHeader(`Nota de entrega ${num}`, !!onBack)}
        <div class="dn-noprint" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.78rem; color: var(--color-text-muted); margin: -0.3rem 0 0.75rem;">
            <span style="font-weight: 900; color: ${statusColor};">● ${DN.STATUS_LABEL[note.status] || note.status}</span>
            ${note.reissued ? '<span>· Ya tenía nota: se muestra la misma para reimprimir.</span>' : ''}
            ${note.status === 'entregada' ? `<span>· Recibió ${escapeHtml(note.received_by_name || '')} ${note.received_by_rif ? `(${escapeHtml(note.received_by_rif)})` : ''}, ${DN.dateTime(note.delivered_at)}</span>` : ''}
        </div>
        <div class="dn-noprint" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.5rem; margin-bottom: 0.9rem;">
            <button type="button" class="btn-dn-print" style="${DN_GOLD}"><i class="fa-solid fa-print"></i> Imprimir / PDF</button>
            ${canDeliver ? `<button type="button" class="btn-dn-deliver" style="${DN_BTN} border: none; background: #10B981; color: #06281a;"><i class="fa-solid fa-signature"></i> Marcar entregada</button>` : ''}
            ${canVoid ? `<button type="button" class="btn-dn-void" style="${DN_BTN} border: 1px solid rgba(248,113,113,0.4); background: rgba(248,113,113,0.1); color: var(--color-danger);"><i class="fa-solid fa-ban"></i> Anular</button>` : ''}
        </div>
        <form class="dn-noprint dn-deliver-form" style="display: none; background: rgba(255,255,255,0.04); border: 1px solid rgba(16,185,129,0.4); border-radius: 10px; padding: 0.7rem; margin-bottom: 0.9rem; gap: 0.5rem; grid-template-columns: 2fr 1fr auto; align-items: end;">
            <div><label style="${DN_LABEL}" for="dn-recv-name">Quién recibió</label><input id="dn-recv-name" maxlength="200" required style="${DN_INPUT}" value="${escapeHtml(note.client_name || '')}"></div>
            <div><label style="${DN_LABEL}" for="dn-recv-rif">C.I.</label><input id="dn-recv-rif" maxlength="30" style="${DN_INPUT}" value="${escapeHtml(note.client_rif || '')}"></div>
            <button type="submit" style="${DN_BTN} border: none; background: #10B981; color: #06281a;">Guardar</button>
            <div class="dn-deliver-error" style="grid-column: 1 / -1; display: none; color: var(--color-danger); font-size: 0.78rem; font-weight: 700;"></div>
        </form>
        <div class="dn-stage-wrap"></div>`;

    panel.querySelector('.btn-dn-close').addEventListener('click', close);
    if (onBack) panel.querySelector('.btn-dn-back').addEventListener('click', onBack);

    const stage = panel.querySelector('.dn-stage-wrap');
    const fit = DN.mount(stage, note);
    const onResize = () => { if (document.body.contains(stage)) fit(); else window.removeEventListener('resize', onResize); };
    window.addEventListener('resize', onResize);

    panel.querySelector('.btn-dn-print').addEventListener('click', () => DN.print(overlay));

    const deliverBtn = panel.querySelector('.btn-dn-deliver');
    if (deliverBtn) {
        const form = panel.querySelector('.dn-deliver-form');
        deliverBtn.addEventListener('click', () => {
            form.style.display = form.style.display === 'grid' ? 'none' : 'grid';
            if (form.style.display === 'grid') form.querySelector('#dn-recv-name').focus();
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = form.querySelector('#dn-recv-name').value.trim();
            const rif = form.querySelector('#dn-recv-rif').value.trim();
            const err = form.querySelector('.dn-deliver-error');
            if (!name) { err.textContent = 'Escriba el nombre de quien recibió.'; err.style.display = 'block'; return; }
            const btn = form.querySelector('button[type=submit]');
            btn.disabled = true;
            const { note: updated, error } = await window.SupabaseManager.markDeliveryNoteDelivered(note.id, name, rif);
            btn.disabled = false;
            if (!updated) { err.textContent = error; err.style.display = 'block'; return; }
            showToast(`✅ Nota ${num} marcada como entregada.`, 'fa-solid fa-signature');
            if (window.logActivity) window.logActivity('Nota de Entrega', `Nota ${num} entregada a ${name}${rif ? ` (${rif})` : ''}`);
            dnShowNote(ctx, updated, onBack);
        });
    }

    const voidBtn = panel.querySelector('.btn-dn-void');
    if (voidBtn) {
        voidBtn.addEventListener('click', async () => {
            const reason = window.prompt(`¿Por qué se anula la nota ${num}? El número no se vuelve a usar.`);
            if (reason === null) return;
            if (!reason.trim()) return showToast('⚠️ Escriba el motivo de la anulación.', 'fa-solid fa-triangle-exclamation');
            const { note: updated, error } = await window.SupabaseManager.voidDeliveryNote(note.id, reason.trim());
            if (!updated) return showToast(`⚠️ ${error}`, 'fa-solid fa-triangle-exclamation');
            showToast(`🚫 Nota ${num} anulada.`, 'fa-solid fa-ban');
            if (window.logActivity) window.logActivity('Nota de Entrega', `Nota ${num} anulada: ${reason.trim()}`);
            dnShowNote(ctx, updated, onBack);
        });
    }
}

/**
 * Abre la nota de entrega de una cuenta o de un pedido. Si ya tiene, la
 * muestra; si no, pide los datos del cliente y la emite.
 * ctx: { source: 'venta'|'pedido', saleTimestamp?, pedidoId?, clientName?, clientRif?, clientPhone?, rate? }
 */
async function openDeliveryNote(ctx = {}) {
    if (!dnCanUse()) return;
    const ui = dnOverlay();
    const { panel, close } = ui;
    panel.innerHTML = `${dnHeader('Nota de entrega')}<div style="padding: 1.5rem; text-align: center; color: var(--color-text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Buscando...</div>`;
    panel.querySelector('.btn-dn-close').addEventListener('click', close);

    const key = ctx.source === 'pedido' ? { pedidoId: ctx.pedidoId } : { saleTimestamp: ctx.saleTimestamp };
    const existing = await window.SupabaseManager.fetchDeliveryNoteFor(key);
    if (!document.body.contains(panel)) return;
    if (existing) return dnShowNote(ui, Object.assign({ reissued: true }, existing));

    const generic = /^(consumidor final|cliente\s*#?\d*|mesa\s*\d*)$/i.test(String(ctx.clientName || '').trim());
    panel.innerHTML = `
        ${dnHeader('Nueva nota de entrega')}
        <p style="font-size: 0.78rem; color: var(--color-text-muted); margin: -0.3rem 0 0.9rem;">
            Los productos salen ${ctx.source === 'pedido' ? 'del pedido' : 'de la cuenta'} tal como se registraron. La nota no es factura y no mueve el stock.
        </p>
        <form class="dn-issue-form" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.7rem;">
            <div><label style="${DN_LABEL}" for="dn-client-name">Cliente</label>
                <input id="dn-client-name" maxlength="200" style="${DN_INPUT}" value="${escapeHtml(generic ? '' : (ctx.clientName || ''))}" placeholder="Nombre de quien recibe"></div>
            <div><label style="${DN_LABEL}" for="dn-client-rif">C.I. / RIF (opcional)</label>
                <input id="dn-client-rif" maxlength="30" style="${DN_INPUT}" value="${escapeHtml(ctx.clientRif || '')}" placeholder="V-12345678"></div>
            <div><label style="${DN_LABEL}" for="dn-client-phone">Teléfono (opcional)</label>
                <input id="dn-client-phone" maxlength="40" inputmode="tel" style="${DN_INPUT}" value="${escapeHtml(ctx.clientPhone || '')}"></div>
            <div style="grid-column: 1 / -1;"><label style="${DN_LABEL}" for="dn-notes">Observaciones (opcional)</label>
                <textarea id="dn-notes" maxlength="300" rows="2" style="${DN_INPUT} resize: vertical;" placeholder="Ej.: entregar después de las 10 am"></textarea></div>
            <label style="grid-column: 1 / -1; display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; font-weight: 700; cursor: pointer;">
                <input type="checkbox" id="dn-show-prices" checked style="width: 18px; height: 18px;"> Mostrar precios en la nota
            </label>
            <div class="dn-issue-error" style="grid-column: 1 / -1; display: none; color: var(--color-danger); font-size: 0.8rem; font-weight: 700;"></div>
            <button type="submit" class="btn-dn-issue" style="grid-column: 1 / -1; ${DN_GOLD} height: 46px; font-size: 0.9rem;">
                <i class="fa-solid fa-file-circle-check"></i> EMITIR NOTA DE ENTREGA
            </button>
        </form>`;
    panel.querySelector('.btn-dn-close').addEventListener('click', close);

    const form = panel.querySelector('.dn-issue-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = (id) => form.querySelector(id).value.trim();
        const errBox = form.querySelector('.dn-issue-error');
        const btn = form.querySelector('.btn-dn-issue');
        if (!navigator.onLine) { errBox.textContent = 'Necesitas internet para emitir la nota.'; errBox.style.display = 'block'; return; }
        errBox.style.display = 'none';
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Emitiendo...';
        const { note, error } = await window.SupabaseManager.issueDeliveryNote({
            source: ctx.source === 'pedido' ? 'pedido' : 'venta',
            saleTimestamp: ctx.source === 'pedido' ? null : ctx.saleTimestamp,
            pedidoId: ctx.source === 'pedido' ? ctx.pedidoId : null,
            clientName: val('#dn-client-name'),
            clientRif: val('#dn-client-rif'),
            clientPhone: val('#dn-client-phone'),
            showPrices: form.querySelector('#dn-show-prices').checked,
            notes: val('#dn-notes'),
            bcvRate: parseFloat(ctx.rate) > 0 ? parseFloat(ctx.rate) : (window.bcvRate || null)
        });
        if (!note) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-file-circle-check"></i> EMITIR NOTA DE ENTREGA';
            errBox.textContent = error || 'No se pudo emitir la nota. Intente de nuevo.';
            errBox.style.display = 'block';
            return;
        }
        const num = window.DeliveryNote.fmtNumber(note.number);
        if (!note.reissued) {
            showToast(`📦 Nota de entrega ${num} emitida.`, 'fa-solid fa-truck-ramp-box');
            if (window.logActivity) window.logActivity('Nota de Entrega', `Nota ${num} emitida para ${note.client_name} ($${Number(note.total_usd).toFixed(2)})`);
        }
        dnShowNote(ui, note);
    });
}

/** Filtra notas por N°, cliente, C.I. o fecha (texto libre). */
function filterDeliveryNotes(notes, query) {
    const fold = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = fold(query).trim();
    if (!q) return notes;
    const digits = q.replace(/\D/g, '');
    return notes.filter(n => {
        const DN = window.DeliveryNote;
        const hay = fold(`${DN.fmtNumber(n.number)} ${n.client_name} ${n.client_rif || ''} ${DN.dateTime(n.issued_at)} ${DN.STATUS_LABEL[n.status] || ''}`);
        return hay.includes(q) || (digits && String(n.number) === String(Number(digits)));
    });
}

/** Lista de notas de entrega con buscador. */
async function openDeliveryNotesList() {
    if (!dnCanUse()) return;
    const ui = dnOverlay('760px');
    const { panel, close } = ui;
    const DN = window.DeliveryNote;
    let notes = [];
    let query = '';

    const renderList = () => {
        const shown = filterDeliveryNotes(notes, query);
        const list = panel.querySelector('.dn-list');
        if (!list) return;
        if (!shown.length) {
            list.innerHTML = `<div style="padding: 1.25rem; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">${notes.length ? 'Ninguna nota coincide con la búsqueda.' : 'Todavía no hay notas de entrega. Se emiten desde una cuenta (Clientes / Historial) o desde un pedido confirmado.'}</div>`;
            return;
        }
        const color = { emitida: '#FBBF24', entregada: '#34D399', anulada: '#F87171' };
        list.innerHTML = shown.map((n, i) => `
            <button type="button" class="dn-row" data-i="${i}" style="width: 100%; text-align: left; display: grid; grid-template-columns: auto 1fr auto; gap: 0.75rem; align-items: center; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.6rem 0.75rem; color: var(--color-white); cursor: pointer; margin-bottom: 0.4rem;">
                <span style="font-family: monospace; font-weight: 900; color: var(--color-gold);">${DN.fmtNumber(n.number)}</span>
                <span style="min-width: 0;">
                    <span style="display: block; font-weight: 800; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(n.client_name)}${n.client_rif ? ` <small style="color: var(--color-text-muted);">(${escapeHtml(n.client_rif)})</small>` : ''}</span>
                    <span style="display: block; font-size: 0.72rem; color: var(--color-text-muted);">${DN.dateTime(n.issued_at)} · ${n.source === 'pedido' ? 'Pedido web' : 'Cuenta'}</span>
                </span>
                <span style="text-align: right;">
                    <span style="display: block; font-weight: 900; font-size: 0.85rem;">$${Number(n.total_usd).toFixed(2)}</span>
                    <span style="display: block; font-size: 0.7rem; font-weight: 800; color: ${color[n.status] || '#fff'};">${DN.STATUS_LABEL[n.status] || n.status}</span>
                </span>
            </button>`).join('');
        list.querySelectorAll('.dn-row').forEach(row => row.addEventListener('click', () => {
            dnShowNote(ui, shown[Number(row.dataset.i)], showList);
        }));
    };

    const showList = () => {
        panel.innerHTML = `
            ${dnHeader('Notas de entrega')}
            <input type="search" class="dn-search" placeholder="Buscar por N°, cliente, cédula o fecha" style="${DN_INPUT} margin-bottom: 0.75rem;" value="${escapeHtml(query)}">
            <div class="dn-list"><div style="padding: 1.25rem; text-align: center; color: var(--color-text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</div></div>`;
        panel.querySelector('.btn-dn-close').addEventListener('click', close);
        panel.querySelector('.dn-search').addEventListener('input', (e) => { query = e.target.value; renderList(); });
        load();
    };

    const load = async () => {
        const { notes: rows, error } = await window.SupabaseManager.fetchDeliveryNotes();
        if (!document.body.contains(panel)) return;
        if (error) {
            const list = panel.querySelector('.dn-list');
            if (list) list.innerHTML = `<div style="padding: 1.25rem; text-align: center; color: var(--color-danger);">${escapeHtml(error)}</div>`;
            return;
        }
        notes = rows;
        renderList();
    };

    showList();
}

/** Botón "Nota de entrega" para las tarjetas de cuentas y pedidos. */
function deliveryNoteButtonHtml(extraStyle = '') {
    return `<button type="button" class="btn-action-small btn-delivery-note" title="Nota de entrega para firmar al despachar" style="height: 36px; justify-content: center; font-size: 0.75rem; background-color: rgba(16,185,129,0.14); color: #34D399; border: 1px solid rgba(16,185,129,0.4); font-weight: 800; ${extraStyle}">
        <i class="fa-solid fa-truck-ramp-box"></i> Nota de entrega
    </button>`;
}

// Botones "Notas de entrega" de Historial y Pedidos (sistema/index.html).
document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.btn-open-delivery-notes')) openDeliveryNotesList();
});

window.openDeliveryNote = openDeliveryNote;
window.openDeliveryNotesList = openDeliveryNotesList;
window.deliveryNoteButtonHtml = deliveryNoteButtonHtml;
