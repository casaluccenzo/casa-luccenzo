// Sesión: inicio de sesión, PIN, bloqueo por intentos, roles y dispositivos.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// ================= USER ROLES ACCESS =================

let failedPinAttempts = 0;
let lockoutUntil = 0;
let lockoutCountdownInterval = null;
let adminInactivityTimer = null;
const ADMIN_INACTIVITY_MS = 3 * 60 * 1000; // 3 minutes for Admin auto-lock

/**
 * Resets or clears the inactivity auto-lock timer for Admin role
 */
function resetInactivityTimer() {
    if (adminInactivityTimer) clearTimeout(adminInactivityTimer);
    
    if (currentRole === 'admin') {
        adminInactivityTimer = setTimeout(() => {
            if (currentRole === 'admin') {
                window.UIManager.showToast("🔒 Sesión de Administrador cerrada por inactividad (3 min).", "fa-solid fa-lock");
                logActivity("Cierre Inactividad", "Sesión de Administrador cerrada tras 3 minutos sin interacción");
                lockSession();
            }
        }, ADMIN_INACTIVITY_MS);
    }
}

// Bind global activity listeners once
['touchstart', 'mousedown', 'mousemove', 'keydown', 'scroll', 'click'].forEach(evt => {
    window.addEventListener(evt, resetInactivityTimer, { passive: true });
});

/**
 * Updates the UI lockout banner during penalty block.
 * @param {string} [userId] Plan B, Task 10: when given, reads the per-user
 *   persisted PIN lockout (js/storage.js) instead of the global
 *   lockoutUntil handleUserLogin() uses -- a full password login is
 *   inherently online-only, so that one keeps its own separate counter,
 *   untouched by this task.
 */
