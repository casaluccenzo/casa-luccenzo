// Preferencias y gestión de productos (crear, editar, borrar, restaurar).
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// ================= ADMIN PREFERENCES =================

/**
 * Handle preference toggles changes (sound and vibration checkboxes)
 */
function handlePreferencesChange() {
    const soundVal = document.getElementById('pref-sound').checked;
    const vibrateVal = document.getElementById('pref-vibrate').checked;
    const supUrl = document.getElementById('pref-supabase-url').value.trim();
    const supKey = document.getElementById('pref-supabase-key').value.trim();

    const keysChanged = preferences.supabaseUrl !== supUrl || preferences.supabaseKey !== supKey;

    preferences.sound = soundVal;
    preferences.vibration = vibrateVal;
    preferences.supabaseUrl = supUrl;
    preferences.supabaseKey = supKey;

    window.StorageManager.savePreferences(preferences);
    
    if (vibrateVal) {
        triggerHaptic(15);
    }

    if (keysChanged) {
        console.log("Supabase connection credentials changed. Re-initializing...");
        const initialized = window.SupabaseManager.init();
        if (initialized) {
            window.UIManager.updateConnectionStatus('online');
            loadAllDataFromSupabase();
            window.SupabaseManager.subscribeToChanges(handleRealtimeDbUpdate);
        } else {
            window.UIManager.updateConnectionStatus('local');
            loadAllDataFromLocalStorage();
        }
    }
}

// ================= PRODUCT EDITING =================

/**
 * Add a new product to list from configuration panel
 * @param {Event} e Submit event
 */
function addNewProduct(e) {
    e.preventDefault();
    
    const nameInput = document.getElementById('new-name');
    const maxInput = document.getElementById('new-max');
    const minInput = document.getElementById('new-min');
    const unitSelect = document.getElementById('new-unit');
    const priceInput = document.getElementById('new-price');
    const costInput = document.getElementById('new-cost');
    const categorySelect = document.getElementById('new-category');

    const name = nameInput.value.trim();
    const max = parseInt(maxInput.value);
    const min = parseInt(minInput.value);
    const unit = unitSelect.value;
    const price = parseFloat(priceInput.value) || 0;
    const cost = parseFloat(costInput.value) || 0;
    const category = categorySelect.value;

    if (!name) return;

    triggerHaptic(15);

    const id = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '_');

    if (products.some(p => p.id === id)) {
        alert("Ya existe un producto con un nombre similar.");
        return;
    }

    const newProd = { id, name, stock: max, min, max, unit, price, cost, category, initial_stock: max };
    products.push(newProd);
    window.StorageManager.saveProducts(products);

    // Postgres recalcula products.stock desde stock_movements (migración 033):
    // sin esta carga inicial, la primera venta dejaba el producto en negativo.
    // Va después del producto para que el movimiento no llegue antes que él.
    if (window.SupabaseManager.isConfigured()) {
        Promise.resolve(window.SupabaseManager.upsertProduct(newProd))
            .then(() => recordStockMovement(newProd, max, 'load'));
    }

    window.UIManager.renderSettingsProducts(products, editProductPrompt, deleteProduct);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);

    document.getElementById('add-product-form').reset();
    window.UIManager.showToast(`✨ "${name}" agregado con éxito.`, "fa-solid fa-plus");
    logActivity("Producto Agregado", `Nuevo producto registrado: ${name} (Precio: $${price.toFixed(2)}, Max: ${max})`);
}

/**
 * Prompt to edit product limits, pricing, and category
 * @param {string} id Product identifier
 */
function editProductPrompt(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    triggerHaptic(15);

    document.getElementById('edit-prod-id').value = product.id;
    document.getElementById('edit-prod-name').value = product.name;
    document.getElementById('edit-prod-price').value = product.price !== undefined ? product.price : 1.50;
    document.getElementById('edit-prod-cost').value = product.cost !== undefined ? product.cost : 0;
    document.getElementById('edit-prod-price-bs-fixed').value = product.price_bs > 0 ? product.price_bs : '';
    document.getElementById('edit-prod-category').value = product.category || 'pastelitos';
    document.getElementById('edit-prod-stock').value = product.stock !== undefined ? product.stock : 0;
    document.getElementById('edit-prod-max').value = product.max !== undefined ? product.max : 20;
    document.getElementById('edit-prod-min').value = product.min !== undefined ? product.min : 6;

    updateEditPriceBsPreview();

    document.getElementById('edit-product-modal').classList.remove('hidden');
}

function updateEditPriceBsPreview() {
    const priceEl = document.getElementById('edit-prod-price');
    const bsEl = document.getElementById('edit-prod-price-bs');
    if (priceEl && bsEl) {
        const price = parseFloat(priceEl.value) || 0;
        const rate = window.bcvRate || bcvRate || 1;
        const bsVal = price * rate;
        bsEl.innerHTML = `<i class="fa-solid fa-calculator" style="font-size: 9px;"></i> ≈ Bs. ${bsVal.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    const fixedEl = document.getElementById('edit-prod-price-bs-fixed');
    const hintEl = document.getElementById('edit-prod-price-bs-fixed-hint');
    if (fixedEl && hintEl) {
        const fixed = parseFloat(fixedEl.value) || 0;
        const rate = window.bcvRate || bcvRate || 0;
        hintEl.textContent = fixed > 0 && rate > 0
            ? `Se cobra Bs. ${fixed.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} fijo. Hoy ≈ $${(fixed / rate).toFixed(2)}. El precio en $ no cambia.`
            : 'Vacío: se cobra el precio en dólares.';
    }
}

/**
 * Remove product from list
 * @param {string} id Product identifier
 */
function deleteProduct(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    triggerHaptic(15);

    if (confirm(`¿Estás seguro de que quieres eliminar "${product.name}"?`)) {
        triggerHaptic(15);
        products = products.filter(p => p.id !== id);
        window.StorageManager.saveProducts(products);

        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.deleteProduct(id);
        }

        window.UIManager.renderSettingsProducts(products, editProductPrompt, deleteProduct);
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.showToast("🗑️ Producto eliminado.", "fa-solid fa-trash");
        logActivity("Producto Eliminado", `Eliminado del menú: ${product.name}`);
    }
}

/**
 * Restores the inventory to the factory-default items and clears sales log
 */
function restoreDefaultProducts() {
    triggerHaptic(15);
    if (confirm("¿Estás seguro de reiniciar a los productos por defecto? Esto borrará tus cambios e historial de caja.")) {
        triggerHaptic(20);
        
        if (window.SupabaseManager.isConfigured()) {
            products.forEach(p => window.SupabaseManager.deleteProduct(p.id));
            salesLog.forEach(s => window.SupabaseManager.voidSale(s.uuid, "Restauración de productos por defecto"));
            expenses.forEach(e => window.SupabaseManager.deleteExpense(e.uuid));
            debts.forEach(d => window.SupabaseManager.deleteDebt(d.uuid));
            replenishments.forEach(r => window.SupabaseManager.deleteReplenishment(r.uuid));
        }

        products = window.StorageManager.resetToDefaults();
        ingredients = window.StorageManager.loadIngredients(); // reset ingredients too

        if (window.SupabaseManager.isConfigured()) {
            products.forEach(p => window.SupabaseManager.upsertProduct(p));
            ingredients.forEach(i => window.SupabaseManager.upsertIngredient(i));
        }

        salesLog = [];
        expenses = [];
        debts = [];
        replenishments = [];
        
        renderAllViews();
        
        window.UIManager.showToast("🔄 Sistema reiniciado con éxito.", "fa-solid fa-rotate-left");
    }
}
