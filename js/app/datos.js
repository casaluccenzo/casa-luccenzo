// Carga de datos (Supabase/local), estadísticas del panel, usuarios y tiempo real.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// ================= DATA SYNCHRONIZATION FROM CLOUD =================

// Tracks the last time data was actually confirmed fresh from Supabase (a
// full poll or a live realtime message), shown in Resumen so a stale device
// (screen locked/backgrounded, browser throttles its timers) is visibly
// distinguishable from a live one instead of silently showing an old number.
let lastSyncAt = null;

function markSyncFresh() {
    lastSyncAt = new Date();
    updateSyncFreshnessDisplay();
}

function updateSyncFreshnessDisplay() {
    const el = document.getElementById('resumen-last-sync');
    if (!el || !lastSyncAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - lastSyncAt.getTime()) / 1000));
    let text;
    if (seconds < 5) {
        text = 'justo ahora';
    } else if (seconds < 60) {
        text = `hace ${seconds}s`;
    } else {
        const minutes = Math.floor(seconds / 60);
        text = `hace ${minutes} min`;
    }
    el.innerHTML = `<i class="fa-solid fa-rotate"></i> Actualizado ${text}`;
}

/**
 * Loads today's records and stocks from Supabase database
 */
async function loadAllDataFromSupabase() {
    console.log("Loading dashboard statistics and logs from Supabase...");
    
    // 1. Fetch app configuration first (to get exchange rate, 2FA status, and day close timestamps)
    const supConfig = await window.SupabaseManager.fetchAppConfig();
    if (supConfig) {
        bcvRate = parseFloat(supConfig.bcv_rate) || 732.48;
        useAutoBcv = supConfig.use_auto_bcv !== false;
        window.bcvRate = bcvRate;
        window.StorageManager.saveBcvPreferences(bcvRate, useAutoBcv);


        // Load Day Close status
        if (window.SupabaseManager.getDbSupportsLastClose() && supConfig.last_close_time) {
            lastCloseTime = supConfig.last_close_time;
            window.StorageManager.saveLastCloseTime(lastCloseTime);
        } else {
            lastCloseTime = window.StorageManager.loadLastCloseTime();
        }

        // Sync DOM components
        const autoCheckbox = document.getElementById('pref-bcv-auto');
        const bcvRateInput = document.getElementById('pref-bcv-rate');
        const headerBcvInput = document.getElementById('header-bcv-rate-input');
        if (autoCheckbox) autoCheckbox.checked = useAutoBcv;
        if (bcvRateInput) {
            bcvRateInput.value = bcvRate;
            bcvRateInput.disabled = useAutoBcv;
        }
        if (headerBcvInput) headerBcvInput.value = bcvRate;

        // NOTE: the live BCV rate is NOT fetched here. This function runs on the
        // periodic background re-sync, and calling fetchBcvRate() on every cycle
        // meant two slow external API calls + (pre-guard) a full re-render every
        // time. The rate is refreshed on its own schedule: on app load, every
        // 6h, on tab-focus when >=6h stale, and on day close. Any rate another
        // device pushed is still picked up above via supConfig.bcv_rate.
    } else {
        lastCloseTime = window.StorageManager.loadLastCloseTime();
    }

    // 2. Fetch all other datasets in parallel to reduce network latency and roundtrips
    // (fetchUsers() used to run here too -- it always failed against a 'users'
    // table that doesn't exist (public.profiles replaced it), and its result
    // was discarded either way since supUsers was never truthy. Removed to
    // stop the guaranteed PGRST205 warning and wasted round-trip on every load.)
    const [supProducts, supSales, supExpenses, supDebts, supRepls, supIng, supPedidos] = await Promise.all([
        window.SupabaseManager.fetchProducts(),
        window.SupabaseManager.fetchSales(),
        window.SupabaseManager.fetchExpenses(),
        window.SupabaseManager.fetchDebts(),
        window.SupabaseManager.fetchReplenishments(),
        window.SupabaseManager.fetchIngredients(),
        window.SupabaseManager.fetchPedidosOnline()
    ]);

    if (supPedidos) {
        pedidosOnline = supPedidos;
    }

    // Save and load products (auto-merge missing default products like dulces)
    if (supProducts && supProducts.length > 0) {
        products = supProducts.map(p => ({
            ...p,
            category: window.StorageManager ? window.StorageManager.getProductCategory(p) : (p.category || 'pastelitos')
        }));
    } else {
        products = window.StorageManager.loadProducts();
    }

    window.StorageManager.saveProducts(products);
    
    // Save and load sales (merge local sales if any were saved offline or during schema mismatch)
    const deletedUuidsSet = new Set(window.StorageManager.loadDeletedSalesUuids() || []);
    const lastCloseDate = lastCloseTime ? window.parseUTCTimestamp(lastCloseTime) : null;

    const rawLocalSales = (window.StorageManager.loadSalesLog() || []).filter(s => !s.uuid || !deletedUuidsSet.has(s.uuid));
    const localSales = rawLocalSales.filter(s => {
        if (!s || !s.timestamp) return false;
        if (lastCloseDate) {
            try {
                return window.parseUTCTimestamp(s.timestamp) >= lastCloseDate;
            } catch (e) {
                return false;
            }
        }
        return true;
    });

    if (supSales && supSales.length > 0) {
        const cleanSupSales = supSales.filter(s => !s.uuid || !deletedUuidsSet.has(s.uuid));
        const supUuids = new Set(cleanSupSales.map(s => s.uuid));
        const missingLocal = localSales.filter(s => s.uuid && !supUuids.has(s.uuid));

        // A sale sitting in THIS device's cache but missing from the server
        // isn't always a failed offline write -- it can also be a row an
        // admin deliberately deleted server-side (a data correction). This
        // device has no local record of that: the delete tombstone above is
        // only written by handleUndoSale() on the SAME device that did the
        // undo. Blindly re-inserting every "missing" local row used to
        // resurrect a corrected/deleted account on its own every ~45s, on
        // any device that still had the old data cached, no matter how many
        // times it got cleaned up on the server (2026-08-14, "La guaira").
        //
        // Plan B, Task 12: this used to "corroborate" a gap against the old
        // offline queue's pending UUIDs before deciding whether to
        // auto-restore it -- that queue is gone now (insertSale/insertSales
        // write local-first straight into PowerSync's `sales` view, so
        // fetchSales() already includes anything this device wrote but
        // hasn't uploaded yet; supSales and localSales should only actually
        // diverge here in the narrow pre-first-sync window). Without a queue
        // left to corroborate against, treat every gap the same, safe way:
        // never silently re-insert, always quarantine for a human to review
        // ("Limpiar Caché" surfaces it). Losing a rare, real pending sale to
        // manual review is a far smaller failure than the old bug this
        // guarded against.
        salesLog = [...cleanSupSales];

        if (missingLocal.length > 0) {
            window.StorageManager.addQuarantinedSales(
                missingLocal,
                'Faltaba en el servidor tras la sincronización'
            );
            console.warn(`${missingLocal.length} local sale(s) missing from the server -- moved to quarantine for manual review.`, missingLocal.map(s => s.uuid));
        }
        window.StorageManager.saveSalesLog(salesLog);
    } else if (localSales.length > 0) {
        salesLog = localSales;
    } else {
        salesLog = [];
    }

    // Clean any temporary auto-injected test sales from salesLog and sanitize integrity
    salesLog = sanitizeDataIntegrity(salesLog.filter(s => !s.uuid || !s.uuid.startsWith('chica_')));
    window.StorageManager.saveSalesLog(salesLog);

    // Save and load expenses
    if (supExpenses) {
        expenses = supExpenses;
        window.StorageManager.saveExpenses(expenses);
    } else {
        expenses = window.StorageManager.loadExpenses();
    }

    // Save and load debts
    if (supDebts) {
        debts = supDebts;
        window.StorageManager.saveDebts(debts);
    } else {
        debts = window.StorageManager.loadDebts();
    }

    // Save and load replenishments (never resurrect a batch already loaded into
    // the vitrina -- its DELETE may not have committed before this fetch ran)
    const consumedRepls = new Set(window.StorageManager.loadConsumedReplenishmentUuids());
    if (supRepls) {
        replenishments = supRepls.filter(r => !consumedRepls.has(r.uuid));
        window.StorageManager.saveReplenishments(replenishments);
    } else {
        replenishments = window.StorageManager.loadReplenishments().filter(r => !consumedRepls.has(r.uuid));
    }

    // Save and load raw ingredients
    if (supIng && supIng.length > 0) {
        ingredients = supIng;
        window.StorageManager.saveIngredients(ingredients);
    } else {
        ingredients = window.StorageManager.loadIngredients();
    }

    // Refresco general (al abrir, cada 3 min, al volver a la app): puede reusar
    // la semana de ventas del Resumen si se bajó hace < 60 s y no cambió nada.
    renderAllViews({ statsMaxAgeMs: 60 * 1000 });
    markSyncFresh();
}

