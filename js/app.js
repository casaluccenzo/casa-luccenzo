// Main App Orchestration Module

// Local app state
let products = [];
let salesLog = [];
let expenses = [];
let debts = [];
let replenishments = [];
let ingredients = [];
let activeCategory = 'todos';
let searchQuery = '';

// Sound and vibration preferences
let preferences = { sound: true, vibration: true, supabaseUrl: '', supabaseKey: '' };

// User access role
let currentRole = null;

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
    window.UIManager.renderCategoryFilterBar(activeCategory, handleCategoryChange);
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
 * Handle stock adjustments, records transactions, triggers vibrations and floating numbers
 * @param {string} id Product identifier
 * @param {number} amount Change amount (+1 or -1)
 * @param {MouseEvent} event Click event to extract coordinates
 */
function adjustStock(id, amount, event) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    const originalStock = product.stock;
    const newStock = Math.max(0, Math.min(product.max, product.stock + amount));
    
    if (newStock === product.stock) {
        triggerHaptic(30); // Double error haptic tap if limits are reached
        return; 
    }

    // Spawn floating number indicator on tap coordinates
    if (event && event.clientX !== undefined) {
        const text = amount > 0 ? `+1` : `-1`;
        const colorClass = amount > 0 ? 'float-plus' : 'float-minus';
        window.UIManager.spawnFloatingIndicator(event.clientX, event.clientY, text, colorClass);
    }

    // Standard haptic confirmation tap
    triggerHaptic(15);

    // If stock decreased (Vendido / Sold)
    if (amount === -1) {
        const saleItem = {
            uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
            productId: product.id,
            name: product.name,
            price: product.price || 0,
            timestamp: new Date().toISOString()
        };
        salesLog.push(saleItem);
        window.StorageManager.saveSalesLog(salesLog);
        
        // Sync to Supabase
        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.insertSale(saleItem);
        }

        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale);

        // Update stats graph if admin is active
        if (currentRole === 'admin') {
            window.UIManager.renderStats(salesLog, expenses);
        }
    }

    product.stock = newStock;
    window.StorageManager.saveProducts(products);
    
    // Sync to Supabase
    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertProduct(product);
    }

    // Audio warning and haptic pulses if stock falls under threshold
    if (product.stock <= product.min && originalStock > product.min) {
        window.UIManager.showToast(`⚠️ ¡Atención! "${product.name}" se está agotando. Ya se avisó a la cocina.`, "fa-solid fa-bell");
        
        if (preferences.sound) {
            window.AudioManager.playAlertSound();
        }
        
        // Warning double vibration pulse
        triggerHaptic([50, 60, 50]);
    }

    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
}

/**
 * Undoes a sales transaction by restoring stock and subtracting from register
 * @param {string} uuid Sales log entry uuid
 */
function handleUndoSale(uuid) {
    const saleIndex = salesLog.findIndex(s => s.uuid === uuid);
    if (saleIndex === -1) return;

    const sale = salesLog[saleIndex];
    const product = products.find(p => p.id === sale.productId);

    triggerHaptic(15);

    if (product) {
        product.stock = Math.min(product.max, product.stock + 1);
        window.StorageManager.saveProducts(products);
        
        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.upsertProduct(product);
        }
    }

    salesLog.splice(saleIndex, 1);
    window.StorageManager.saveSalesLog(salesLog);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.deleteSale(sale.uuid);
    }

    // Refresh UI
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale);

    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }

    window.UIManager.showToast(`🔄 Venta de "${sale.name}" deshecha con éxito.`, "fa-solid fa-rotate-left");
}

/**
 * Reset all log history and cash register to $0.00
 */
function clearAllSales() {
    triggerHaptic(20);
    if (confirm("¿Estás seguro de que quieres borrar el historial de ventas y reiniciar la caja a $0.00?")) {
        // Sync deletes to Supabase
        if (window.SupabaseManager.isConfigured()) {
            salesLog.forEach(s => window.SupabaseManager.deleteSale(s.uuid));
        }

        salesLog = [];
        window.StorageManager.clearSalesLog();
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
        
        if (currentRole === 'admin') {
            window.UIManager.renderStats(salesLog, expenses);
        }

        window.UIManager.showToast("🧹 Historial de ventas y caja reiniciados.", "fa-solid fa-trash-can");
    }
}

