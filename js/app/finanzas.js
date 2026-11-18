// Gastos, estado de resultados (P&L) y rentabilidad por producto.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// ================= DAILY EXPENSES =================

/**
 * Add a new expense transaction
 * @param {Event} e Submit event
 */
function addExpense(e) {
    e.preventDefault();

    const descInput = document.getElementById('expense-desc-input');
    const amountInput = document.getElementById('expense-amount-input');

    const description = descInput.value.trim();
    const amount = parseFloat(amountInput.value);

    if (!description || isNaN(amount) || amount <= 0) return;

    triggerHaptic(15);

    const newExpense = {
        uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        description,
        amount,
        timestamp: new Date().toISOString(),
        // NO category: the counter quick-expense is the only expense that flows
        // into the shift `expenses` array / cash register. Any categorized
        // expense belongs solely to the P&L / Gastos tab. null/absent reads as
        // 'otros' in aggregatePnl + renderAdminExpenses.
        currency: 'USD',
        bcv_rate: null
    };

    expenses.push(newExpense);
    window.StorageManager.saveExpenses(expenses);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.insertExpense(newExpense);
    }

    window.UIManager.renderExpenses(expenses, deleteExpense);
    window.UIManager.renderCashRegister(salesLog, expenses);
    
    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }

    document.getElementById('add-expense-form').reset();
    window.UIManager.showToast("💸 Gasto registrado correctamente.", "fa-solid fa-file-invoice-dollar");
}

/**
 * Delete expense transaction
 * @param {string} uuid Expense unique identifier
 */
/**
 * Acciones solo del admin: la vendedora puede hacerlas si alguien escribe la
 * clave de supervisor (js/supervisor.js). Cada autorización queda en el
 * registro de actividad.
 */
async function requireSupervisor(actionLabel) {
    if (currentRole === 'admin') return true;
    if (!window.Supervisor) return false;
    const ok = await window.Supervisor.ask(actionLabel);
    if (ok) logActivity("Autorización Supervisor", actionLabel);
    return ok;
}

async function deleteExpense(uuid) {
    // Borrar un gasto ya anotado: admin, o vendedora con clave de supervisor.
    if (currentRole !== 'admin') {
        const exp = expenses.find(e => e.uuid === uuid);
        const label = exp ? `Borrar el gasto "${exp.description || ''}" ($${(parseFloat(exp.amount) || 0).toFixed(2)})` : 'Borrar un gasto';
        if (!(await requireSupervisor(label))) return;
    }
    triggerHaptic(15);
    expenses = expenses.filter(e => e.uuid !== uuid);
    window.StorageManager.saveExpenses(expenses);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.deleteExpense(uuid);
    }

    window.UIManager.renderExpenses(expenses, deleteExpense);
    window.UIManager.renderCashRegister(salesLog, expenses);

    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }

    window.UIManager.showToast("🗑️ Gasto eliminado.", "fa-solid fa-trash");
}

// ================= ADMIN EXPENSES TAB (GASTOS DEL LOCAL) =================

let expensesTabFilter = { month: '', category: '', bcvRate: 1 };
let expensesTabCache = {}; // monthISO -> Array
let pnlCache = {};         // `${mode}:${startISO}` -> pnl  (also reset here on expense add/delete; consumed by Task 7)
let pnlMode = 'week';       // 'week' | 'month'
let pnlAnchor = new Date(); // any date inside the selected period
let pnlLast = null;         // last rendered pnl (for the PDF button)

// Plan B, Task 14 (spec §4): the historical/reporting reads below
// (fetchStatsData, fetchExpensesRange, fetchPnlData, fetchDayReport,
// fetchReportDays, fetchSalesHistory, fetchActiveSessions) go straight to
// Postgres on purpose -- they're not part of PowerSync's sync stream, so
// there's no local fallback for them, ever. Before this task they either
// silently returned []/null (a real network failure looks identical to "no
// data exists" -- e.g. fetchReportDays offline used to render "No se
// encontraron reportes recientes", which reads as "nothing happened" when
// really it's "couldn't ask the server") or, in a couple of spots, just did
// nothing at all. This makes the "no conexión" case explicit instead.
function requireOnline(featureName) {
    if (window.SupabaseManager.isConfigured() && navigator.onLine) return true;
    window.UIManager.showToast(`⚠️ ${featureName} requiere conexión a internet`, "fa-solid fa-wifi-slash");
    return false;
}

