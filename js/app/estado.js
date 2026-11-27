// Estado de la app (productos, ventas, carrito, rol, tasa BCV…), arranque y utilidades de stock.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// Main App Orchestration Module

// Local app state
// Fixed-Bs promo and combos (js/combos.js, loaded before this file; required in tests).
const Combos = (typeof window !== 'undefined' && window.Combos) || (typeof require === 'function' ? require('./combos') : null);
let products = [];
let salesLog = [];
let expenses = [];
let debts = [];
let replenishments = [];
let ingredients = [];
let pedidosOnline = [];
let activeCategory = 'todos';
let searchQuery = '';
let currentCart = [];
let costInsumos = [];
let paymentStatsFilter = 'day';
let categoryStatsFilter = 'day';

let lastCloseTime = null;

// Re-entrancy guard so a double tap on "¡Ya llegó!" cannot load a batch twice
let isConfirmingReceipt = false;

// Quick-access PINs for role switching (never declared before — was relying on
// implicit globals, which throws ReferenceError in strict mode and is undefined
// until the first assignment ever runs, e.g. before fetchAppConfig() resolves)
let pinLocal = null;
let pinCocina = null;
let pinAdmin = null;

// Sound and vibration preferences
let preferences = { sound: true, vibration: true, supabaseUrl: '', supabaseKey: '' };

// User access role
let currentRole = null;

// BCV Exchange Rate state
let bcvRate = 732.48;
let useAutoBcv = true;
let bcvLastFetchTime = null;

// Current report data displayed in the day close modal
let currentReportData = { sales: [], expenses: [] };

// Global cache for admin statistics and hourly chart mode
let hourlyActiveMode = 'today';
let adminStatsSales = [];
// Gastos de los 7 días, cacheados junto a `adminStatsSales` para que el
// handler de realtime pueda calcular el delta de gastos con el dataset bueno.
let adminStatsExpenses = [];
// ¿`adminStatsSales`/`adminStatsExpenses` traen de verdad la semana completa?
// Solo es cierto si `fetchStatsData()` respondió. Sin conexión ambos caen al
// dato local del turno, y ahí los deltas mentirían.
let adminStatsFullHistory = false;

// Analytics tab state: cached sales history keyed by lookback range (days),
// so switching 30/60/90/Todo or the hoy/mañana toggle doesn't always refetch.
// 0 means "sin recorte de fecha" -- fetch the full sales history.
let analyticsRangeDays = 60;
let analyticsPrepMode = 'today'; // 'today' | 'tomorrow'
const analyticsSalesCache = {};

// Full (unfiltered) set from the last Bitácora fetch -- the search box
// filters this client-side instead of re-querying Supabase per keystroke.
let currentActivityLogs = [];

function getAnalyticsPrepWeekday() {
    const now = new Date();
    if (analyticsPrepMode === 'tomorrow') {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        return tomorrow.getDay();
    }
    return now.getDay();
}

// Unique device identifier for active session management
let myDeviceId = localStorage.getItem('casa_lucenzo_device_id');
if (!myDeviceId) {
    myDeviceId = crypto.randomUUID ? crypto.randomUUID() : 'dev_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('casa_lucenzo_device_id', myDeviceId);
}

// ================= SELF-HEALING SENTINEL =================

/**
 * Manual "Limpiar Caché" action for the apertura/cierre routine. PowerSync
 * owns write persistence and retry now (Plan B, Task 12 -- there is no
 * client-side queue left to sync), so this no longer forces a sync attempt.
 * What's left, still genuinely useful on its own: surface + let an admin
 * discard sales this device quarantined (found missing from the server with
 * nothing to explain the gap -- see the reconciliation note in
 * loadAllDataFromSupabase), then drop this device's cached app code so it's
 * always running what's actually deployed.
 */