// ================= DISPATCH FLOWS (KITCHEN <-> LOCAL) =================

/**
 * Kitchen trigger: Mark items as prepared and sent (status: en_camino)
 * @param {string} id Product identifier
 */
function deliverProduct(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    const amountNeeded = product.max - product.stock;
    if (amountNeeded <= 0) return;

    triggerHaptic(15);

    const newDispatch = {
        uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        productId: product.id,
        name: product.name,
        amount: amountNeeded,
        unit: product.unit || 'unid.',
        status: 'en_camino',
        timestamp: new Date().toISOString()
    };

    // Deduct recipe ingredients from pantry stock
    if (window.RecipeCalculator) {
        const recipeList = window.RecipeCalculator.calculateIngredients([{ ...product, stock: product.stock, max: product.max }]);
        recipeList.forEach(recipeItem => {
            const targetIng = ingredients.find(ing => {
                if (recipeItem.name === "Harina de Trigo") return ing.id === 'harina';
                if (recipeItem.name === "Margarina") return ing.id === 'margarina';
                if (recipeItem.name === "Relleno Carne Mechada") return ing.id === 'carne_mechada';
                if (recipeItem.name === "Relleno Pollo Desmechado") return ing.id === 'pollo';
                if (recipeItem.name === "Queso Blanco Rayado") return ing.id === 'queso';
                return false;
            });
            if (targetIng) {
                targetIng.stock = Math.max(0, targetIng.stock - recipeItem.amount);
                if (window.SupabaseManager.isConfigured()) {
                    window.SupabaseManager.upsertIngredient(targetIng);
                }
            }
        });
        window.StorageManager.saveIngredients(ingredients);
        window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    }

    // Filter local dispatches
    replenishments = replenishments.filter(r => r.productId !== id || r.status !== 'en_camino');
    replenishments.push(newDispatch);
    window.StorageManager.saveReplenishments(replenishments);

    // Sync to Supabase
    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertReplenishment(newDispatch);
    }

    window.UIManager.renderCocina(products, deliverProduct, replenishments);
    window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);

    window.UIManager.showToast(`🚚 "${product.name}" marcado como Enviado al local.`, "fa-solid fa-paper-plane");
}

/**
 * Local trigger: Mark all pending dispatches as received, replenishing stocks
 */
function confirmReceipt() {
    const pending = replenishments.filter(r => r.status === 'en_camino');
    if (pending.length === 0) return;

    triggerHaptic(15);

    pending.forEach(dispatch => {
        const product = products.find(p => p.id === dispatch.productId);
        if (product) {
            product.stock = product.max;
            if (window.SupabaseManager.isConfigured()) {
                window.SupabaseManager.upsertProduct(product);
            }
        }
        dispatch.status = 'recibido';
        
        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.deleteReplenishment(dispatch.uuid);
        }
    });

    replenishments = replenishments.filter(r => r.status !== 'recibido');
    window.StorageManager.saveReplenishments(replenishments);
    window.StorageManager.saveProducts(products);

    // Refresh views
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderCocina(products, deliverProduct, replenishments);
    window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);

    window.UIManager.showToast("✨ ¡Mercancía recibida! Vitrina al 100%.", "fa-solid fa-circle-check");
}

/**
 * Restock all vitrina products to max limits
 */