/**
 * Fallback to standard offline localStorage values
 */
function loadAllDataFromLocalStorage() {
    products = window.StorageManager.loadProducts();
    salesLog = window.StorageManager.loadSalesLog();
    expenses = window.StorageManager.loadExpenses();
    debts = window.StorageManager.loadDebts();
    replenishments = window.StorageManager.loadReplenishments();
    ingredients = window.StorageManager.loadIngredients();
    
    const bcvPrefs = window.StorageManager.loadBcvPreferences();
    bcvRate = bcvPrefs.bcvRate || 732.48;
    useAutoBcv = bcvPrefs.useAutoBcv !== false;
    window.bcvRate = bcvRate;
    


    // Load last close time from localStorage
    lastCloseTime = window.StorageManager.loadLastCloseTime();

    renderAllViews();
}

// Velocidad (2026-11-16): la semana de ventas del Resumen del admin se bajaba
// completa en CADA renderAllViews -- al abrir la app se pedía 2-3 veces seguidas
// (applyUserRole y luego el refresco general), y otra vez en cada foco/refresco.
// Ahora la ruta de refresco general (loadAllDataFromSupabase) puede reusar la
// última descarga si tiene menos de `statsMaxAgeMs` Y no llegó ninguna venta,
// gasto o cierre por tiempo real desde entonces (adminStatsDataVersion). Todas
// las demás llamadas (abrir la pestaña, después de cobrar, cierre de jornada,
// deshacer/corregir) siguen bajando datos frescos como antes.
let adminStatsDataVersion = 0;
let adminStatsDataCache = null; // { data, at, version }
let adminStatsDataInFlight = null; // { promise, version }
function invalidateAdminStatsCache() {
    adminStatsDataVersion++;
}
async function fetchAdminStatsData(maxAgeMs) {
    if (maxAgeMs > 0) {
        const c = adminStatsDataCache;
        if (c && c.version === adminStatsDataVersion && (Date.now() - c.at) < maxAgeMs) {
            return c.data;
        }
        // Ya hay una descarga en camino y nada cambió desde que empezó: esperarla
        // en vez de pedir lo mismo otra vez.
        const f = adminStatsDataInFlight;
        if (f && f.version === adminStatsDataVersion) {
            return f.promise;
        }
    }
    const versionAtStart = adminStatsDataVersion;
    const promise = window.SupabaseManager.fetchStatsData();
    const entry = { promise, version: versionAtStart };
    adminStatsDataInFlight = entry;
    try {
        const data = await promise;
        if (data && Array.isArray(data.sales)) {
            adminStatsDataCache = { data, at: Date.now(), version: versionAtStart };
        }
        return data;
    } finally {
        if (adminStatsDataInFlight === entry) adminStatsDataInFlight = null;
    }
}