async function loadAndRenderExpensesTab(forceRefetch = false) {
    if (currentRole !== 'admin') return;
    const monthInput = document.getElementById('admin-expense-filter-month');
    const month = (monthInput && monthInput.value) || new Date().toISOString().slice(0, 7);
    expensesTabFilter.month = month;
    expensesTabFilter.bcvRate = window.bcvRate || 1;

    if (forceRefetch) delete expensesTabCache[month];
    if (!Array.isArray(expensesTabCache[month])) {
        if (requireOnline('Ver gastos de otros meses')) {
            const start = new Date(month + '-01T00:00:00');
            const end = new Date(start); end.setMonth(end.getMonth() + 1);
            expensesTabCache[month] = await window.SupabaseManager.fetchExpensesRange(start.toISOString(), end.toISOString());
        } else {
            // Best-effort degraded view: whatever's in the local operational
            // window (Task 5's local-first expenses) -- complete for the
            // current month, but silently partial for any other month. The
            // toast above is what keeps that from reading as "gastos: $0".
            expensesTabCache[month] = expenses.filter(e => (e.timestamp || '').slice(0, 7) === month);
        }
    }
    window.UIManager.renderAdminExpenses(expensesTabCache[month], expensesTabFilter, handleDeleteAdminExpense);
}