function resetToMax() {
    triggerHaptic(15);
    products.forEach(p => {
        p.stock = p.max;
        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.upsertProduct(p);
        }
    });
    window.StorageManager.saveProducts(products);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.showToast("✨ Vitrina rellenada al máximo.", "fa-solid fa-circle-check");
}

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
        timestamp: new Date().toISOString()
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
function deleteExpense(uuid) {
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

// ================= DEBTS virtual ledger (FIADOS) =================

/**
 * Register client debt or add more balance to existing debtor
 * @param {Event} e Submit event
 */
function addDebt(e) {
    e.preventDefault();

    const nameInput = document.getElementById('debt-client-name');
    const amountInput = document.getElementById('debt-amount');
    const descInput = document.getElementById('debt-desc');

    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const description = descInput.value.trim();

    if (!name || isNaN(amount) || amount <= 0) return;

    triggerHaptic(15);

    const existingClient = debts.find(d => d.clientName.toLowerCase() === name.toLowerCase());
    let targetDebtObj = null;

    if (existingClient) {
        existingClient.amount += amount;
        existingClient.timestamp = new Date().toISOString();
        if (description) {
            existingClient.description = existingClient.description 
                ? `${existingClient.description}, ${description}` 
                : description;
        }
        targetDebtObj = existingClient;
    } else {
        const newDebt = {
            uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
            clientName: name,
            amount,
            description,
            timestamp: new Date().toISOString()
        };
        debts.push(newDebt);
        targetDebtObj = newDebt;
    }

    window.StorageManager.saveDebts(debts);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertDebt(targetDebtObj);
    }

    window.UIManager.renderDebts(debts, settleDebtPayment);

    document.getElementById('add-debt-form').reset();
    window.UIManager.showToast(`📝 Cuenta de "${name}" actualizada.`, "fa-solid fa-book");
}

/**
 * Settle customer payments, subtracting from debt ledger and adding cash to register
 * @param {string} uuid Client ledger unique identifier
 */
function settleDebtPayment(uuid) {
    const client = debts.find(d => d.uuid === uuid);
    if (!client) return;

    triggerHaptic(15);

    const paymentPrompt = prompt(`Ingresa el monto que abona ${client.clientName}:\nDeuda actual: $${client.amount.toFixed(2)}`, client.amount.toFixed(2));
    if (paymentPrompt === null) return;

    const paymentAmount = parseFloat(paymentPrompt);
    if (isNaN(paymentAmount) || paymentAmount <= 0 || paymentAmount > client.amount) {
        alert("Monto inválido. No puede ser mayor que la deuda actual.");
        return;
    }

    triggerHaptic(15);

    client.amount = Math.max(0, client.amount - paymentAmount);
    client.timestamp = new Date().toISOString();
    client.description = `Abono de $${paymentAmount.toFixed(2)}`;

    const saleItem = {
        uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        productId: 'abono',
        name: `Abono: ${client.clientName}`,
        price: paymentAmount,
        timestamp: new Date().toISOString()
    };
    salesLog.push(saleItem);

    window.StorageManager.saveDebts(debts);
    window.StorageManager.saveSalesLog(salesLog);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertDebt(client);
        window.SupabaseManager.insertSale(saleItem);
    }

    window.UIManager.renderDebts(debts, settleDebtPayment);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale);

    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }

    window.UIManager.showToast(`💵 Pago de $${paymentAmount.toFixed(2)} registrado en caja.`, "fa-solid fa-hand-holding-dollar");
}

// ================= INGREDIENTS STOCK =================

/**
 * Prompt to add stock to kitchen ingredient alacena
 * @param {string} id Ingredient identifier
 */
function addIngredientStock(id) {
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;

    triggerHaptic(15);
    const promptAmount = prompt(`¿Cuántos ${ing.unit} de "${ing.name}" deseas agregar?`, "5.0");
    if (promptAmount === null) return;
    const amountVal = parseFloat(promptAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
        alert("Cantidad inválida.");
        return;
    }

    triggerHaptic(15);
    ing.stock += amountVal;
    window.StorageManager.saveIngredients(ingredients);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertIngredient(ing);
    }

    window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    window.UIManager.showToast(`📦 Se agregaron +${amountVal} ${ing.unit} de ${ing.name}.`, "fa-solid fa-circle-check");
}

// ================= DAY CLOSE BROADCASTS =================

/**
 * Format sales data and compile a WhatsApp day-close message
 */
