// Ajustes, toasts, teclado de PIN, estado de conexión e insumos.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Render list of products inside the admin settings modal
 * @param {Array} products Current products list
 * @param {Function} editProduct Callback to prompt editing a product (id)
 * @param {Function} deleteProduct Callback to delete a product (id)
 */
function renderSettingsProducts(products, editProduct, deleteProduct) {
    const container = document.getElementById('settings-products-list');
    if (!container) return;

    container.innerHTML = '';

    products.forEach(p => {
        const item = document.createElement('div');
        item.className = "settings-product-item";

        let catLabel = 'Pastelitos';
        if (p.category === 'empanadas') catLabel = 'Empanadas';
        if (p.category === 'minis') catLabel = 'Minis';
        if (p.category === 'bebidas') catLabel = 'Bebidas';
        if (p.category === 'dulces') catLabel = 'Dulces';
        if (window.Combos && window.Combos.isHiddenFromSale(p)) catLabel += ' (oculto, no se vende)';

        item.innerHTML = `
            <div class="settings-product-info">
                <span class="settings-product-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                <span class="settings-product-details">
                    Precio: $${(p.price || 0).toFixed(2)}${p.price_bs > 0 ? ` (fijo Bs. ${p.price_bs.toFixed(2)})` : ''} | ${catLabel} | Máx: ${p.max} | Alerta: &le;${p.min} | ${escapeHtml(p.unit)}
                </span>
            </div>
            <div class="settings-actions">
                <button class="btn-settings-action edit" data-action="edit" title="Editar">
                    <i class="fa-solid fa-pen" style="font-size: 10px;"></i>
                </button>
                <button class="btn-settings-action delete" data-action="delete" title="Eliminar">
                    <i class="fa-solid fa-trash-can" style="font-size: 10px;"></i>
                </button>
            </div>
        `;

        item.querySelector('[data-action="edit"]').addEventListener('click', () => {
            editProduct(p.id);
        });
        
        item.querySelector('[data-action="delete"]').addEventListener('click', () => {
            deleteProduct(p.id);
        });

        container.appendChild(item);
    });
}

/**
 * Toggle admin settings modal visibility
 * @param {boolean} show Open or close
 * @param {Array} products Optional products list to render if opening
 * @param {Function} editProduct Callback for editing a product
 * @param {Function} deleteProduct Callback for deleting a product
 */
function toggleSettingsModal(show, products, editProduct, deleteProduct) {
    if (show) {
        switchView('admin-dashboard');
        // Switch to settings sub-tab
        const tabPrefBtn = document.getElementById('admin-tab-btn-preferences');
        const panelPref = document.getElementById('admin-panel-preferences');
        if (tabPrefBtn && panelPref) {
            const tabBtns = document.querySelectorAll('.admin-tab-btn');
            const panels = document.querySelectorAll('.admin-panel');
            tabBtns.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            tabPrefBtn.classList.add('active');
            panelPref.classList.add('active');
        }
        if (products) {
            renderSettingsProducts(products, editProduct, deleteProduct);
        }
    } else {
        // If they close, switch to dashboard summary
        const tabSummaryBtn = document.getElementById('admin-tab-btn-summary');
        const panelSummary = document.getElementById('admin-panel-summary');
        if (tabSummaryBtn && panelSummary) {
            const tabBtns = document.querySelectorAll('.admin-tab-btn');
            const panels = document.querySelectorAll('.admin-panel');
            tabBtns.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            tabSummaryBtn.classList.add('active');
            panelSummary.classList.add('active');
        }
    }
}

/**
 * Show a sleek toast message at the bottom of the screen
 * @param {string} message Text to display
 * @param {string} iconClass FontAwesome class list (e.g. 'fa-solid fa-circle-check')
 */
function showToast(message, iconClass) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');

    if (!toast || !toastMessage || !toastIcon) return;

    toastMessage.innerText = message;
    toastIcon.innerHTML = `<i class="${iconClass}"></i>`;

    toast.classList.add('show');

    const hideTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3500);

    toast.onclick = () => {
        clearTimeout(hideTimeout);
        toast.classList.remove('show');
    };
}