async function loadAndRenderAdminStats(opts = {}) {
    if (currentRole !== 'admin') return;
    const statsMaxAgeMs = opts.statsMaxAgeMs || 0;

    // Se dispara ya mismo, en paralelo con todo lo demás: fetchActivityLogs()
    // ya trae su propio fallback a localStorage si no hay Supabase configurado
    // o si la red falla, así que no depende de la rama online de abajo y no
    // vale la pena bloquear el resto del render esperándolo.
    const recentActivityPromise = window.SupabaseManager.fetchActivityLogs();

    let statsSales = salesLog;
    let statsExpenses = expenses;
    // Arranca en false y solo sube si el fetch responde: offline, `statsSales`
    // sigue siendo el turno local y los deltas quedan ocultos en vez de mentir.
    let gotFullHistory = false;
    // Gastos de la semana tal como llegaron de Supabase. Se guarda aparte de
    // `statsExpenses` porque abajo ese puede quedarse con el dato local si la
    // semana no tuvo gastos, y para el delta necesitamos saber la diferencia
    // entre "no hubo gastos" y "no tengo el historial".
    let weekExpenses = null;

    if (window.SupabaseManager.isConfigured() && navigator.onLine) {
        try {
            const data = await fetchAdminStatsData(statsMaxAgeMs);
            if (data && Array.isArray(data.sales)) {
                // Merge Supabase stats data with local salesLog to ensure 100% of sales are captured
                const supUuids = new Set(data.sales.map(s => s.uuid));
                const localUnsynced = salesLog.filter(s => s.uuid && !supUuids.has(s.uuid));
                statsSales = [...data.sales, ...localUnsynced];
                gotFullHistory = true;
                if (Array.isArray(data.expenses)) {
                    const supExpUuids = new Set(data.expenses.map(e => e.uuid));
                    const localExpUnsynced = expenses.filter(e => e.uuid && !supExpUuids.has(e.uuid));
                    weekExpenses = [...data.expenses, ...localExpUnsynced];
                }
                if (data.expenses && data.expenses.length > 0) {
                    statsExpenses = weekExpenses;
                }
            }
        } catch(e) {
            console.error("Failed to load historical stats from Supabase", e);
        }
    }

    // Cache statsSales globally for toggle rendering
    adminStatsSales = statsSales;
    adminStatsExpenses = weekExpenses || statsExpenses;
    adminStatsFullHistory = gotFullHistory;
    loadAndRenderUsersManagement();
    window.UIManager.renderStats(statsSales, statsExpenses, products, {
        fullHistory: gotFullHistory,
        deltaExpenses: adminStatsExpenses
    });
    window.UIManager.renderHourlyStats(adminStatsSales, hourlyActiveMode);
    window.UIManager.renderCriticalStockAlerts(products, handleQuickReplenishment);
    loadAndRenderSalePriceAlerts();
    window.UIManager.renderPaymentAndCategoryStats(statsSales, products, paymentStatsFilter, categoryStatsFilter);

    try {
        window.UIManager.renderRecentActivity(await recentActivityPromise);
    } catch (e) {
        console.error("Failed to load recent activity for Resumen", e);
    }
}

/**
 * Aviso "Precios a revisar" del Resumen (migración 050). No bloquea el resto
 * del panel: si falla o no hay conexión, simplemente no se muestra.
 */
async function loadAndRenderSalePriceAlerts() {
    if (currentRole !== 'admin' || !window.SupabaseManager || !window.SupabaseManager.fetchSalePriceAlerts) return;
    const alerts = await window.SupabaseManager.fetchSalePriceAlerts();
    window.UIManager.renderSalePriceAlerts(alerts, async (saleUuid) => {
        const ok = await window.SupabaseManager.markSalePriceAlertReviewed(saleUuid, currentUser ? currentUser.name : null);
        if (ok) logActivity('Precio revisado', `Venta ${saleUuid} marcada como revisada en "Precios a revisar"`);
        return ok;
    });
}

/**
 * Load (or reuse the cached) sales history for the "Análisis" tab and
 * render it. Fetches lazily -- only when the tab is first opened, the
 * range toggle changes to an uncached value, or the user hits Refrescar --
 * to avoid pulling months of sales on every dashboard load.
 * @param {boolean} forceRefetch Bypass the cache for the current range
 */