async function handleCleanOfflineCache() {
    const btn = document.getElementById('btn-clean-offline-cache');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    triggerHaptic(15);

    try {
        if (!navigator.onLine) {
            window.UIManager.showToast("📡 Sin conexión: conectate a internet para traer la última versión.", "fa-solid fa-wifi-slash");
            return;
        }

        // Sales this device set aside because the server no longer had them and
        // nothing explained why. Surfaced here rather than left to rot: it is
        // the one place someone looks at sync health on purpose.
        const quarantined = window.StorageManager.loadQuarantinedSales();
        if (quarantined.length > 0) {
            const total = quarantined.reduce((sum, q) => sum + ((q.sale && q.sale.price) || 0), 0);
            const detail = quarantined.slice(0, 8)
                .map(q => `• ${q.sale && q.sale.name ? q.sale.name : '(sin nombre)'} — $${((q.sale && q.sale.price) || 0).toFixed(2)}`)
                .join('\n');
            const more = quarantined.length > 8 ? `\n…y ${quarantined.length - 8} más.` : '';
            const keep = confirm(
                `📋 Este dispositivo apartó ${quarantined.length} venta(s) por $${total.toFixed(2)} que ya no estaban en el servidor:\n\n${detail}${more}\n\n` +
                `Se apartaron en vez de borrarse, por si alguna era real y nunca llegó a guardarse. Si ya revisaste el sistema y los números están bien, se pueden descartar.\n\n` +
                `¿Descartarlas definitivamente?  (Aceptar = descartar · Cancelar = conservarlas)`
            );
            if (keep) {
                logActivity("Descarte de Ventas en Cuarentena", `Se descartaron ${quarantined.length} venta(s) apartadas por $${total.toFixed(2)} tras revisión manual del administrador.`);
                window.StorageManager.clearQuarantinedSales();
            }
        } else {
            window.UIManager.showToast("✅ No había ventas en cuarentena.", "fa-solid fa-circle-check");
        }

        // Drop this device's cached app code so it's always running what's
        // actually deployed -- an old cached service worker is exactly how
        // a device keeps running a version with a bug already fixed server-side.
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) await reg.unregister();
        }
        if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }

        window.UIManager.showToast("🔄 Recargando con la última versión...", "fa-solid fa-rotate");
        setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
        console.error("Error en limpieza manual de caché offline:", e);
        window.UIManager.showToast("❌ Error al limpiar. Revisá la consola.", "fa-solid fa-circle-xmark");
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}
window.handleCleanOfflineCache = handleCleanOfflineCache;

function sanitizeDataIntegrity(log) {
    if (!Array.isArray(log)) return [];
    const seenUuids = new Set();
    return log.filter(s => {
        if (!s || typeof s !== 'object') return false;
        if (!s.name || typeof s.name !== 'string') return false;
        if (typeof s.price !== 'number' || isNaN(s.price) || s.price < 0) return false;
        if (s.uuid) {
            if (seenUuids.has(s.uuid)) return false;
            seenUuids.add(s.uuid);
        }
        return true;
    });
}

// Aviso "Sin Internet" de la cabecera. Desde que se quitó PowerSync (v1.0.65)
// todo va directo a Supabase, así que lo único que vale la pena avisar es que
// el navegador se quedó sin internet.
function updateSyncStatusUI() {
    const b = document.getElementById('header-offline-badge');
    const c = document.getElementById('header-offline-count');
    if (!b || !c) return;
    if (navigator.onLine === false) {
        b.style.display = 'flex';
        b.style.background = 'rgba(239, 68, 68, 0.2)';
        b.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        b.style.color = '#F87171';
        c.textContent = '⚡ Sin Internet';
        b.title = 'Este equipo no tiene internet';
    } else {
        b.style.display = 'none';
    }
}
window.updateSyncStatusUI = updateSyncStatusUI;

function initSelfHealingSentinel() {
    // Intercept unhandled errors & promise rejections to prevent crashing UI
    window.addEventListener('error', (event) => {
        console.warn('Self-Healing Sentinel caught error:', event.message, event.filename, event.lineno);
        if (event && event.preventDefault) event.preventDefault();
    });

    window.addEventListener('unhandledrejection', (event) => {
        console.warn('Self-Healing Sentinel caught promise rejection:', event.reason);
        if (event && event.preventDefault) event.preventDefault();
    });
}

// Call Self-Healing Sentinel initialization immediately
initSelfHealingSentinel();

// ================= HANDLERS & LOGIC =================

/**
 * Short haptic pulse trigger for mobile screens
 * @param {number|Array} pattern Milliseconds pattern list (e.g. 15 or [50, 50, 50])
 */
function triggerHaptic(pattern) {
    if (preferences.vibration && 'vibrate' in navigator) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // Silently absorb blocks
        }
    }
}

/**
 * Handle category filtering tab changes
 * @param {string} catId Category ID
 */
function handleCategoryChange(catId) {
    activeCategory = catId;
    triggerHaptic(15);
    window.UIManager.renderCategoryFilterBar(activeCategory, handleCategoryChange, products);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
}

/**
 * Handle product searching inputs
 * @param {string} query Search input string
 */
function handleSearchChange(query) {
    searchQuery = query;
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
}