function handleDeleteAdminExpense(uuid) {
    let exp = null;
    Object.keys(expensesTabCache).forEach(m => {
        const hit = (expensesTabCache[m] || []).find(e => e.uuid === uuid);
        if (hit) exp = hit;
    });
    if (exp) {
        const CAT_LABEL = { arriendo: 'Arriendo', sueldos: 'Sueldos', servicios: 'Servicios', otros: 'Otros' };
        const cat = CAT_LABEL[(exp.category || '').toLowerCase()] || 'Otros';
        const orig = (exp.currency || 'USD').toUpperCase() === 'VES'
            ? `Bs. ${(parseFloat(exp.amount) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
            : `$${(parseFloat(exp.amount) || 0).toFixed(2)}`;
        if (!confirm(`¿Eliminar el gasto "${cat} — ${exp.description || ''}" (${orig})?`)) return;
    }
    deleteExpense(uuid);
    Object.keys(expensesTabCache).forEach(m => {
        expensesTabCache[m] = expensesTabCache[m].filter(e => e.uuid !== uuid);
    });
    pnlCache = {}; // P&L numbers changed (defined in Task 7)
    loadAndRenderExpensesTab();
}

function addAdminExpense(e) {
    e.preventDefault();
    const category = document.getElementById('admin-expense-category').value;
    const description = document.getElementById('admin-expense-desc').value.trim();
    const amount = parseFloat(document.getElementById('admin-expense-amount').value);
    const dateStr = document.getElementById('admin-expense-date').value;
    const curBtn = document.querySelector('#admin-expense-currency-toggle .segmented-btn.active');
    const currency = (curBtn && curBtn.dataset.cur) || 'USD';
    if (!description || isNaN(amount) || amount <= 0 || !dateStr) return;

    triggerHaptic(15);
    // noon local so the date can't slip to the previous day via timezone
    const ts = new Date(dateStr + 'T12:00:00').toISOString();
    const newExpense = {
        uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        description, amount, timestamp: ts,
        category,
        currency,
        bcv_rate: currency === 'VES' ? (window.bcvRate || null) : null
    };
    // NB: admin fixed expenses (arriendo/sueldos/servicios) are deliberately NOT
    // pushed into the shift `expenses` array nor persisted via saveExpenses — they
    // must not touch the shift cash register / day-close PDF / other devices. The
    // Gastos tab renders from `expensesTabCache` and the P&L refetches from the
    // server, so neither needs a row here.
    if (window.SupabaseManager.isConfigured()) window.SupabaseManager.insertExpense(newExpense);

    const m = ts.slice(0, 7);
    if (Array.isArray(expensesTabCache[m])) expensesTabCache[m].push(newExpense);
    pnlCache = {};

    document.getElementById('add-admin-expense-form').reset();
    document.getElementById('admin-expense-cur-usd').classList.add('active');
    document.getElementById('admin-expense-cur-ves').classList.remove('active');
    setAdminExpenseDateDefault();
    window.UIManager.showToast('💸 Gasto registrado.', 'fa-solid fa-file-invoice-dollar');
    loadAndRenderExpensesTab();
}

function setAdminExpenseDateDefault() {
    const el = document.getElementById('admin-expense-date');
    if (el && !el.value) el.value = new Date().toISOString().slice(0, 10);
}

// ================= ADMIN GANANCIAS TAB (RESUMEN DE GANANCIAS) =================

function pnlRange(mode, anchor) {
    const d = new Date(anchor);
    if (mode === 'month') {
        const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
        const label = start.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
        return { start, end, label: label.charAt(0).toUpperCase() + label.slice(1) };
    }
    // week: Monday 00:00 -> next Monday 00:00
    const day = (d.getDay() + 6) % 7; // 0 = Monday
    const start = new Date(d); start.setDate(d.getDate() - day); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    const endLbl = new Date(end); endLbl.setDate(end.getDate() - 1);
    const fmt = x => x.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
    return { start, end, label: `Semana ${fmt(start)}–${fmt(endLbl)}` };
}

function pnlCanGoNext() {
    // Build the candidate from the normalized period start (month start = day 1,
    // week start = Monday) so setMonth/+7 can't overflow a 29-31 day-of-month.
    const next = new Date(pnlRange(pnlMode, pnlAnchor).start);
    if (pnlMode === 'month') next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + 7);
    return pnlRange(pnlMode, next).start <= new Date();
}

async function loadPnl(forceRefetch = false) {
    if (currentRole !== 'admin') return;
    const { start, end, label } = pnlRange(pnlMode, pnlAnchor);
    const labelEl = document.getElementById('pnl-period-label');
    if (labelEl) labelEl.textContent = label;
    const nextBtn = document.getElementById('btn-pnl-next');
    if (nextBtn) nextBtn.disabled = !pnlCanGoNext();

    const key = `${pnlMode}:${start.toISOString()}`;
    const container = document.getElementById('admin-pnl-container');
    if (forceRefetch) delete pnlCache[key];

    if (!pnlCache[key]) {
        if (container) container.innerHTML = `<div style="font-size:0.85rem; color:var(--color-text-muted); text-align:center; padding:1.5rem 0;">Cargando resumen...</div>`;
        let sales = [], expenses = [];
        if (window.SupabaseManager.isConfigured() && navigator.onLine) {
            let data = null;
            try {
                data = await window.SupabaseManager.fetchPnlData(start.toISOString(), end.toISOString());
            } catch (err) {
                console.error('loadPnl fetch failed:', err);
            }
            if (!data) {
                // Do NOT cache a failed fetch — offer a retry instead (spec §4.4).
                if (container) {
                    container.innerHTML = `<div style="font-size:0.85rem; color:var(--color-danger); text-align:center; padding:1.5rem 0;">No se pudo cargar el resumen, reintentá.<br><button id="btn-pnl-retry" class="btn-action-small" style="margin-top:0.75rem;"><i class="fa-solid fa-rotate"></i> Reintentar</button></div>`;
                    const retryBtn = document.getElementById('btn-pnl-retry');
                    if (retryBtn) retryBtn.addEventListener('click', () => loadPnl(true));
                }
                return;
            }
            sales = data.sales; expenses = data.expenses;
        } else if (container) {
            container.innerHTML = `<div style="font-size:0.85rem; color:var(--color-danger); text-align:center; padding:1.5rem 0;">Sin conexión — el resumen necesita datos del servidor.<br><button id="btn-pnl-retry-offline" class="btn-action-small" style="margin-top:0.75rem;"><i class="fa-solid fa-rotate"></i> Reintentar</button></div>`;
            const retryBtn = document.getElementById('btn-pnl-retry-offline');
            if (retryBtn) retryBtn.addEventListener('click', () => loadPnl(true));
            return;
        }
        pnlCache[key] = window.AnalyticsManager.aggregatePnl(sales, expenses, products, {
            start, end, periodLabel: label, bcvRate: window.bcvRate || 1
        });
    }
    pnlLast = pnlCache[key];
    window.UIManager.renderPnl(pnlLast, { mode: pnlMode });
}

// ================= ADMIN RENTABILIDAD TAB =================

let rentMode = 'day';          // 'day' | 'week' | 'month' | 'range'
let rentAnchor = new Date();
let rentRangeFrom = null;      // 'YYYY-MM-DD' (modo rango)
let rentRangeTo = null;
let rentCache = {};            // `${startISO}|${endISO}` -> { sales, expenses }
let rentLast = null;
const RENT_REPARTO_KEY = 'casa_lucenzo_reparto';

function rentYmd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rentRange() {
    if (rentMode === 'week' || rentMode === 'month') return pnlRange(rentMode, rentAnchor);
    if (rentMode === 'range') {
        const today = rentYmd(new Date());
        const from = rentRangeFrom || today;
        const to = rentRangeTo && rentRangeTo >= from ? rentRangeTo : from;
        const start = new Date(from + 'T00:00:00');
        const end = new Date(to + 'T00:00:00'); end.setDate(end.getDate() + 1);
        const fmt = x => x.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
        const endLbl = new Date(to + 'T00:00:00');
        return { start, end, label: from === to ? fmt(start) : `${fmt(start)} – ${fmt(endLbl)}` };
    }
    const start = new Date(rentAnchor); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 1);
    const isToday = rentYmd(start) === rentYmd(new Date());
    const lbl = start.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' });
    return { start, end, label: (isToday ? 'Hoy, ' : '') + lbl };
}

function rentStep(dir) {
    const d = new Date(rentRange().start);
    if (rentMode === 'month') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + (rentMode === 'week' ? 7 : 1) * dir);
    return d;
}

// Cada persona tiene dos porcentajes: `pct` (reparto de los pastelitos, el de
// siempre) y `pctOtros` (reparto de lo demás). Si un teléfono todavía no tiene
// `pctOtros` guardado, arranca con el mismo porcentaje de los pastelitos.
function loadRentShares() {
    let list = null;
    try {
        const raw = localStorage.getItem(RENT_REPARTO_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) list = parsed;
    } catch (e) { /* sin almacenamiento: usar los de siempre */ }
    if (!list) list = window.AnalyticsManager.REPARTO_DEFAULT.map(x => ({ ...x }));
    return list.map(x => ({
        nombre: x.nombre,
        pct: Number(x.pct) || 0,
        pctOtros: x.pctOtros == null || x.pctOtros === '' ? (Number(x.pct) || 0) : (Number(x.pctOtros) || 0)
    }));
}

/** Los dos repartos (pastelitos y lo demás) con sus bases, para la pantalla y el PDF. */
function rentRepartoBlocks() {
    const split = window.AnalyticsManager.splitRepartoBases(rentLast);
    return [
        { field: 'pct', titulo: 'Reparto de los pastelitos', baseBs: split.pasteles.baseBs, gananciaBs: split.pasteles.gananciaBs, gastosBs: split.pasteles.gastosBs },
        { field: 'pctOtros', titulo: 'Reparto de lo demás (bebidas, dulces, cajas, extras)', baseBs: split.otros.baseBs, gananciaBs: split.otros.gananciaBs, gastosBs: 0 }
    ];
}

function saveRentShares(list) {
    try { localStorage.setItem(RENT_REPARTO_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

function renderRentExtras() {
    window.UIManager.renderRentReparto(rentRepartoBlocks(), loadRentShares(), {
        onChange: list => { saveRentShares(list); renderRentExtras(); },
        onReset: () => { try { localStorage.removeItem(RENT_REPARTO_KEY); } catch (e) { /* ignore */ } renderRentExtras(); }
    });
    window.UIManager.renderRentCosts(products, saveProductCostFromRent);
}

// moneda 'usd': el monto es el costo en dólares; se guarda en cost_usd y en
// cost queda su equivalente en Bs con la tasa de hoy. Cada venta luego usa la
// tasa de su momento (cost_at_sale), así que los días viejos no cambian.
async function saveProductCostFromRent(productId, amount, moneda = 'bs') {
    if (currentRole !== 'admin') return;
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const enUsd = moneda === 'usd';
    if (enUsd && !(bcvRate > 0)) {
        window.UIManager.showToast('❌ No hay tasa del día. Actualiza la tasa e intenta de nuevo.', 'fa-solid fa-circle-xmark');
        return;
    }
    const costUsd = enUsd && amount > 0 ? amount : null;
    const costBs = enUsd ? Math.round(amount * bcvRate * 100) / 100 : amount;
    const before = parseFloat(product.cost) || 0;
    const beforeUsd = product.cost_usd > 0 ? product.cost_usd : null;
    if (before === costBs && beforeUsd === costUsd) { window.UIManager.showToast('Sin cambios.', 'fa-solid fa-circle-info'); return; }
    product.cost = costBs; // solo el costo: el precio de venta no se toca
    product.cost_usd = costUsd;
    window.StorageManager.saveProducts(products);
    let ok = true;
    if (window.SupabaseManager.isConfigured()) ok = await window.SupabaseManager.updateProductCost(productId, costBs, costUsd);
    if (!ok) {
        product.cost = before;
        product.cost_usd = beforeUsd;
        window.StorageManager.saveProducts(products);
        window.UIManager.showToast('❌ No se pudo guardar el costo. Revisa la conexión.', 'fa-solid fa-circle-xmark');
        renderRentExtras();
        return;
    }
    const fmtBefore = beforeUsd ? `$${beforeUsd.toFixed(2)}` : `Bs.${before.toFixed(2)}`;
    const fmtAfter = costUsd ? `$${costUsd.toFixed(2)} (Bs.${costBs.toFixed(2)} a tasa ${bcvRate})` : `Bs.${costBs.toFixed(2)}`;
    logActivity('Costo Editado', `Rentabilidad: ${product.name} costo ${fmtBefore} → ${fmtAfter}`);
    window.UIManager.showToast(costUsd
        ? `✅ Costo de ${product.name}: $${costUsd.toLocaleString('es-VE')} (hoy Bs ${costBs.toLocaleString('es-VE')})`
        : `✅ Costo de ${product.name}: Bs ${costBs.toLocaleString('es-VE')}`, 'fa-solid fa-check');
    loadRentabilidad();
}

async function loadRentabilidad(forceRefetch = false) {
    if (currentRole !== 'admin') return;
    const { start, end, label } = rentRange();
    const labelEl = document.getElementById('rent-period-label');
    if (labelEl) labelEl.textContent = label;
    const nextBtn = document.getElementById('btn-rent-next');
    if (nextBtn) nextBtn.disabled = rentStep(1) > new Date();
    document.querySelectorAll('#rent-mode-toggle .segmented-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === rentMode));
    const nav = document.getElementById('rent-nav');
    const rangeBox = document.getElementById('rent-range');
    if (nav) nav.classList.toggle('hidden', rentMode === 'range');
    if (rangeBox) rangeBox.classList.toggle('hidden', rentMode !== 'range');

    const container = document.getElementById('admin-rent-container');
    const key = `${start.toISOString()}|${end.toISOString()}`;
    if (forceRefetch) delete rentCache[key];

    if (!rentCache[key]) {
        if (container) container.innerHTML = `<div style="font-size:0.85rem; color:var(--color-text-muted); text-align:center; padding:1.5rem 0;">Cargando rentabilidad...</div>`;
        let data = null;
        if (window.SupabaseManager.isConfigured() && navigator.onLine) {
            try { data = await window.SupabaseManager.fetchPnlData(start.toISOString(), end.toISOString()); }
            catch (err) { console.error('loadRentabilidad fetch failed:', err); }
        }
        if (!data) {
            if (container) {
                container.innerHTML = `<div style="font-size:0.85rem; color:var(--color-danger); text-align:center; padding:1.5rem 0;">No se pudo cargar (¿sin conexión?).<br><button id="btn-rent-retry" class="btn-action-small" style="margin-top:0.75rem;"><i class="fa-solid fa-rotate"></i> Reintentar</button></div>`;
                const retry = document.getElementById('btn-rent-retry');
                if (retry) retry.addEventListener('click', () => loadRentabilidad(true));
            }
            rentLast = null;
            renderRentExtras();
            return;
        }
        rentCache[key] = data;
    }
    // Se recalcula siempre con el catálogo actual, así un costo recién cargado se ve al instante.
    rentLast = window.AnalyticsManager.aggregateRentabilidad(rentCache[key].sales, products, {
        start, end, periodLabel: label, bcvRate: window.bcvRate || 1, expenses: rentCache[key].expenses, soloConCosto: true
    });
    window.UIManager.renderRentabilidad(rentLast);
    renderRentExtras();
}

function initRentabilidadListeners() {
    document.querySelectorAll('#rent-mode-toggle .segmented-btn').forEach(b => b.addEventListener('click', () => {
        triggerHaptic(10);
        rentMode = b.dataset.mode;
        rentAnchor = new Date();
        if (rentMode === 'range') {
            const today = rentYmd(new Date());
            const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
            rentRangeFrom = rentRangeFrom || rentYmd(weekAgo);
            rentRangeTo = rentRangeTo || today;
            const f = document.getElementById('rent-range-from');
            const t = document.getElementById('rent-range-to');
            if (f) { f.value = rentRangeFrom; f.max = today; }
            if (t) { t.value = rentRangeTo; t.max = today; }
        }
        loadRentabilidad();
    }));
    const prev = document.getElementById('btn-rent-prev');
    if (prev) prev.addEventListener('click', () => { triggerHaptic(10); rentAnchor = rentStep(-1); loadRentabilidad(); });
    const next = document.getElementById('btn-rent-next');
    if (next) next.addEventListener('click', () => { triggerHaptic(10); if (rentStep(1) <= new Date()) { rentAnchor = rentStep(1); loadRentabilidad(); } });
    const apply = document.getElementById('btn-rent-range-apply');
    if (apply) apply.addEventListener('click', () => {
        triggerHaptic(10);
        const f = document.getElementById('rent-range-from');
        const t = document.getElementById('rent-range-to');
        rentRangeFrom = f && f.value ? f.value : rentRangeFrom;
        rentRangeTo = t && t.value ? t.value : rentRangeTo;
        if (rentRangeFrom && rentRangeTo && rentRangeTo < rentRangeFrom) {
            const x = rentRangeFrom; rentRangeFrom = rentRangeTo; rentRangeTo = x;
            if (f) f.value = rentRangeFrom; if (t) t.value = rentRangeTo;
        }
        loadRentabilidad();
    });
    const refresh = document.getElementById('btn-rent-refresh');
    if (refresh) refresh.addEventListener('click', () => { triggerHaptic(10); loadRentabilidad(true); });
    const pdfBtn = document.getElementById('btn-rent-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', () => { triggerHaptic(10); generateRentabilidadPdf(pdfBtn); });
}

/**
 * PDF de lo que se ve en la pestaña Rentabilidad (el período elegido, con el
 * reparto guardado en este teléfono). El servidor solo dibuja los números que
 * se le mandan; no cambia nada en la base. Al terminar muestra la tarjeta
 * Compartir (WhatsApp) igual que el PDF del cierre.
 */
async function generateRentabilidadPdf(btn) {
    if (currentRole !== 'admin') return;
    if (!rentLast || !rentLast.totals || rentLast.totals.unidades === 0) {
        window.UIManager.showToast('No hay ventas en este período para sacar el PDF.', 'fa-solid fa-circle-info');
        return;
    }
    if (!requireOnline('Generar el PDF de rentabilidad')) return;
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> PDF...'; }
    try {
        const shares = loadRentShares();
        const repartos = rentRepartoBlocks().map(b => {
            const rep = window.AnalyticsManager.computeReparto(b.baseBs, shares.map(x => ({ nombre: x.nombre, pct: x[b.field] })));
            return { titulo: b.titulo, baseBs: b.baseBs, gananciaBs: b.gananciaBs, gastosBs: b.gastosBs, filas: rep.filas, quedaPct: rep.quedaPct, quedaBs: rep.quedaBs };
        });
        const payload = {
            label: rentLast.period.label,
            mode: rentMode,
            rate: window.bcvRate || 0,
            totals: rentLast.totals,
            categorias: rentLast.categorias,
            dias: rentLast.dias,
            excluidas: rentLast.excluidas,
            delivery: rentLast.delivery,
            extrasSinCosto: rentLast.extrasSinCosto,
            repartos
        };
        const resp = await fetch(`${API_BASE}/api/rentabilidad-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const slug = String(rentLast.period.label).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        showPdfBlobShareCard(blob, `rentabilidad-${slug || 'periodo'}-casa-lucenzo.pdf`, `Rentabilidad ${rentLast.period.label} - Casa Lucenzo`);
    } catch (e) {
        console.error('generateRentabilidadPdf failed:', e);
        window.UIManager.showToast('❌ No se pudo generar el PDF. Revisa la conexión.', 'fa-solid fa-circle-xmark');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
}

/** Tarjeta "PDF listo" con Compartir (WhatsApp) / Abrir para un PDF que ya está en memoria. */
function showPdfBlobShareCard(blob, fileName, shareTitle) {
    let file = null;
    try {
        const f = new window.File([blob], fileName, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) file = f;
    } catch (e) { /* sin compartir archivos: el botón abre el PDF */ }
    const url = URL.createObjectURL(blob);

    document.getElementById('day-report-share-card')?.remove();
    const card = document.createElement('div');
    card.id = 'day-report-share-card';
    card.style.cssText = 'position:fixed;left:50%;bottom:calc(1.25rem + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:10050;display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0.7rem 0.6rem 0.9rem;border-radius:14px;background:#0f2a52;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.35);font-size:0.8125rem;max-width:calc(100vw - 32px);';
    card.innerHTML = `
        <i class="fa-solid fa-file-pdf" style="color: var(--color-danger);"></i>
        <span style="font-weight:700;white-space:nowrap;">PDF de rentabilidad listo</span>
        <button type="button" data-act="open" style="height:34px;padding:0 0.7rem;border:1px solid rgba(255,255,255,0.35);border-radius:10px;background:transparent;color:#fff;font-weight:700;cursor:pointer;">Abrir</button>
        ${file ? `<button type="button" data-act="share" style="height:34px;padding:0 0.8rem;border:none;border-radius:10px;background:#25d366;color:#fff;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:0.3rem;"><i class="fa-brands fa-whatsapp"></i> Compartir</button>` : ''}
        <button type="button" data-act="close" aria-label="Cerrar" style="height:34px;width:34px;border:none;border-radius:10px;background:transparent;color:#cbd5e1;cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>`;
    document.body.appendChild(card);

    const remove = () => { card.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
    const timer = setTimeout(remove, 120000);
    card.querySelector('[data-act="close"]').addEventListener('click', () => { clearTimeout(timer); remove(); });
    card.querySelector('[data-act="open"]').addEventListener('click', () => { triggerHaptic(15); window.open(url, '_blank'); });
    const share = card.querySelector('[data-act="share"]');
    if (share) share.addEventListener('click', async () => {
        triggerHaptic(15);
        try {
            await navigator.share({ files: [file], title: shareTitle });
            clearTimeout(timer);
            remove();
        } catch (e) {
            if (e && e.name !== 'AbortError') window.open(url, '_blank');
        }
    });
}