function updateLockoutUI(userId) {
    const banner = document.getElementById('pin-lockout-banner');
    if (!banner) return;

    const now = Date.now();
    const until = userId ? (window.StorageManager.loadPinLockoutState(userId).lockedUntil || 0) : lockoutUntil;
    if (now < until) {
        const remainingSec = Math.ceil((until - now) / 1000);
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Acceso bloqueado por ${remainingSec}s por múltiples intentos fallidos.`;
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
        banner.innerHTML = '';
        if (lockoutCountdownInterval) {
            clearInterval(lockoutCountdownInterval);
            lockoutCountdownInterval = null;
        }
    }
}

let systemUsers = window.StorageManager ? window.StorageManager.loadUsers() : [];
let currentUser = null;

/**
 * Validates User & Password input credentials and applies corresponding role UI layout
 * @param {string} username Username or legacy PIN
 * @param {string} password Password string
 * @returns {boolean} True if login successful
 */
async function handleUserLogin(username, password) {
    const now = Date.now();
    if (now < lockoutUntil) {
        const remainingSec = Math.ceil((lockoutUntil - now) / 1000);
        triggerHaptic([80, 80]);
        window.UIManager.showToast(`⛔ Sistema bloqueado por seguridad. Espera ${remainingSec}s.`, "fa-solid fa-ban");
        updateLockoutUI();
        return false;
    }

    const rawUser = (username || '').trim();
    const rawPass = (password || '').trim();
    const cleanUser = rawUser.toLowerCase();
    const cleanPass = rawPass;

    let matchedUser = null;

    // Authentication strictly via Supabase Auth
    if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        try {
            const { user, profile, error } = await window.SupabaseManager.signInUser(cleanUser, cleanPass);
            if (error) console.warn("Supabase Auth rejected the sign-in:", error.message || error);
            if (user && profile) {
                matchedUser = profile;
            }
        } catch (e) {
            console.warn("Supabase Auth sign-in failed:", e);
        }
    }

    if (matchedUser && matchedUser.active !== false) {
        failedPinAttempts = 0;
        currentUser = matchedUser;
        sessionStorage.setItem('casa_lucenzo_active_user', JSON.stringify(currentUser));
        localStorage.setItem('casa_lucenzo_active_user', JSON.stringify(currentUser));
        
        const mappedRole = matchedUser.role === 'admin' ? 'admin' : (matchedUser.role === 'cocina' ? 'cocina' : 'local');
        applyUserRole(mappedRole);

        window.UIManager.showToast(`🔓 ¡Bienvenido/a, ${matchedUser.name}!`, "fa-solid fa-user-check");
        logActivity("Inicio de Sesión", `Ingreso de ${matchedUser.name} (${matchedUser.username}) al perfil ${mappedRole.toUpperCase()}`);
        return true;
    } else {
        failedPinAttempts++;
        triggerHaptic([80, 80]);

        if (failedPinAttempts >= 3) {
            lockoutUntil = Date.now() + 60000;
            failedPinAttempts = 0;
            window.UIManager.showToast("⛔ 3 intentos fallidos. Sistema bloqueado por 60 segundos.", "fa-solid fa-triangle-exclamation");
            logActivity("Seguridad Alerta", `Intento fallido de inicio de sesión para usuario "${cleanUser}"`);
            
            updateLockoutUI();
            if (lockoutCountdownInterval) clearInterval(lockoutCountdownInterval);
            lockoutCountdownInterval = setInterval(updateLockoutUI, 1000);
        } else {
            const remaining = 3 - failedPinAttempts;
            window.UIManager.showToast(`❌ Usuario o contraseña incorrectos (${remaining} intento${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}).`, "fa-solid fa-circle-xmark");
        }
        return false;
    }
}
window.handleUserLogin = handleUserLogin;

/**
 * Handles Quick PIN unlock. Plan B, Task 10 (spec §6 punto 2): verification
 * itself now runs local-first (bcrypt against the synced profiles.pin_hash,
 * js/supabase.js:verifyQuickPin), no network required once this device has
 * synced at least once. The 3-fails/60s lockout is per-user and persisted
 * (js/storage.js:loadPinLockoutState/savePinLockoutState) instead of the
 * in-memory, shared-with-handleUserLogin lockoutUntil/failedPinAttempts --
 * verifyQuickPin already does the counting/locking itself, this function
 * only reads the result back to drive the UI.
 * @param {string} pin 4-digit PIN string
 * @returns {boolean} Success state
 */
async function handleQuickPINInput(pin) {
    let activeUser = currentUser;
    if (!activeUser) {
        try {
            activeUser = JSON.parse(sessionStorage.getItem('casa_lucenzo_active_user') || localStorage.getItem('casa_lucenzo_active_user') || 'null');
        } catch { /* corrupt stored session -- treated as "not logged in" below */ }
    }

    if (!activeUser || !activeUser.id) {
        if (window.UIManager) window.UIManager.showToast("⚠️ Primero debes iniciar sesión con correo y contraseña.", "fa-solid fa-lock");
        return false;
    }

    // Plan B, Task 11 (spec §6, "Bordes"): quick-PIN reactivation is refused
    // past 30 days without proven connectivity -- full password login is
    // the required recovery path, and it inherently needs a connection.
    if (window.AuthManager && window.AuthManager.isOfflineLimitExceeded(window.StorageManager.loadLastAuthOnlineAt())) {
        if (window.UIManager) window.UIManager.showToast("🔒 Este dispositivo lleva más de 30 días sin conectarse. Iniciá sesión con tu contraseña para continuar.", "fa-solid fa-lock");
        return false;
    }

    const lockout = window.StorageManager.loadPinLockoutState(activeUser.id);
    const now = Date.now();
    if (lockout.lockedUntil && now < lockout.lockedUntil) {
        const remainingSec = Math.ceil((lockout.lockedUntil - now) / 1000);
        triggerHaptic([80, 80]);
        if (window.UIManager) window.UIManager.showToast(`⛔ Sistema bloqueado por seguridad. Espera ${remainingSec}s.`, "fa-solid fa-ban");
        updateLockoutUI(activeUser.id);
        return false;
    }

    const pinStr = (pin || '').trim();
    if (!pinStr) return false;

    let isValid = false;
    if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        try {
            isValid = await window.SupabaseManager.verifyQuickPin(activeUser.id, pinStr);
        } catch (e) {
            console.error("PIN verification error:", e);
        }
    }

    if (isValid) {
        currentUser = activeUser;
        // Strictly the stored role -- same mapping handleUserLogin() uses.
        // This used to also grant admin to any username *containing* "admin"
        // (`userKey.includes('admin')`), so an account like "administracion"
        // with role `venta` unlocked straight into the admin interface. RLS
        // still refused its writes, but it had no business seeing the panel.
        const roleKey = (activeUser.role || '').toLowerCase();
        const mappedRole = roleKey === 'admin' ? 'admin' : (roleKey === 'cocina' ? 'cocina' : 'local');

        applyUserRole(mappedRole);
        if (window.UIManager) window.UIManager.showToast(`🔓 Sesión reactivada (${activeUser.name})`, "fa-solid fa-user-check");
        logActivity("Desbloqueo PIN", `Reactivación de sesión de ${activeUser.name} vía PIN rápido`);
        return true;
    } else {
        // verifyQuickPin already incremented/persisted this user's lockout
        // state -- read it back to decide what the UI shows.
        const updated = window.StorageManager.loadPinLockoutState(activeUser.id);
        triggerHaptic([80, 80]);

        if (updated.lockedUntil && updated.lockedUntil > Date.now()) {
            if (window.UIManager) window.UIManager.showToast("⛔ 3 intentos fallidos de PIN. Sistema bloqueado por 60 segundos.", "fa-solid fa-triangle-exclamation");
            logActivity("Seguridad Alerta", `Intento fallido de PIN para usuario "${activeUser.username || activeUser.name}"`);

            updateLockoutUI(activeUser.id);
            if (lockoutCountdownInterval) clearInterval(lockoutCountdownInterval);
            lockoutCountdownInterval = setInterval(() => updateLockoutUI(activeUser.id), 1000);
        } else {
            const remaining = Math.max(0, 3 - (updated.attempts || 0));
            if (window.UIManager) window.UIManager.showToast(`❌ PIN incorrecto (${remaining} intento${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}).`, "fa-solid fa-circle-xmark");
        }
        return false;
    }
}
window.handlePINInput = handleQuickPINInput;

/**
 * Configures the DOM UI visibility states by active role permissions
 * @param {string} role 'local' | 'cocina' | 'admin'
 */
function applyUserRole(role) {
    currentRole = role;
    sessionStorage.setItem('casa_lucenzo_active_role', role);
    resetInactivityTimer();

    const pinOverlay = document.getElementById('pin-overlay');
    if (pinOverlay) pinOverlay.style.display = 'none';

    const navBar = document.getElementById('switch-nav-bar');
    const btnSettings = document.getElementById('btn-settings-toggle');
    const adminTab = document.getElementById('btn-admin-dashboard');
    
    // Default unlocked structures
    if (adminTab) adminTab.classList.add('hidden');
    document.getElementById('btn-local').classList.remove('hidden');
    document.getElementById('btn-clientes').classList.remove('hidden');
    document.getElementById('btn-resumen').classList.remove('hidden');
    document.getElementById('btn-cocina').classList.remove('hidden');
    document.getElementById('btn-fiados').classList.remove('hidden');
    document.getElementById('btn-cambio').classList.remove('hidden');
    document.getElementById('btn-pedidos').classList.remove('hidden');
    navBar.classList.remove('hidden');
    btnSettings.classList.remove('hidden');
    
    // Hide administrative actions inside sections if local
    const undoSales = document.getElementById('sales-history-section');
    const clearSales = document.getElementById('btn-clear-sales');
    const dayCloseSec = document.getElementById('day-close-trigger-section');

    if (undoSales) undoSales.classList.add('hidden');
    if (clearSales) clearSales.classList.remove('hidden');
    if (dayCloseSec) dayCloseSec.classList.remove('hidden');

    // "Ver el día" del Historial de Clientes es solo del admin: ventas solo ve
    // la jornada de hoy. El botón Historial de reportes lo ven todos, pero
    // ventas debe escribir la clave de supervisor (openReportHistoryModal).
    const isAdminRole = role === 'admin';
    const reportHistoryBtn = document.getElementById('btn-report-history');
    if (reportHistoryBtn) reportHistoryBtn.classList.remove('hidden');
    // Repinta los gastos para mostrar u ocultar la "×" de borrar según el perfil.
    if (window.UIManager && window.UIManager.renderExpenses) window.UIManager.renderExpenses(expenses, deleteExpense);
    const histDayBar = document.querySelector('#sub-view-historial .hist-day-bar');
    if (histDayBar) histDayBar.classList.toggle('hidden', !isAdminRole);
    if (!isAdminRole) {
        const reportHistoryModal = document.getElementById('report-history-modal');
        if (reportHistoryModal) reportHistoryModal.classList.add('hidden');
        if (window.UIManager && window.UIManager.resetHistorialToToday) window.UIManager.resetHistorialToToday();
    }

    // Lock BCV Rate input for non-admin roles
    const bcvRateInput = document.getElementById('header-bcv-rate-input');
    if (bcvRateInput) {
        if (role === 'admin') {
            bcvRateInput.removeAttribute('readonly');
            bcvRateInput.style.cursor = 'text';
            bcvRateInput.title = 'Toca para cambiar la tasa manualmente (Modo Administrador)';
        } else {
            bcvRateInput.setAttribute('readonly', 'readonly');
            bcvRateInput.style.cursor = 'not-allowed';
            bcvRateInput.title = 'Tasa BCV del día (Solo modificable por Administrador)';
        }
    }

    if (role === 'local') {
        // Local seller: only Local + Clientes + Fiados + Cambio
        document.getElementById('btn-cocina').classList.add('hidden');
        btnSettings.classList.add('hidden');
        if (clearSales) clearSales.classList.add('hidden');
        
        // Dynamic numbering for local role
        const localSpan = document.querySelector('#btn-local .nav-label');
        const clientesSpan = document.querySelector('#btn-clientes .nav-label');
        const resumenSpanLocal = document.querySelector('#btn-resumen .nav-label');
        const fiadosSpan = document.querySelector('#btn-fiados .nav-label');
        const cambioSpan = document.querySelector('#btn-cambio .nav-label');
        const pedidosSpanLocal = document.querySelector('#btn-pedidos .nav-label');
        if (localSpan) localSpan.textContent = '1. LOCAL';
        if (clientesSpan) clientesSpan.textContent = '2. CLIENTES';
        if (resumenSpanLocal) resumenSpanLocal.textContent = '3. RESUMEN';
        if (fiadosSpan) fiadosSpan.textContent = '4. CRÉDITOS';
        if (cambioSpan) cambioSpan.textContent = '5. CAMBIO';
        if (pedidosSpanLocal) pedidosSpanLocal.textContent = '6. PEDIDOS';

        window.UIManager.switchView('local');
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
        window.UIManager.renderPedidosOnline(pedidosOnline, handleConfirmPedido, handleRechazarPedido);
        window.UIManager.updatePedidosBadge(pedidosOnline);
    } else if (role === 'cocina') {
        // Kitchen parents: ONLY Kitchen view. Navigation bar hidden entirely.
        navBar.classList.add('hidden');
        btnSettings.classList.add('hidden');

        window.UIManager.switchView('cocina');
        window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
        window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    } else if (role === 'admin') {
        // Full Admin: Everything visible, statistics dashboard loaded
        if (undoSales) undoSales.classList.remove('hidden');
        if (adminTab) adminTab.classList.remove('hidden');

        // Dynamic numbering for admin role
        const adminSpan = document.querySelector('#btn-admin-dashboard .nav-label');
        const localSpan = document.querySelector('#btn-local .nav-label');
        const clientesSpan = document.querySelector('#btn-clientes .nav-label');
        const resumenSpanAdmin = document.querySelector('#btn-resumen .nav-label');
        const cocinaSpan = document.querySelector('#btn-cocina .nav-label');
        const fiadosSpan = document.querySelector('#btn-fiados .nav-label');
        const cambioSpan = document.querySelector('#btn-cambio .nav-label');
        const pedidosSpanAdmin = document.querySelector('#btn-pedidos .nav-label');
        if (adminSpan) adminSpan.textContent = '1. CONTROL';
        if (localSpan) localSpan.textContent = '2. VITRINA';
        if (clientesSpan) clientesSpan.textContent = '3. CLIENTES';
        if (resumenSpanAdmin) resumenSpanAdmin.textContent = '4. RESUMEN';
        if (cocinaSpan) cocinaSpan.textContent = '5. COCINA';
        if (fiadosSpan) fiadosSpan.textContent = '6. CRÉDITOS';
        if (cambioSpan) cambioSpan.textContent = '7. CAMBIO';
        if (pedidosSpanAdmin) pedidosSpanAdmin.textContent = '8. PEDIDOS';

        window.UIManager.switchView('admin-dashboard');
        updateAdminDashboard();
        loadAndRenderAdminStats();
        loadAndRenderActiveDevices();
        window.UIManager.renderPedidosOnline(pedidosOnline, handleConfirmPedido, handleRechazarPedido);
        window.UIManager.updatePedidosBadge(pedidosOnline);
    }

    // Refresh Low Stock Alerts for Admin and Kitchen
    if (window.InventoryManager && window.InventoryManager.updateLowStockUI) {
        window.InventoryManager.updateLowStockUI(products, ingredients, currentRole);
    }

    // Refresh active session on Supabase
    refreshMySession();
}

async function updateAdminDashboard() {
    const container = document.getElementById('admin-dashboard-container');
    if (!container) return;

    if (window.AuthManager && !window.AuthManager.checkRolePermission(currentRole, 'view_stats') && currentRole !== 'admin') {
        container.innerHTML = `<div style="color: var(--color-danger); padding: 1rem; text-align: center;">Acceso denegado. Vista solo para administradores.</div>`;
        return;
    }

    // getTodaySalesLog()/getExpenses() never existed anywhere in the codebase, so
    // these guarded ternaries always took the fallback branch.
    const sales = salesLog || [];
    const expensesList = expenses || [];

    let previousWeekTotal = null;
    try {
        const allSales = (typeof StorageManager !== 'undefined' && StorageManager.loadSalesLog) ? StorageManager.loadSalesLog() : [];
        const today = new Date();
        const lastWeek = new Date(today);
        lastWeek.setDate(today.getDate() - 7);
        const lastWeekStr = lastWeek.toISOString().slice(0, 10);

        const lastWeekSales = allSales.filter(s => (s.timestamp || '').startsWith(lastWeekStr));
        if (lastWeekSales.length > 0) {
            previousWeekTotal = lastWeekSales.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
        }
    } catch(e) {
        previousWeekTotal = null;
    }

    if (window.SalesManager && window.SalesManager.renderAdminDashboard) {
        container.innerHTML = window.SalesManager.renderAdminDashboard(sales, expensesList, previousWeekTotal);
    }
}
window.updateAdminDashboard = updateAdminDashboard;

/**
 * Locks the current role and forces PIN re-entry overlay
 */
function lockSession() {
    triggerHaptic(15);
    sessionStorage.removeItem('casa_lucenzo_active_role');
    currentRole = null;

    // Delete session from Supabase when logging out voluntarily
    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.deleteSession(myDeviceId);
    }

    const pinOverlay = document.getElementById('pin-overlay');
    if (pinOverlay) {
        pinOverlay.style.display = 'flex';
        // Clear display text inside keypad
        const display = document.getElementById('pin-display');
        if (display) display.innerText = '• • • •';
    }

    window.UIManager.initPinKeypad(window.handlePINInput);
}

/**
 * Helper to identify the current device user agent/platform
 */
function getDeviceName() {
    const ua = navigator.userAgent;
    let name = "Dispositivo Genérico";
    if (/android/i.test(ua)) name = "Android Phone/Tablet";
    else if (/iphone|ipad|ipod/i.test(ua)) name = "iPhone/iPad";
    else if (/windows/i.test(ua)) name = "PC Windows";
    else if (/macintosh/i.test(ua)) name = "Macbook/Mac";
    else if (/linux/i.test(ua)) name = "Linux System";
    
    if (/chrome|crios/i.test(ua)) name += " (Chrome)";
    else if (/safari/i.test(ua) && !/chrome/i.test(ua)) name += " (Safari)";
    else if (/firefox|fxios/i.test(ua)) name += " (Firefox)";
    else if (/edge/i.test(ua)) name += " (Edge)";
    
    return name;
}

/**
 * Register or refresh current active session on Supabase
 */
async function refreshMySession() {
    // active_sessions RLS only grants access to authenticated users -- an
    // anonymous visitor (no currentRole yet) always gets rejected, so don't
    // even try until someone's actually logged in.
    if (currentRole && window.SupabaseManager.isConfigured() && navigator.onLine) {
        await window.SupabaseManager.registerSession(myDeviceId, getDeviceName(), currentRole);
    }
}

/**
 * Fetch and render all active connected devices in the admin settings modal
 */
async function loadAndRenderActiveDevices() {
    if (currentRole !== 'admin') return;
    // Plan B, Task 14: this used to just do nothing when offline, leaving
    // whatever was rendered last (stale) or a blank panel on first open. A
    // plain empty sessions array would be worse -- renderActiveDevices'
    // own empty-state says "No hay dispositivos registrados en el
    // servidor.", exactly the misleading "nothing exists" reading this task
    // is about. Write the container directly instead of routing through it.
    if (!window.SupabaseManager.isConfigured() || !navigator.onLine) {
        const listDiv = document.getElementById('settings-devices-list');
        if (listDiv) {
            listDiv.innerHTML = `
                <div style="text-align: center; padding: 1rem 0; color: var(--color-text-muted); font-size: 0.75rem;">
                    <i class="fa-solid fa-wifi-slash" style="margin-right: 0.35rem;"></i>
                    Sin conexión — necesitás internet para ver los dispositivos conectados.
                </div>
            `;
        }
        return;
    }
    const sessions = await window.SupabaseManager.fetchActiveSessions();
    window.UIManager.renderActiveDevices(sessions, myDeviceId, handleEjectDevice, handleTrustDevice);
}

/**
 * Kickout a device by deleting its session from Supabase
 */
async function handleEjectDevice(deviceId) {
    if (confirm("¿Estás seguro de que deseas expulsar este dispositivo? Se le cerrará la sesión de inmediato.")) {
        triggerHaptic(15);
        await window.SupabaseManager.deleteSession(deviceId);
        window.UIManager.showToast("🚫 Dispositivo expulsado.", "fa-solid fa-circle-check");
        loadAndRenderActiveDevices();
    }
}

/**
 * Trust or untrust a device session
 */
async function handleTrustDevice(deviceId, isTrusted) {
    triggerHaptic(15);
    await window.SupabaseManager.trustSession(deviceId, isTrusted);
    const msg = isTrusted ? "🛡️ Dispositivo marcado como confiable." : "🛡️ Confianza removida del dispositivo.";
    window.UIManager.showToast(msg, "fa-solid fa-shield-halved");
    loadAndRenderActiveDevices();
}