/**
 * Vitrina capacity for a product ("X / max" and the "falta cocinar" figure).
 * Never below what is physically on the shelf, and never grows on its own --
 * the old `max = max + diff` accumulated across days and told the kitchen to
 * cook batches that nobody had loaded.
 * @param {Object} product Product to measure
 * @returns {number} Capacity to store in `max`
 */
function resolveVitrinaCapacity(product) {
    return Math.max(product.max || 0, product.stock || 0);
}

/**
 * Single source of truth for putting stock INTO the vitrina.
 *
 * `initial_stock` is the day's baseline: everything the vitrina received since
 * the last cierre de jornada. Every "vendidos reales" figure in the app is
 * `initial_stock - stock`, so a path that raises `stock` without raising the
 * baseline by the same amount silently zeroes out the day's numbers. Route
 * every load through here so the two can never drift apart.
 *
 * @param {Object} product Product to replenish (mutated in place)
 * @param {number} amountToAdd Pieces entering the vitrina (must be > 0)
 * @returns {boolean} True when the load was applied
 */
function applyStockLoad(product, amountToAdd) {
    const amount = parseInt(amountToAdd, 10);
    if (!product || isNaN(amount) || amount <= 0) return false;

    product.stock = (product.stock || 0) + amount;
    product.initial_stock = (product.initial_stock || 0) + amount;
    product.max = resolveVitrinaCapacity(product);
    return true;
}

/**
 * Set a product's physical count to an absolute value (a recount from the
 * edit modal, or a "fijar stock" order from the bot). Raising it is a load, so
 * the day's baseline follows it; lowering it is a physical correction, so the
 * baseline stays put and the missing pieces surface in the Conciliación
 * instead of quietly disappearing from the day's totals.
 * @param {Object} product Product to adjust (mutated in place)
 * @param {number} targetStock Absolute count now on the shelf
 */
function applyStockCount(product, targetStock) {
    if (!product) return;
    const target = Math.max(0, parseInt(targetStock, 10) || 0);
    const current = product.stock || 0;

    if (target > current) {
        applyStockLoad(product, target - current);
        return;
    }

    product.stock = target;
    product.max = resolveVitrinaCapacity(product);
}

/**
 * Plan B, Task 6: single choke point for persisting a stock change.
 * Records the movement in stock_movements (append-only, spec §5.1a) instead
 * of writing products.stock/max/initial_stock directly -- Postgres'
 * recompute_product_stock() (migracion 033) derives those from the sum of
 * these movements. Silently skips a zero delta: nothing physically moved
 * (e.g. a recount clamped to the same value), so there's nothing to log.
 * @param {Object} product Product the movement applies to
 * @param {number} delta Signed change actually applied to product.stock
 * @param {'load'|'sale'|'sale_return'|'count_down'} type Movement kind (spec §5.1a)
 * @param {string} [sourceUuid] Traceability link (e.g. the replenishment uuid for a 'load')
 */
function recordStockMovement(product, delta, type, sourceUuid) {
    if (!delta) return;
    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.insertStockMovement({
            productId: product.id, delta, type, sourceUuid: sourceUuid || null, deviceId: myDeviceId
        });
    }
}

/**
 * Dollar price a sale is recorded at. A product with a fixed bolívar price
 * (price_bs, set by hand in "Editar producto") charges price_bs / rate, with
 * six decimals so the Bs total lands on the cent. products.price is never
 * touched -- it stays the fallback for every product without price_bs.
 * Exported for tests.
 * @param {Object} product Product being sold
 * @param {number} rate BCV rate in Bs per dollar
 * @returns {number}
 */
function saleUsdPrice(product, rate, date) {
    const bs = fixedBsToday(product, date);
    return bsToUsd(bs, rate) || (product && product.price) || 0;
}

/** Bs -> $ with six decimals so the Bs total lands on the cent; 0 if it can't. */
function bsToUsd(bs, rate) {
    if (bs > 0 && rate > 0) return Math.round((bs / rate) * 1e6) / 1e6;
    return 0;
}

/**
 * Fixed bolívar price of a loose item: price_bs. The weekday promo from
 * js/combos.js only applies inside a combo (see addComboToCart).
 * @returns {number} 0 when the product has no fixed Bs price
 */
function fixedBsToday(product, date) {
    if (Combos) return Combos.fixedBsPrice(product, date);
    const bs = parseFloat(product && product.price_bs);
    return bs > 0 ? bs : 0;
}

/**
 * Cart line identity. A combo line ("Pollo · Combo Clásico") is the same
 * product as a loose one but a different price, so it keeps its own line.
 */
function cartKeyOf(item) {
    return item.combo ? `${item.productId}|${item.combo}` : item.productId;
}