async function loadAndRenderAnalytics(forceRefetch = false) {
    if (currentRole !== 'admin') return;

    const container = document.getElementById('admin-analytics-container');
    const hasCached = Array.isArray(analyticsSalesCache[analyticsRangeDays]);

    if (forceRefetch) delete analyticsSalesCache[analyticsRangeDays];

    if (!hasCached || forceRefetch) {
        if (container) {
            container.innerHTML = `<div style="font-size: 0.85rem; color: var(--color-text-muted); text-align: center; padding: 1.5rem 0;">Cargando historial de ventas...</div>`;
        }
        if (window.SupabaseManager.isConfigured() && navigator.onLine) {
            try {
                analyticsSalesCache[analyticsRangeDays] = await window.SupabaseManager.fetchSalesHistory(analyticsRangeDays);
            } catch (e) {
                console.error("Failed to load sales history for analytics", e);
                analyticsSalesCache[analyticsRangeDays] = [];
            }
        } else {
            // Offline / not configured: fall back to whatever is already in
            // memory (the current operational window, not the requested
            // range) -- the toast is what keeps a shorter/emptier-than-
            // expected chart from reading as "poco se vendió" instead of
            // "no se pudo traer el historial completo".
            requireOnline('El historial completo de Análisis');
            analyticsSalesCache[analyticsRangeDays] = salesLog;
        }
    }

    const salesHistory = analyticsSalesCache[analyticsRangeDays] || [];
    const targetWeekday = getAnalyticsPrepWeekday();
    const targetLabel = analyticsPrepMode === 'tomorrow' ? 'Mañana' : 'Hoy';
    window.UIManager.renderSalesAnalytics(salesHistory, products, targetWeekday, targetLabel);
}

async function loadAndRenderUsersManagement() {
    systemUsers = window.StorageManager ? window.StorageManager.loadUsers() : [];
    
    let supabaseProfiles = null;
    let profilesFetchFailed = false;
    if (window.SupabaseManager && window.SupabaseManager.isConfigured() && navigator.onLine) {
        try {
            supabaseProfiles = await window.SupabaseManager.fetchProfiles();
            if (supabaseProfiles === null) {
                profilesFetchFailed = true;
            } else {
                // profiles is the real source of truth now (see signUpNewUser /
                // setProfileActive) -- keep a local cache so the panel still
                // shows something sensible while offline, instead of whatever
                // was left over from the old localStorage-only user flow.
                systemUsers = supabaseProfiles;
                if (window.StorageManager) window.StorageManager.saveUsers(systemUsers);
            }
        } catch (e) {
            console.error("Failed to fetch Supabase profiles:", e);
            profilesFetchFailed = true;
        }
    }

    window.UIManager.renderUsersManagement(
        systemUsers,
        (userToEdit) => openUserModal(userToEdit),
        (userIdToDeactivate) => deactivateUserHandler(userIdToDeactivate)
    );

    const userSelect = document.getElementById('select-admin-target-user');
    if (userSelect) {
        const displayUsers = (supabaseProfiles && supabaseProfiles.length > 0) ? supabaseProfiles : systemUsers;
        if (displayUsers && displayUsers.length > 0) {
            userSelect.innerHTML = displayUsers.map(u => {
                // Label the role the user actually has, not one guessed from
                // their username -- mislabelling here is how an admin picks
                // the wrong account when assigning a PIN.
                const roleKey = (u.role || '').toLowerCase();
                const roleLabel = roleKey === 'admin' ? 'Admin' : (roleKey === 'cocina' ? 'Cocina' : 'Ventas');
                const displayName = u.name || u.username;
                return `<option value="${u.id}">${displayName} (${roleLabel})</option>`;
            }).join('');
        } else if (profilesFetchFailed) {
            // Distinguish "the fetch failed" from "there are genuinely zero
            // users" -- this used to silently show "No hay usuarios" (or get
            // stuck on the HTML's "Cargando usuarios..." placeholder) with no
            // indication that the real problem was a dead/expired session,
            // not an empty staff list. Re-entering via quick PIN instead of a
            // full login is the most common way the Supabase Auth session
            // goes stale mid-shift.
            userSelect.innerHTML = `<option value="">⚠️ No se pudo cargar -- volvé a iniciar sesión completa</option>`;
        } else {
            userSelect.innerHTML = `<option value="">No hay usuarios</option>`;
        }
    }
}

function openUserModal(user = null) {
    const modal = document.getElementById('user-modal');
    if (!modal) return;

    const usernameInput = document.getElementById('user-modal-username');
    const usernameNote = document.getElementById('user-modal-username-note');
    const passwordField = document.getElementById('user-modal-password-field');
    const passwordNote = document.getElementById('user-modal-password-note');
    const passwordInput = document.getElementById('user-modal-password');

    document.getElementById('user-modal-title').textContent = user ? '✏️ Editar Usuario' : '➕ Nuevo Usuario';
    document.getElementById('user-modal-id').value = user ? user.id : '';
    document.getElementById('user-modal-name').value = user ? (user.name || '') : '';
    document.getElementById('user-modal-username').value = user ? (user.username || '') : '';
    document.getElementById('user-modal-role').value = user ? user.role : 'venta';

    passwordInput.value = '';
    // A real password can't be shown back (it's never stored anywhere this
    // app can read it) and can't be changed for an existing account without
    // a service-role Admin API call, which a browser-only client doesn't
    // have. Editing is name/role only; creating still needs a password.
    const isEditing = !!user;
    usernameInput.readOnly = isEditing;
    usernameNote.classList.toggle('hidden', !isEditing);
    passwordField.classList.toggle('hidden', isEditing);
    passwordInput.required = !isEditing;
    passwordNote.classList.toggle('hidden', !isEditing);

    modal.classList.remove('hidden');
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.classList.add('hidden');
}