function shareDayClose() {
    triggerHaptic(15);
    const totalSales = salesLog.reduce((sum, sale) => sum + (sale.price || 0), 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const netCash = totalSales - totalExpenses;
    
    const salesCount = {};
    salesLog.forEach(sale => {
        if (!salesCount[sale.name]) salesCount[sale.name] = 0;
        salesCount[sale.name]++;
    });
    
    let message = `📋 *CIERRE DE JORNADA - CASA LUCENZO*\n`;
    message += `Fecha: ${new Date().toLocaleDateString()}\n`;
    message += `--------------------------------------\n`;
    message += `*Pastelitos Vendidos:*\n`;
    for (const [name, count] of Object.entries(salesCount)) {
        message += `• ${count}x ${name}\n`;
    }
    if (Object.keys(salesCount).length === 0) {
        message += `• Sin ventas registradas.\n`;
    }
    
    message += `--------------------------------------\n`;
    message += `*Gastos del Día:*\n`;
    expenses.forEach(exp => {
        message += `• ${exp.description}: -$${exp.amount.toFixed(2)}\n`;
    });
    if (expenses.length === 0) {
        message += `• Sin gastos registrados.\n`;
    }
    
    message += `--------------------------------------\n`;
    message += `💰 *Ingresos Ventas:* +$${totalSales.toFixed(2)}\n`;
    message += `💸 *Total Gastos:* -$${totalExpenses.toFixed(2)}\n`;
    message += `💵 *Caja Neta Final:* *$${netCash.toFixed(2)}*\n`;
    message += `--------------------------------------\n`;
    message += `📢 _Cierre generado automáticamente. ¡Feliz noche!_ 🌟`;

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?text=${encodedMessage}`, '_blank');
}

/**
 * Open Cierre de Día modal overlay
 */
function openDayCloseModal() {
    triggerHaptic(15);
    window.UIManager.renderDayCloseModal(salesLog, expenses);
    document.getElementById('day-close-modal').classList.remove('hidden');
}

/**
 * Close Cierre de Día modal overlay
 */
function closeDayCloseModal() {
    triggerHaptic(15);
    document.getElementById('day-close-modal').classList.add('hidden');
}

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
    const categorySelect = document.getElementById('new-category');

    const name = nameInput.value.trim();
    const max = parseInt(maxInput.value);
    const min = parseInt(minInput.value);
    const unit = unitSelect.value;
    const price = parseFloat(priceInput.value) || 0;
    const category = categorySelect.value;

    if (!name) return;

    triggerHaptic(15);

    const id = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '_');

    if (products.some(p => p.id === id)) {
        alert("Ya existe un producto con un nombre similar.");
        return;
    }

    const newProd = { id, name, stock: max, min, max, unit, price, category };
    products.push(newProd);
    window.StorageManager.saveProducts(products);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertProduct(newProd);
    }

    window.UIManager.renderSettingsProducts(products, editProductPrompt, deleteProduct);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    
    document.getElementById('add-product-form').reset();
    window.UIManager.showToast(`✨ "${name}" agregado con éxito.`, "fa-solid fa-plus");
}

/**
 * Prompt to edit product limits, pricing, and category
 * @param {string} id Product identifier
 */
function editProductPrompt(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    triggerHaptic(15);

    const newName = prompt("Nombre del producto:", product.name);
    if (newName === null) return;
    if (!newName.trim()) {
        alert("El nombre no puede estar vacío.");
        return;
    }

    const newPrice = prompt("Precio de venta ($):", product.price !== undefined ? product.price : 1.50);
    if (newPrice === null) return;
    const priceVal = parseFloat(newPrice);
    if (isNaN(priceVal) || priceVal < 0) {
        alert("Precio inválido.");
        return;
    }

    const newMax = prompt("Cantidad máxima en vitrina:", product.max);
    if (newMax === null) return;
    const maxVal = parseInt(newMax);
    if (isNaN(maxVal) || maxVal <= 0) {
        alert("Cantidad máxima inválida.");
        return;
    }

    const newMin = prompt("Alerta mínima (aviso cocina):", product.min);
    if (newMin === null) return;
    const minVal = parseInt(newMin);
    if (isNaN(minVal) || minVal < 0) {
        alert("Alerta mínima inválida.");
        return;
    }

    const categoriesPrompt = "Escribe la categoría del producto:\n- pastelitos\n- tortas\n- bebidas";
    const newCategory = prompt(categoriesPrompt, product.category || 'pastelitos');
    if (newCategory === null) return;
    const catClean = newCategory.trim().toLowerCase();
    const validCats = ['pastelitos', 'tortas', 'bebidas'];
    const catVal = validCats.includes(catClean) ? catClean : 'pastelitos';

    triggerHaptic(15);

    product.name = newName.trim();
    product.price = priceVal;
    product.max = maxVal;
    product.min = minVal;
    product.category = catVal;
    product.stock = Math.min(product.stock, maxVal);

    window.StorageManager.saveProducts(products);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertProduct(product);
    }
    
    window.UIManager.renderSettingsProducts(products, editProductPrompt, deleteProduct);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.showToast("✏️ Producto editado correctamente.", "fa-solid fa-pen-to-square");
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
            salesLog.forEach(s => window.SupabaseManager.deleteSale(s.uuid));
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

// ================= DATA SYNCHRONIZATION FROM CLOUD =================

/**
 * Loads today's records and stocks from Supabase database
 */
async function loadAllDataFromSupabase() {
    console.log("Loading dashboard statistics and logs from Supabase...");
    
    // Fetch products
    const supProducts = await window.SupabaseManager.fetchProducts();
    if (supProducts && supProducts.length > 0) {
        products = supProducts;
        window.StorageManager.saveProducts(products);
    } else {
        products = window.StorageManager.loadProducts();
    }
    
    // Fetch today's sales
    const supSales = await window.SupabaseManager.fetchSales();
    if (supSales) {
        salesLog = supSales;
        window.StorageManager.saveSalesLog(salesLog);
    } else {
        salesLog = window.StorageManager.loadSalesLog();
    }

    // Fetch today's expenses
    const supExpenses = await window.SupabaseManager.fetchExpenses();
    if (supExpenses) {
        expenses = supExpenses;
        window.StorageManager.saveExpenses(expenses);
    } else {
        expenses = window.StorageManager.loadExpenses();
    }

    // Fetch debts list
    const supDebts = await window.SupabaseManager.fetchDebts();
    if (supDebts) {
        debts = supDebts;
        window.StorageManager.saveDebts(debts);
    } else {
        debts = window.StorageManager.loadDebts();
    }

    // Fetch active dispatches
    const supRepls = await window.SupabaseManager.fetchReplenishments();
    if (supRepls) {
        replenishments = supRepls;
        window.StorageManager.saveReplenishments(replenishments);
    } else {
        replenishments = window.StorageManager.loadReplenishments();
    }

    // Fetch raw materials ingredients stock
    const supIng = await window.SupabaseManager.fetchIngredients();
    if (supIng && supIng.length > 0) {
        ingredients = supIng;
        window.StorageManager.saveIngredients(ingredients);
    } else {
        ingredients = window.StorageManager.loadIngredients();
    }

    renderAllViews();
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
    renderAllViews();
}

/**
 * Triggers rendering for all active templates
 */
function renderAllViews() {
    window.UIManager.renderSearchBar(handleSearchChange);
    window.UIManager.renderCategoryFilterBar(activeCategory, handleCategoryChange);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
    window.UIManager.renderExpenses(expenses, deleteExpense);
    window.UIManager.renderDebts(debts, settleDebtPayment);
    window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);

    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }
}

/**
 * Handle real-time PostgreSQL updates, syncing memory state and re-rendering grids
 * @param {string} tableName Updated table key
 */
async function handleRealtimeDbUpdate(tableName) {
    console.log(`Realtime postgres update detected for table: ${tableName}`);
    
    if (tableName === 'products') {
        const data = await window.SupabaseManager.fetchProducts();
        if (data) {
            products = data;
            window.StorageManager.saveProducts(products);
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            if (!document.getElementById('view-cocina').classList.contains('hidden')) {
                window.UIManager.renderCocina(products, deliverProduct, replenishments);
            }
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
            replenishments = data;
            window.StorageManager.saveReplenishments(replenishments);
            window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
            if (!document.getElementById('view-cocina').classList.contains('hidden')) {
                window.UIManager.renderCocina(products, deliverProduct, replenishments);
            }
        }
    } else if (tableName === 'ingredients') {
        const data = await window.SupabaseManager.fetchIngredients();
        if (data) {
            ingredients = data;
            window.StorageManager.saveIngredients(ingredients);
            window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
        }
    }
}

// ================= USER ROLES ACCESS =================

/**
 * Validates PIN input codes and applies corresponding role UI layout
 * @param {string} pin 4-digit code
 * @returns {boolean} True if PIN matched a role
 */
function handlePINInput(pin) {
    if (pin === '1111') {
        applyUserRole('local');
        window.UIManager.showToast("🔓 Acceso Local Concedido (Venta).", "fa-solid fa-shop");
        return true;
    } else if (pin === '2222') {
        applyUserRole('cocina');
        window.UIManager.showToast("🔓 Acceso Cocina Concedido (Producción).", "fa-solid fa-fire-burner");
        return true;
    } else if (pin === '9999') {
        applyUserRole('admin');
        window.UIManager.showToast("🔓 Acceso Administrador Concedido.", "fa-solid fa-user-shield");
        return true;
    } else {
        triggerHaptic([80, 80]); // Double haptic feedback on error
        window.UIManager.showToast("❌ PIN incorrecto. Intenta de nuevo.", "fa-solid fa-circle-xmark");
        return false;
    }
}

/**
 * Configures the DOM UI visibility states by active role permissions
 * @param {string} role 'local' | 'cocina' | 'admin'
 */
function applyUserRole(role) {
    currentRole = role;
    sessionStorage.setItem('casa_lucenzo_active_role', role);

    const pinOverlay = document.getElementById('pin-overlay');
    if (pinOverlay) pinOverlay.style.display = 'none';

    const navBar = document.getElementById('switch-nav-bar');
    const btnSettings = document.getElementById('btn-settings-toggle');
    
    // Default unlocked structures
    document.getElementById('btn-local').classList.remove('hidden');
    document.getElementById('btn-cocina').classList.remove('hidden');
    document.getElementById('btn-fiados').classList.remove('hidden');
    navBar.classList.remove('hidden');
    btnSettings.classList.remove('hidden');
    
    // Hide administrative actions inside sections if local
    const undoSales = document.getElementById('sales-history-section');
    const clearSales = document.getElementById('btn-clear-sales');
    const dayCloseSec = document.getElementById('day-close-trigger-section');

    if (undoSales) undoSales.classList.remove('hidden');
    if (clearSales) clearSales.classList.remove('hidden');
    if (dayCloseSec) dayCloseSec.classList.remove('hidden');

    if (role === 'local') {
        // Local seller: only Local + Fiados views. Settings and stats blocked.
        document.getElementById('btn-cocina').classList.add('hidden');
        btnSettings.classList.add('hidden');
        if (clearSales) clearSales.classList.add('hidden');
        
        window.UIManager.switchView('local');
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    } else if (role === 'cocina') {
        // Kitchen parents: ONLY Kitchen view. Navigation bar hidden entirely.
        navBar.classList.add('hidden');
        btnSettings.classList.add('hidden');
        
        window.UIManager.switchView('cocina');
        window.UIManager.renderCocina(products, deliverProduct, replenishments);
        window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    } else if (role === 'admin') {
        // Full Admin: Everything visible, statistics dashboard loaded
        window.UIManager.switchView('local');
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderStats(salesLog, expenses);
    }
}

/**
 * Locks the current role and forces PIN re-entry overlay
 */
function lockSession() {
    triggerHaptic(15);
    sessionStorage.removeItem('casa_lucenzo_active_role');
    currentRole = null;

    const pinOverlay = document.getElementById('pin-overlay');
    if (pinOverlay) {
        pinOverlay.style.display = 'flex';
        // Clear display text inside keypad
        const display = document.getElementById('pin-display');
        if (display) display.innerText = '• • • •';
    }

    window.UIManager.initPinKeypad(handlePINInput);
}

// ================= APP INITIALIZATION =================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Register PWA Service Worker (only if running on local server or online)
    if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker Registered with scope:', reg.scope))
            .catch(err => console.warn('Service Worker registration failed:', err));
    }

    // 2. Load preferences and inputs configuration
    preferences = window.StorageManager.loadPreferences();

    document.getElementById('pref-sound').checked = preferences.sound !== false;
    document.getElementById('pref-vibrate').checked = preferences.vibration !== false;
    document.getElementById('pref-supabase-url').value = preferences.supabaseUrl || '';
    document.getElementById('pref-supabase-key').value = preferences.supabaseKey || '';

    // 3. Initialize connection status dots
    if (window.StorageManager.loadPreferences().supabaseUrl) {
        if (navigator.onLine) {
            window.UIManager.updateConnectionStatus('online');
        } else {
            window.UIManager.updateConnectionStatus('offline');
        }
    } else {
        window.UIManager.updateConnectionStatus('local');
    }

    // 4. Initialize Supabase if keys are provided
    const isSupabaseReady = window.SupabaseManager.init();

    if (isSupabaseReady) {
        loadAllDataFromSupabase();
        window.SupabaseManager.subscribeToChanges(handleRealtimeDbUpdate);
    } else {
        loadAllDataFromLocalStorage();
    }

    // 5. User roles validation checks
    const activeRole = sessionStorage.getItem('casa_lucenzo_active_role');
    if (activeRole) {
        applyUserRole(activeRole);
    } else {
        lockSession();
    }

    // 6. Bind navigation buttons (Vitrina, Cocina, Fiados)
    document.getElementById('btn-local').addEventListener('click', () => {
        window.UIManager.switchView('local');
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
    });

    document.getElementById('btn-cocina').addEventListener('click', () => {
        window.UIManager.switchView('cocina');
        window.UIManager.renderCocina(products, deliverProduct, replenishments);
        window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    });

    document.getElementById('btn-fiados').addEventListener('click', () => {
        window.UIManager.switchView('fiados');
        window.UIManager.renderDebts(debts, settleDebtPayment);
    });

    // 7. Bind configuration modal toggles
    document.getElementById('btn-settings-toggle').addEventListener('click', () => {
        window.UIManager.toggleSettingsModal(true, products, editProductPrompt, deleteProduct);
    });

    document.getElementById('btn-settings-close').addEventListener('click', () => {
        window.UIManager.toggleSettingsModal(false);
    });

    document.getElementById('btn-settings-cancel').addEventListener('click', () => {
        window.UIManager.toggleSettingsModal(false);
    });

    // 8. Bind WhatsApp sharing (Kitchen report)
    document.getElementById('btn-whatsapp-share').addEventListener('click', () => {
        window.ShareManager.shareToWhatsApp(products, window.UIManager.showToast);
    });

    // 9. Bind vitrina refill all
    document.getElementById('btn-reset-all').addEventListener('click', resetToMax);

    // 10. Bind factory reset
    document.getElementById('btn-factory-reset').addEventListener('click', restoreDefaultProducts);

    // 11. Bind clear sales history
    document.getElementById('btn-clear-sales').addEventListener('click', clearAllSales);

    // 12. Bind add product form
    document.getElementById('add-product-form').addEventListener('submit', addNewProduct);

    // 13. Bind expenses form
    document.getElementById('add-expense-form').addEventListener('submit', addExpense);

    // 14. Bind debts form
    document.getElementById('add-debt-form').addEventListener('submit', addDebt);

    // 15. Bind Day Close triggers
    document.getElementById('btn-cierre-dia-open').addEventListener('click', openDayCloseModal);
    document.getElementById('btn-cierre-dia-close').addEventListener('click', closeDayCloseModal);
    document.getElementById('btn-cierre-dia-confirm').addEventListener('click', () => {
        shareDayClose();
        closeDayCloseModal();
    });

    // 16. Bind preference toggle checkboxes and credentials
    document.getElementById('pref-sound').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-vibrate').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-supabase-url').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-supabase-key').addEventListener('change', handlePreferencesChange);

    // 17. Bind lock icon buttons
    document.getElementById('btn-lock-user').addEventListener('click', lockSession);

    // 18. Bind online/offline indicator dot changes
    window.addEventListener('online', () => {
        if (window.SupabaseManager.isConfigured()) {
            window.UIManager.updateConnectionStatus('online');
            window.SupabaseManager.syncOfflineQueue();
        }
    });
    window.addEventListener('offline', () => {
        if (window.SupabaseManager.isConfigured()) {
            window.UIManager.updateConnectionStatus('offline');
        }
    });
});
