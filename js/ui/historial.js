// Historial por día y turno, y facturas del historial.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// Turno que se está mirando en el Historial (se mantiene al repintar).
let historialShiftTab = null;
// Día que se está mirando en el Historial: null = hoy, o 'AAAA-MM-DD'.
let historialDay = null;
let historialDayReq = 0;

/** 'AAAA-MM-DD' de hoy en la hora del equipo (Caracas en la tienda). */
function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDateStr(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return localDateStr(new Date(y, m - 1, d + days));
}

/** Engancha una sola vez el selector de día del Historial. */
function initHistorialDayBar() {
    const input = document.getElementById('hist-day-input');
    if (!input || input.dataset.ready) return;
    input.dataset.ready = '1';
    const today = localDateStr();
    input.max = today;
    input.value = today;
    input.addEventListener('change', () => setHistorialDay(input.value));
    const go = (days) => setHistorialDay(shiftDateStr(input.value || localDateStr(), days));
    document.getElementById('hist-day-prev')?.addEventListener('click', () => go(-1));
    document.getElementById('hist-day-next')?.addEventListener('click', () => go(1));
    document.getElementById('hist-day-today')?.addEventListener('click', () => setHistorialDay(localDateStr()));
    updateHistorialDayBar();
}

function updateHistorialDayBar() {
    const today = localDateStr();
    const input = document.getElementById('hist-day-input');
    if (input) { input.max = today; input.value = historialDay || today; }
    const next = document.getElementById('hist-day-next');
    if (next) next.disabled = !historialDay;
    const todayBtn = document.getElementById('hist-day-today');
    if (todayBtn) todayBtn.classList.toggle('active', !historialDay);
    const desc = document.getElementById('hist-day-desc');
    if (desc) desc.textContent = historialDay
        ? `Cuentas cobradas el ${formatHistDay(historialDay)}. Solo para consultar: para corregir una venta, hágalo el mismo día.`
        : 'Cuentas que ya fueron cobradas y cerradas en la jornada de hoy.';
}

function formatHistDay(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const s = new Date(y, m - 1, d).toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s;
}

/** Cambia el día del Historial: hoy vuelve a la vista de siempre, otro día se busca en la base. */
function setHistorialDay(dateStr) {
    const today = localDateStr();
    // Días pasados: solo el admin. Ventas solo ve la jornada de hoy.
    const canSeePastDays = !!(window.getCurrentRole && window.getCurrentRole() === 'admin');
    if (!dateStr || dateStr >= today || !canSeePastDays) {
        historialDay = null;
        historialShiftTab = null;
        updateHistorialDayBar();
        if (window.refreshClientesView) window.refreshClientesView();
        return;
    }
    historialDay = dateStr;
    historialShiftTab = 'manana';
    updateHistorialDayBar();
    renderHistorialPastDay(dateStr);
}