async function deactivateUserHandler(id) {
    if (!confirm("¿Desactivar este usuario? No va a poder iniciar sesión hasta que lo reactives.")) return;
    if (!window.SupabaseManager.isConfigured()) {
        window.UIManager.showToast("⚠️ Conexión con Supabase no disponible.", "fa-solid fa-wifi");
        return;
    }
    const ok = await window.SupabaseManager.setProfileActive(id, false);
    if (ok) {
        window.UIManager.showToast("🚫 Usuario desactivado.", "fa-solid fa-user-slash");
        logActivity("Usuario Desactivado", `Usuario ${id} desactivado por admin`);
    } else {
        window.UIManager.showToast("❌ No se pudo desactivar el usuario.", "fa-solid fa-circle-xmark");
    }
    loadAndRenderUsersManagement();
}

/**
 * Triggers rendering for all active templates
 */
function renderAllViews(opts = {}) {
    window.UIManager.renderSearchBar(handleSearchChange);
    window.UIManager.renderCategoryFilterBar(activeCategory, handleCategoryChange, products);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale, handleEditSale);
    window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
    window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);

    window.UIManager.renderExpenses(expenses, deleteExpense);
    window.UIManager.renderDebts(debts, settleDebtPayment);
    window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);

    if (currentRole === 'admin' || currentRole === 'local') {
        window.UIManager.renderPedidosOnline(pedidosOnline, handleConfirmPedido, handleRechazarPedido);
        window.UIManager.updatePedidosBadge(pedidosOnline);
    }

    if (currentRole === 'admin') {
        loadAndRenderAdminStats({ statsMaxAgeMs: opts.statsMaxAgeMs || 0 });
        updateAdminDashboard();
    }
    if (window.InventoryManager && window.InventoryManager.updateLowStockUI) {
        window.InventoryManager.updateLowStockUI(products, ingredients, currentRole);
    }
}

/**
 * Handle real-time PostgreSQL updates, syncing memory state and re-rendering grids
 * @param {string} tableName Updated table key
 */
// Realtime sends ONE event per sale row, and an account is one row per item,
// so a 10-item account arrived as 10 events -- each one used to repaint
// Caja, Historial, Cuentas Activas (and the admin charts) from scratch,
// keeping the till busy and making the new account show up late. The data
// is still patched per event; only the repaint is coalesced into one, a
// moment after the burst settles.
let realtimeSalesRenderTimer = null;
function scheduleRealtimeSalesRender() {
    if (realtimeSalesRenderTimer) clearTimeout(realtimeSalesRenderTimer);
    realtimeSalesRenderTimer = setTimeout(() => {
        realtimeSalesRenderTimer = null;
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
        window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
        if (currentRole === 'admin') {
            // `expenses` (turno actual) se mantiene como tercer argumento para
            // no alterar los totales que ya pintaba; el delta usa el cache de
            // la semana vía `deltaExpenses`.
            window.UIManager.renderStats(adminStatsSales, expenses, products, {
                fullHistory: adminStatsFullHistory,
                deltaExpenses: adminStatsExpenses
            });
            window.UIManager.renderHourlyStats(adminStatsSales, hourlyActiveMode);
            window.UIManager.renderPaymentAndCategoryStats(adminStatsSales, products, paymentStatsFilter, categoryStatsFilter);
        }
    }, 120);
}