// ================= NEW ACCESSIBILITY & SECURITY FUNCTIONS =================

/**
 * Binds the click handlers for the PIN keypad overlay
 * @param {Function} onPINValid Validation callback (returns true if valid)
 */
function initPinKeypad(onPINValid) {
    const input = document.getElementById('pin-input');
    if (!input) return;

    input.value = '';
    
    // Create clone and replace to clear old event listeners
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('input', (e) => {
        const val = newInput.value.trim();
        
        if (val.length >= 4) {
            // Attempt instant match on typing
            const isValid = onPINValid(val, false);
            if (isValid) {
                newInput.value = '';
            } else if (val.length >= 8) {
                // Maximum 8 digits reached without match - trigger final submission failure
                const isFinalValid = onPINValid(val, true);
                if (!isFinalValid) {
                    newInput.value = '';
                }
            }
        }
    });

    newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = newInput.value.trim();
            if (val.length >= 4) {
                const isValid = onPINValid(val, true);
                if (!isValid) {
                    newInput.value = '';
                }
            }
        }
    });

    // Tap overlay anywhere to focus
    const overlay = document.getElementById('pin-overlay');
    if (overlay) {
        overlay.onclick = () => {
            newInput.focus();
        };
    }

    // Auto-focus input
    setTimeout(() => {
        newInput.focus();
    }, 300);
}

/**
 * Update the connection status dot
 * @param {'online' | 'local' | 'offline'} status Status mode
 * @param {string} [source] Pass 'powersync' for calls from
 *   updateSyncStatusUI (js/app/) -- see the Task 13 note below.
 */
function updateConnectionStatus(status, source) {
    const dot = document.getElementById('conn-status');
    if (!dot) return;

    if (window.SupabaseManager && window.SupabaseManager.isTestEnvironment && window.SupabaseManager.isTestEnvironment()) {
        dot.className = 'conn-status offline';
        dot.style.cssText = "display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%); color: #ffffff; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 900; letter-spacing: 0.05em; border: 1px solid rgba(255,255,255,0.3); height: 16px; font-family: var(--font-sans);";
        dot.innerHTML = `<i class="fa-solid fa-flask" style="margin-right: 3px; font-size: 8px;"></i> MODO PRUEBAS`;
        dot.setAttribute('title', 'Entorno de Pruebas Aislado (No afecta la base de datos oficial)');
        return;
    }

    // Plan B, Task 13: once PowerSync has completed its first sync, its own
    // connected/disconnected signal is authoritative (js/app/'s
    // updateSyncStatusUI calls this with source:'powersync'). Without this
    // guard, the older Supabase-realtime-driven callers below
    // (autoSyncAndReconnect, subscribeToChanges' reconnect) kept fighting
    // over this same dot -- confirmed live, PowerSync set it to "offline"
    // and a realtime reconnect flipped it back to "online" moments later.
    if (window.POWERSYNC_LOCAL_MODE && source !== 'powersync' && window.PowerSyncManager && window.PowerSyncManager.getSyncStatus) {
        const psStatus = window.PowerSyncManager.getSyncStatus();
        if (psStatus && psStatus.hasSynced) return;
    }

    dot.className = `conn-status ${status}`;

    let title = 'Sincronizado con base de datos (En vivo)';
    if (status === 'local') title = 'Modo Local Activo (Sin Base de Datos)';
    if (status === 'offline') title = 'Sin Internet / Guardando cambios localmente';

    dot.setAttribute('title', title);
}

/**
 * Render ingredients pantry stock levels inside the kitchen view
 * @param {Array} ingredients Current ingredients stock
 * @param {Function} onAddStock Callback when clicked "Comprar" to add stock
 */
function renderIngredientsPantry(ingredients, onAddStock) {
    const pantry = document.getElementById('kitchen-pantry-card');
    if (pantry) {
        pantry.remove();
    }
}