/** Pinta el Historial de un día pasado (solo lectura), separado por turno. */
async function renderHistorialPastDay(dateStr) {
    const container = document.getElementById('clientes-pagados-container');
    if (!container) return;
    if (!(window.getCurrentRole && window.getCurrentRole() === 'admin')) return;
    const req = ++historialDayReq;
    historialGroups.clear();
    container.style.display = 'block';
    container.innerHTML = '<div class="hist-shift-empty"><i class="fa-solid fa-spinner fa-spin"></i> Buscando las ventas de ese día...</div>';

    let report = null;
    if (navigator.onLine && window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        try { report = await window.SupabaseManager.fetchDayReport(dateStr); } catch (e) { console.error('Historial día pasado:', e); }
    }
    if (req !== historialDayReq || historialDay !== dateStr) return;
    if (!report) {
        container.innerHTML = '<div class="hist-shift-empty" style="color: var(--color-danger);">No se pudo cargar ese día (¿sin internet?). <button type="button" class="hist-day-btn" id="hist-day-retry">Reintentar</button></div>';
        document.getElementById('hist-day-retry')?.addEventListener('click', () => renderHistorialPastDay(dateStr));
        return;
    }

    const dayRate = report.bcvRate || window.bcvRate || 1;
    const sales = (report.sales || []).map(s => ({ ...s, price: Number(s.price) || 0 }));
    const groups = groupSalesByClientAccounts(sales).filter(g => g.isPaid);
    const shiftOf = window.shiftOfTimestamp || (() => 'manana');
    const buckets = { manana: { cards: [], total: 0, totalBs: 0 }, tarde: { cards: [], total: 0, totalBs: 0 } };

    groups.forEach(group => {
        const rate = group.bcvRate || dayRate;
        let timeStr = '';
        try { timeStr = parseUTCTimestamp(group.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { /* sin hora */ }
        const card = document.createElement('div');
        card.className = 'history-item';
        card.style.cssText = 'flex-direction: column; align-items: stretch; gap: 0.5rem; padding: 0.75rem;';
        const itemsSummary = group.items.map(it => `${it.quantity}x ${escapeHtml(it.name)}`).join(', ');
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <h4 style="font-size: 13px; font-weight: 800; color: var(--color-gold); margin: 0; display: flex; align-items: center; gap: 0.3rem;">
                    <i class="fa-solid fa-user-tag" style="font-size: 11px; opacity: 0.8;"></i> ${escapeHtml(group.clientName)}
                    ${group.clientRif ? `<span style="font-size: 10px; color: var(--color-text-muted); font-weight: bold;">(${escapeHtml(group.clientRif)})</span>` : ''}
                </h4>
                <span class="client-status-badge paid">Pagado (${escapeHtml(group.paymentMethod || 'Efectivo')})</span>
            </div>
            <div style="font-size: 11px; color: var(--color-text-muted); margin-top: -0.15rem; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span>${timeStr}</span>
                <span style="font-weight: 700; color: var(--color-white);">Total: $${group.total.toFixed(2)} <span style="font-weight: 500; font-size: 10px; color: var(--color-text-muted);">(Bs. ${(group.total * rate).toFixed(2)})</span></span>
            </div>
            <div style="font-size: 11px; color: var(--color-white); opacity: 0.85; padding-top: 0.35rem; border-top: 1px solid rgba(255,255,255,0.04);">
                <strong>Lleva:</strong> ${itemsSummary}
            </div>
            <div style="display: flex; width: 100%; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.5rem;">
                <button class="btn-action-small btn-pos-ticket-client" title="Ver / Imprimir Factura POS" style="flex: 1; height: 34px; justify-content: center; font-size: 0.75rem; background-color: rgba(212,175,55,0.18); color: var(--color-gold); border: 1px solid rgba(212,175,55,0.4); font-weight: 800;">
                    <i class="fa-solid fa-receipt"></i> Factura POS
                </button>
            </div>`;
        card.querySelector('.btn-pos-ticket-client').addEventListener('click', () => {
            showPosReceiptModal({
                cart: group.items,
                clientName: group.clientName,
                clientRif: group.clientRif,
                timestamp: group.timestamp,
                facNo: (group.timestamp.replace(/\D/g, '') + '0000').substring(0, 16),
                isAlreadyPaid: true,
                payMethod: group.paymentMethod || 'Efectivo',
                rate: rate
            });
        });
        const b = buckets[shiftOf(group.timestamp)] || buckets.manana;
        b.cards.push(card);
        b.total += group.total;
        b.totalBs += group.total * rate;
    });

    if (!groups.length) {
        container.innerHTML = `<div class="hist-shift-empty">No hubo cuentas pagadas el ${formatHistDay(dateStr)}.</div>`;
        return;
    }
    renderHistorialShifts(container, buckets, 'de ese día');
}
const HISTORIAL_SHIFTS = [
    { key: 'manana', icon: 'fa-sun', label: 'Turno mañana', hours: '6:00 a.m. a 1:00 p.m.' },
    { key: 'tarde', icon: 'fa-moon', label: 'Turno tarde / noche', hours: '6:00 p.m. a 9:30 p.m.' }
];

/**
 * Pinta el Historial en dos pestañas: Turno mañana y Turno tarde/noche, cada
 * una con su cantidad de cuentas y su total. Abre por defecto el turno en curso.
 */
function renderHistorialShifts(container, buckets, dayWord = 'de hoy') {
    if (!historialShiftTab) historialShiftTab = window.shiftOfTimestamp ? window.shiftOfTimestamp() : 'manana';
    const fmtBs = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    container.style.display = 'block';
    container.innerHTML = '';

    const tabs = document.createElement('div');
    tabs.className = 'hist-shift-tabs';
    const panels = {};
    HISTORIAL_SHIFTS.forEach(sh => {
        const b = buckets[sh.key];
        const n = b.cards.length;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `hist-shift-tab hist-shift-${sh.key}`;
        btn.dataset.shift = sh.key;
        btn.innerHTML = `
            <span class="hist-shift-name"><i class="fa-solid ${sh.icon}"></i> ${sh.label}</span>
            <span class="hist-shift-hours">${sh.hours}</span>
            <span class="hist-shift-sum">${n} ${n === 1 ? 'cuenta' : 'cuentas'} · <strong>$${b.total.toFixed(2)}</strong> · Bs. ${fmtBs(b.totalBs)}</span>`;
        tabs.appendChild(btn);

        const panel = document.createElement('div');
        panel.className = `hist-shift-panel hist-shift-${sh.key}`;
        panel.dataset.shift = sh.key;
        const head = document.createElement('div');
        head.className = 'hist-shift-head';
        head.innerHTML = `<i class="fa-solid ${sh.icon}"></i> ${sh.label} <span>${sh.hours}</span>`;
        panel.appendChild(head);
        const grid = document.createElement('div');
        grid.className = 'hist-shift-grid';
        if (n) b.cards.forEach(c => grid.appendChild(c));
        else grid.innerHTML = `<div class="hist-shift-empty">No hay cuentas pagadas en el ${sh.label.toLowerCase()} ${dayWord}.</div>`;
        panel.appendChild(grid);
        panels[sh.key] = panel;
    });

    const select = (key) => {
        historialShiftTab = key;
        tabs.querySelectorAll('.hist-shift-tab').forEach(t => t.classList.toggle('active', t.dataset.shift === key));
        Object.entries(panels).forEach(([k, p]) => p.classList.toggle('hidden', k !== key));
    };
    tabs.addEventListener('click', (e) => {
        const t = e.target.closest('.hist-shift-tab');
        if (t) select(t.dataset.shift);
    });

    container.appendChild(tabs);
    HISTORIAL_SHIFTS.forEach(sh => container.appendChild(panels[sh.key]));
    select(historialShiftTab);
}

// Cuentas del Historial por horario, para abrir su factura desde la etiqueta.
const historialGroups = new Map();
let historialInvoicesCache = { at: 0, list: null, promise: null };

/**
 * Pone en cada cuenta del Historial el N° de su factura talonario (o si
 * falta). Una sola consulta por pantalla, guardada unos segundos para no
 * repetirla en cada repintado.
 */
async function refreshHistorialInvoices({ force = false } = {}) {
    const container = document.getElementById('clientes-pagados-container');
    if (!container || !container.querySelector('.hist-inv-badge')) return;
    const pending = new Set(window.PendingInvoices ? window.PendingInvoices.list() : []);
    const online = navigator.onLine && window.SupabaseManager && window.SupabaseManager.isConfigured();

    let list = null;
    if (online) {
        const fresh = Date.now() - historialInvoicesCache.at < 15000;
        if (force || !fresh || !historialInvoicesCache.list) {
            if (!historialInvoicesCache.promise || force) {
                const since = new Date();
                since.setHours(0, 0, 0, 0);
                historialInvoicesCache.promise = window.SupabaseManager.fetchInvoicesSince(since.toISOString())
                    .then(rows => {
                        if (rows) historialInvoicesCache = { at: Date.now(), list: rows, promise: null };
                        else historialInvoicesCache.promise = null;
                        return rows;
                    });
            }
            list = await historialInvoicesCache.promise;
        } else {
            list = historialInvoicesCache.list;
        }
    }

    const byTs = new Map();
    (list || []).forEach(inv => {
        const key = new Date(inv.sale_timestamp).getTime();
        const prev = byTs.get(key);
        if (!prev || inv.status === 'emitida') byTs.set(key, inv);
    });

    const pad5 = (n) => (window.InvoiceRenderer ? window.InvoiceRenderer.pad5(n) : String(n));
    const btnStyle = 'height: 30px; padding: 0 0.7rem; border-radius: 8px; cursor: pointer; font-weight: 800; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 0.35rem;';
    document.querySelectorAll('#clientes-pagados-container .hist-inv-badge').forEach(badge => {
        const ts = badge.dataset.ts;
        const group = historialGroups.get(ts);
        if (!group) return;
        const inv = byTs.get(new Date(ts).getTime());
        const isStaff = window.Combos && group.items.some(it => window.Combos.isStaffSale(it.name));
        let html;
        if (inv && inv.status === 'emitida') {
            const cf = window.InvoiceRenderer && window.InvoiceRenderer.isConsumidorFinal(inv);
            html = `<button class="btn-hist-inv" style="${btnStyle} border: 1px solid rgba(212,175,55,0.5); background: rgba(212,175,55,0.12); color: var(--color-gold);">
                        <i class="fa-solid fa-file-invoice-dollar"></i> Factura N° ${pad5(inv.number)}
                    </button>
                    ${cf ? '<span>Consumidor final · <span style="color: var(--color-gold);">tóquela para poner la cédula</span></span>' : ''}`;
        } else if (pending.has(ts)) {
            html = '<span><i class="fa-solid fa-wifi"></i> Factura talonario pendiente: sale sola al volver internet.</span>';
        } else if (!online) {
            html = '';
        } else {
            const label = inv ? `Factura N° ${pad5(inv.number)} anulada` : (isStaff ? 'Consumo del personal: sin factura' : 'Sin factura talonario');
            html = `<span>${label}</span>
                    <button class="btn-hist-inv" style="${btnStyle} border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: var(--color-white);">
                        <i class="fa-solid fa-file-circle-plus"></i> Emitir factura
                    </button>`;
        }
        badge.innerHTML = html;
        const btn = badge.querySelector('.btn-hist-inv');
        if (btn) {
            btn.addEventListener('click', () => showInvoiceModal({
                cart: group.items,
                clientName: group.clientName,
                clientRif: group.clientRif,
                timestamp: group.timestamp,
                payMethod: group.paymentMethod || 'Efectivo',
                rate: group.bcvRate
            }));
        }
    });
}

function cleanProductName(name = '') {
    return name
        .replace(/\s*\[.*?\]/g, '')
        .replace(/\s*\((?:Pagado|Punto|Pago|Efectivo|Biopago).*?\)/gi, '')
        .trim();
}

function getItemTotalUSD(item) {
    if (!item) return 0;
    if (typeof item.totalPrice === 'number' && item.totalPrice > 0) {
        return item.totalPrice;
    }
    const qty = item.quantity || 1;
    const price = item.price || 0;
    return price * qty;
}