async function handleRealtimeDbUpdate(tableName, payload) {
    console.log(`Realtime postgres update detected for table: ${tableName}`, payload);
    markSyncFresh();
    if (!payload || tableName === 'sales' || tableName === 'expenses' || tableName === 'app_config' || tableName === 'all') {
        invalidateAdminStatsCache();
    }

    // Fallback: If no payload is supplied, perform standard full fetch
    if (!payload || !payload.eventType) {
        performFullFetch(tableName);
        return;
    }

    const { eventType, new: newRow, old: oldRow } = payload;

    if (tableName === 'products') {
        if (eventType === 'DELETE') {
            products = products.filter(p => p.id !== oldRow.id);
        } else {
            const idx = products.findIndex(p => p.id === newRow.id);
            const formatted = {
                id: newRow.id,
                name: newRow.name,
                stock: parseInt(newRow.stock),
                min: parseInt(newRow.min),
                max: parseInt(newRow.max),
                unit: newRow.unit,
                price: parseFloat(newRow.price) || 0,
                cost: parseFloat(newRow.cost) || 0,
                cost_usd: newRow.cost_usd != null ? (parseFloat(newRow.cost_usd) || null) : null,
                category: newRow.category || 'pastelitos',
                initial_stock: (newRow.initial_stock !== null && newRow.initial_stock !== undefined) ? parseInt(newRow.initial_stock) : parseInt(newRow.stock)
            };
            if (idx !== -1) {
                products[idx] = formatted;
            } else {
                products.push(formatted);
            }
        }
        window.StorageManager.saveProducts(products);
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
        window.UIManager.updateKitchenBadge(products);
        window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
        if (currentRole === 'admin') {
            window.UIManager.renderCriticalStockAlerts(products, handleQuickReplenishment);
        }
    } else if (tableName === 'sales') {
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);
        const filterTime = lastCloseTime ? window.parseUTCTimestamp(lastCloseTime) : startOfDay;

        if (eventType === 'DELETE' || (newRow && newRow.voided_at)) {
            // Plan B, Task 7: a voided sale (spec §5.2) must vanish from the
            // register/reports exactly like the DELETE this used to only
            // handle -- without this check the row stayed patched into
            // salesLog with voided_at set but nothing here ever looks at
            // that field, so it would keep counting toward totals forever.
            const uuidToRemove = eventType === 'DELETE' ? oldRow.uuid : newRow.uuid;
            salesLog = salesLog.filter(s => s.uuid !== uuidToRemove);
        } else {
            const saleDate = window.parseUTCTimestamp(newRow.timestamp);
            if (saleDate >= filterTime) {
                const idx = salesLog.findIndex(s => s.uuid === newRow.uuid);
                const formatted = {
                    uuid: newRow.uuid,
                    productId: newRow.product_id,
                    name: newRow.name,
                    price: parseFloat(newRow.price) || 0,
                    cost_at_sale: (newRow.cost_at_sale !== null && newRow.cost_at_sale !== undefined) ? parseFloat(newRow.cost_at_sale) : null,
                    bcv_rate: (newRow.bcv_rate !== null && newRow.bcv_rate !== undefined) ? parseFloat(newRow.bcv_rate) : null,
                    timestamp: newRow.timestamp
                };
                if (idx !== -1) {
                    salesLog[idx] = formatted;
                } else {
                    salesLog.push(formatted);
                }
            }
        }
        window.StorageManager.saveSalesLog(salesLog);
        pnlCache = {}; // an incoming sale changes P&L numbers — force a refetch on next tab open / refresh
        scheduleRealtimeSalesRender();
        if (currentRole === 'admin') {
            if (eventType === 'INSERT' || eventType === 'UPDATE') {
                const statFormatted = {
                    uuid: newRow.uuid,
                    productId: newRow.product_id,
                    name: newRow.name,
                    price: parseFloat(newRow.price) || 0,
                    timestamp: newRow.timestamp
                };
                const idx = adminStatsSales.findIndex(s => (s.uuid && s.uuid === statFormatted.uuid) || (s.timestamp === statFormatted.timestamp && s.productId === statFormatted.productId));
                if (idx !== -1) {
                    adminStatsSales[idx] = statFormatted;
                } else {
                    adminStatsSales.push(statFormatted);
                }
            } else if (eventType === 'DELETE') {
                adminStatsSales = adminStatsSales.filter(s => s.uuid !== oldRow.uuid && s.timestamp !== oldRow.timestamp);
            }
            // (admin charts repaint inside scheduleRealtimeSalesRender)
        }
    } else if (tableName === 'expenses') {
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);
        const filterTime = lastCloseTime ? window.parseUTCTimestamp(lastCloseTime) : startOfDay;

        // Any categorized expense (arriendo/sueldos/servicios/otros/…) is logged
        // from the Ganancias/Gastos admin tab and belongs only to the P&L —
        // it must never enter the shift ledger on any device (the cash register /
        // day-close is currency-blind and would mis-count a Bs row as USD).
        // Only the counter quick-expense, which carries NO category, flows through.
        const inboundCat = (newRow && newRow.category ? String(newRow.category).toLowerCase() : '');
        if (eventType !== 'DELETE' && inboundCat !== '') {
            return;
        }

        if (eventType === 'DELETE') {
            expenses = expenses.filter(e => e.uuid !== oldRow.uuid);
        } else {
            const expDate = window.parseUTCTimestamp(newRow.timestamp);
            if (expDate > filterTime) {
                const idx = expenses.findIndex(e => e.uuid === newRow.uuid);
                const formatted = {
                    uuid: newRow.uuid,
                    description: newRow.description,
                    amount: parseFloat(newRow.amount) || 0,
                    timestamp: newRow.timestamp
                };
                if (idx !== -1) {
                    expenses[idx] = formatted;
                } else {
                    expenses.push(formatted);
                }
            }
        }
        window.StorageManager.saveExpenses(expenses);
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderExpenses(expenses, deleteExpense);
        if (currentRole === 'admin') {
            // Mismo patrón que la rama `sales` de este handler: sin `opts`, un
            // evento de gasto en tiempo real ocultaba los chips de delta (recién
            // agregados) y volvía a los totales locales del turno en vez del
            // cache semanal, haciendo que las cifras "parpadearan" según qué
            // tabla disparó el último evento.
            window.UIManager.renderStats(adminStatsSales, expenses, products, {
                fullHistory: adminStatsFullHistory,
                deltaExpenses: adminStatsExpenses
            });
        }
    } else if (tableName === 'debts') {
        if (eventType === 'DELETE') {
            debts = debts.filter(d => d.uuid !== oldRow.uuid);
        } else {
            const idx = debts.findIndex(d => d.uuid === newRow.uuid);
            const formatted = {
                uuid: newRow.uuid,
                clientName: newRow.client_name,
                amount: parseFloat(newRow.amount) || 0,
                description: newRow.description,
                timestamp: newRow.timestamp
            };
            if (idx !== -1) {
                debts[idx] = formatted;
            } else {
                debts.push(formatted);
            }
        }
        window.StorageManager.saveDebts(debts);
        window.UIManager.renderDebts(debts, settleDebtPayment);
    } else if (tableName === 'replenishments') {
        if (eventType === 'DELETE') {
            replenishments = replenishments.filter(r => r.uuid !== oldRow.uuid);
        } else if (!window.StorageManager.loadConsumedReplenishmentUuids().includes(newRow.uuid)) {
            const idx = replenishments.findIndex(r => r.uuid === newRow.uuid);
            const formatted = {
                uuid: newRow.uuid,
                productId: newRow.product_id,
                name: newRow.name,
                amount: parseInt(newRow.amount),
                unit: newRow.unit,
                status: newRow.status,
                timestamp: newRow.timestamp
            };
            if (idx !== -1) {
                replenishments[idx] = formatted;
            } else {
                replenishments.push(formatted);
            }
        }
        window.StorageManager.saveReplenishments(replenishments);
        window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
        window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
    } else if (tableName === 'ingredients') {
        if (eventType === 'DELETE') {
            ingredients = ingredients.filter(i => i.id !== oldRow.id);
        } else {
            const idx = ingredients.findIndex(i => i.id === newRow.id);
            const formatted = {
                id: newRow.id,
                name: newRow.name,
                stock: parseFloat(newRow.stock) || 0,
                unit: newRow.unit
            };
            if (idx !== -1) {
                ingredients[idx] = formatted;
            } else {
                ingredients.push(formatted);
            }
        }
        window.StorageManager.saveIngredients(ingredients);
        window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    } else if (tableName === 'app_config') {
        if (newRow) {
            // Check if last_close_time changed
            if (newRow.last_close_time && newRow.last_close_time !== lastCloseTime) {
                console.log("Detecting Day Close event from another device. Clearing local sales and reloading data across all devices...");
                lastCloseTime = newRow.last_close_time;
                window.StorageManager.saveLastCloseTime(lastCloseTime);
                
                salesLog = [];
                expenses = [];
                window.StorageManager.clearSalesLog();
                window.StorageManager.clearExpenses();

                await loadAllDataFromSupabase();
                renderAllViews();

                window.UIManager.showToast("🔔 Cierre de caja realizado por Administrador. Caja en $0.00.", "fa-solid fa-bell");
                return;
            }

            const incomingBcvRate = parseFloat(newRow.bcv_rate) || 732.48;
            const bcvRateChanged = incomingBcvRate !== bcvRate;
            bcvRate = incomingBcvRate;
            useAutoBcv = newRow.use_auto_bcv !== false;
            window.bcvRate = bcvRate;
            if (bcvRateChanged) {
                bcvLastFetchTime = new Date().toISOString();
                window.StorageManager.saveBcvLastFetch(bcvLastFetchTime);
            }
            window.StorageManager.saveBcvPreferences(bcvRate, useAutoBcv);

            // Sync DOM components
            const autoCheckbox = document.getElementById('pref-bcv-auto');
            const bcvRateInput = document.getElementById('pref-bcv-rate');
            if (autoCheckbox) autoCheckbox.checked = useAutoBcv;
            if (bcvRateInput) {
                bcvRateInput.value = bcvRate;
                bcvRateInput.disabled = useAutoBcv;
            }
            updateBcvHeaderDisplay();

            // Re-render all views
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.renderCashRegister(salesLog, expenses);
            window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
            window.UIManager.renderDebts(debts, settleDebtPayment);
            window.UIManager.renderQuickConversionTable();
        }
    } else if (tableName === 'active_sessions') {
        const targetId = eventType === 'DELETE' ? (oldRow ? oldRow.device_id : null) : (newRow ? newRow.device_id : null);
        
        if (targetId === myDeviceId) {
            if (eventType === 'DELETE' || (newRow && newRow.is_blocked)) {
                console.warn("My session was deleted or blocked by administrator. Logging out...");
                window.UIManager.showToast("🚫 Tu sesión ha sido cerrada por el administrador.", "fa-solid fa-lock");
                lockSession();
            }
        }
        
        // Re-render the active devices list if currently open
        const listDiv = document.getElementById('settings-devices-list');
        if (listDiv && !document.getElementById('view-admin-dashboard').classList.contains('hidden')) {
            loadAndRenderActiveDevices();
        }
    } else if (tableName === 'pedidos_online') {
        if (eventType === 'DELETE') {
            pedidosOnline = pedidosOnline.filter(p => p.id !== oldRow.id);
        } else {
            const idx = pedidosOnline.findIndex(p => p.id === newRow.id);
            if (idx !== -1) {
                pedidosOnline[idx] = newRow;
            } else {
                pedidosOnline.unshift(newRow);
                if ((currentRole === 'admin' || currentRole === 'local') && newRow.status === 'pendiente') {
                    window.UIManager.showToast(`🛍️ Nuevo pedido online de ${newRow.customer_name} ($${Number(newRow.total).toFixed(2)})`, "fa-solid fa-bag-shopping");
                }
            }
        }
        if (currentRole === 'admin' || currentRole === 'local') {
            window.UIManager.renderPedidosOnline(pedidosOnline, handleConfirmPedido, handleRechazarPedido);
            window.UIManager.updatePedidosBadge(pedidosOnline);
        }
    }
}

/**
 * Fallback full-fetch logic if real-time payloads fail or sync starts
 */
async function performFullFetch(tableName) {
    // subscribeToChanges() calls onDbChange('all', null) after it re-establishes
    // a dropped realtime channel, to resync whatever was missed while the socket
    // was down. There was no 'all' branch, so that resync silently did nothing
    // and the device stayed stale until the next 45s poll. Route it through the
    // same loader the startup path uses -- it already merges safely against the
    // offline queues rather than clobbering local state.
    if (tableName === 'all') {
        await loadAllDataFromSupabase();
        return;
    }

    if (tableName === 'products') {
        const data = await window.SupabaseManager.fetchProducts();
        if (data) {
            products = data;
            window.StorageManager.saveProducts(products);
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
            window.UIManager.updateKitchenBadge(products);
        }
    } else if (tableName === 'sales') {
        const data = await window.SupabaseManager.fetchSales();
        if (data) {
            salesLog = data;
            window.StorageManager.saveSalesLog(salesLog);
            window.UIManager.renderCashRegister(salesLog, expenses);
            window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
            if (currentRole === 'admin') {
                window.UIManager.renderStats(salesLog, expenses);
            }
        }
    } else if (tableName === 'expenses') {
        const data = await window.SupabaseManager.fetchExpenses();
        if (data) {
            expenses = data;
            window.StorageManager.saveExpenses(expenses);
            window.UIManager.renderCashRegister(salesLog, expenses);
            window.UIManager.renderExpenses(expenses, deleteExpense);
            if (currentRole === 'admin') {
                window.UIManager.renderStats(salesLog, expenses);
            }
        }
    } else if (tableName === 'debts') {
        const data = await window.SupabaseManager.fetchDebts();
        if (data) {
            debts = data;
            window.StorageManager.saveDebts(debts);
            window.UIManager.renderDebts(debts, settleDebtPayment);
        }
    } else if (tableName === 'replenishments') {
        const data = await window.SupabaseManager.fetchReplenishments();
        if (data) {
            const consumed = new Set(window.StorageManager.loadConsumedReplenishmentUuids());
            replenishments = data.filter(r => !consumed.has(r.uuid));
            window.StorageManager.saveReplenishments(replenishments);
            window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
            window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
        }
    } else if (tableName === 'ingredients') {
        const data = await window.SupabaseManager.fetchIngredients();
        if (data) {
            ingredients = data;
            window.StorageManager.saveIngredients(ingredients);
            window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
        }
    } else if (tableName === 'app_config') {
        const data = await window.SupabaseManager.fetchAppConfig();
        if (data) {
            const incomingBcvRate = parseFloat(data.bcv_rate) || 732.48;
            const bcvRateChanged = incomingBcvRate !== bcvRate;
            bcvRate = incomingBcvRate;
            useAutoBcv = data.use_auto_bcv !== false;
            window.bcvRate = bcvRate;
            if (bcvRateChanged) {
                bcvLastFetchTime = new Date().toISOString();
                window.StorageManager.saveBcvLastFetch(bcvLastFetchTime);
            }
            window.StorageManager.saveBcvPreferences(bcvRate, useAutoBcv);

            // Sync custom security PINs
            if (data.pin_local) {
                pinLocal = data.pin_local;
                localStorage.setItem('casa_lucenzo_pin_local', pinLocal);
                const pinLocalInput = document.getElementById('pref-pin-local');
                if (pinLocalInput) pinLocalInput.value = pinLocal;
            }
            if (data.pin_cocina) {
                pinCocina = data.pin_cocina;
                localStorage.setItem('casa_lucenzo_pin_cocina', pinCocina);
                const pinCocinaInput = document.getElementById('pref-pin-cocina');
                if (pinCocinaInput) pinCocinaInput.value = pinCocina;
            }
            if (data.pin_admin) {
                pinAdmin = data.pin_admin;
                localStorage.setItem('casa_lucenzo_pin_admin', pinAdmin);
                const pinAdminInput = document.getElementById('pref-pin-admin');
                if (pinAdminInput) pinAdminInput.value = pinAdmin;
            }

            // Sync DOM components
            const autoCheckbox = document.getElementById('pref-bcv-auto');
            const bcvRateInput = document.getElementById('pref-bcv-rate');
            if (autoCheckbox) autoCheckbox.checked = useAutoBcv;
            if (bcvRateInput) {
                bcvRateInput.value = bcvRate;
                bcvRateInput.disabled = useAutoBcv;
            }
            updateBcvHeaderDisplay();

            // Re-render
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.renderCashRegister(salesLog, expenses);
            window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
            window.UIManager.renderDebts(debts, settleDebtPayment);
            window.UIManager.renderQuickConversionTable();
        }
    }
}

/**
 * Helper to log role activity both to Supabase and locally
 * @param {string} action Action description
 * @param {string} details Extra info details
 */
function logActivity(action, details) {
    const role = currentRole || 'local';
    const actorName = currentUser ? currentUser.name : null;
    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.insertActivityLog(role, action, details, actorName);
    } else {
        // Just save locally
        try {
            const localLogs = JSON.parse(localStorage.getItem('casa_lucenzo_local_activity_logs') || '[]');
            localLogs.push({
                role: role,
                action: action,
                details: details || '',
                actor_name: actorName,
                timestamp: new Date().toISOString()
            });
            if (localLogs.length > 100) localLogs.shift();
            localStorage.setItem('casa_lucenzo_local_activity_logs', JSON.stringify(localLogs));
        } catch(e) {
            console.error("Local log failed", e);
        }
    }
}
