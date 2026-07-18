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
let currentCart = [];


// Sound and vibration preferences
let preferences = { sound: true, vibration: true, supabaseUrl: '', supabaseKey: '' };

// User access role
let currentRole = null;

// BCV Exchange Rate state
let bcvRate = 732.48;
let useAutoBcv = true;

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

    if (amount === -1) {
        // Adding 1 to cart / selling
        if (product.stock <= 0) {
            triggerHaptic(30);
            window.UIManager.showToast(`⚠️ "${product.name}" no tiene stock en vitrina.`, "fa-solid fa-triangle-exclamation");
            return;
        }

        // Spawn floating number indicator on tap coordinates
        if (event && event.clientX !== undefined) {
            window.UIManager.spawnFloatingIndicator(event.clientX, event.clientY, `-1`, 'float-minus');
        }

        triggerHaptic(15);

        // Add to active cart
        const cartItem = currentCart.find(item => item.productId === id);
        if (cartItem) {
            cartItem.quantity++;
        } else {
            currentCart.push({
                productId: product.id,
                name: product.name,
                price: product.price || 0,
                quantity: 1
            });
        }
        localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));

        const originalStock = product.stock;
        product.stock = Math.max(0, product.stock - 1);
        window.StorageManager.saveProducts(products);

        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.updateProductStock(product.id, product.stock);
        }

        // Audio warning if stock falls under threshold
        if (product.stock <= product.min && originalStock > product.min) {
            window.UIManager.showToast(`⚠️ ¡Atención! "${product.name}" se está agotando. Ya se avisó a la cocina.`, "fa-solid fa-bell");
            if (preferences.sound) {
                window.AudioManager.playAlertSound();
            }
            triggerHaptic([50, 60, 50]);
        }

        // Render Cart and Local
        window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    } else if (amount === 1) {
        // Restocking vitrina (standard + button)
        const originalStock = product.stock;
        const newStock = originalStock >= product.max ? originalStock + 1 : Math.min(product.max, originalStock + 1);

        if (newStock === product.stock) {
            triggerHaptic(30);
            return;
        }

        if (event && event.clientX !== undefined) {
            window.UIManager.spawnFloatingIndicator(event.clientX, event.clientY, `+1`, 'float-plus');
        }

        triggerHaptic(15);

        product.stock = newStock;
        window.StorageManager.saveProducts(products);

        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.updateProductStock(product.id, product.stock);
        }

        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    }
}

/**
 * Increment cart item quantity (taking from vitrina stock)
 */
function handleAddToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock <= 0) {
        triggerHaptic(30);
        window.UIManager.showToast(`⚠️ No hay más "${product ? product.name : ''}" en vitrina.`, "fa-solid fa-triangle-exclamation");
        return;
    }

    triggerHaptic(15);

    const cartItem = currentCart.find(item => item.productId === productId);
    if (cartItem) {
        cartItem.quantity++;
    } else {
        currentCart.push({
            productId: product.id,
            name: product.name,
            price: product.price || 0,
            quantity: 1
        });
    }
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));

    product.stock = Math.max(0, product.stock - 1);
    window.StorageManager.saveProducts(products);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.updateProductStock(product.id, product.stock);
    }

    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
}

/**
 * Decrement cart item quantity (returning to vitrina stock)
 */
function handleRemoveFromCart(productId) {
    const cartItemIndex = currentCart.findIndex(item => item.productId === productId);
    if (cartItemIndex === -1) return;

    triggerHaptic(15);

    const cartItem = currentCart[cartItemIndex];
    const product = products.find(p => p.id === productId);

    if (product) {
        product.stock = product.stock >= product.max ? product.stock + 1 : Math.min(product.max, product.stock + 1);
        window.StorageManager.saveProducts(products);
        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.updateProductStock(product.id, product.stock);
        }
    }

    cartItem.quantity--;
    if (cartItem.quantity <= 0) {
        currentCart.splice(cartItemIndex, 1);
    }
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));

    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
}

/**
 * Empty the current cart, returning all items back to vitrina stock
 */
function handleClearCart() {
    if (currentCart.length === 0) return;

    triggerHaptic(20);
    if (confirm("¿Estás seguro de que quieres vaciar la cuenta del cliente? Todos los productos se devolverán a la vitrina.")) {
        currentCart.forEach(cartItem => {
            const product = products.find(p => p.id === cartItem.productId);
            if (product) {
                product.stock = product.stock >= product.max ? product.stock + cartItem.quantity : Math.min(product.max, product.stock + cartItem.quantity);
                if (window.SupabaseManager.isConfigured()) {
                    window.SupabaseManager.updateProductStock(product.id, product.stock);
                }
            }
        });
        currentCart = [];
        localStorage.removeItem('casa_lucenzo_current_cart');
        window.StorageManager.saveProducts(products);

        window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.showToast("🧹 Cuenta del cliente vaciada.", "fa-solid fa-trash-can");
    }
}

/**
 * Checkout active cart: ask for client name, record grouped sales log, sync to Supabase, and clear cart
 */
async function handleCheckoutCart() {
    if (currentCart.length === 0) return;

    triggerHaptic(15);
    const defaultName = sessionStorage.getItem('casa_lucenzo_editing_client_name') || "";
    const clientNameInput = prompt("Ingresa el nombre del cliente / mesa (Opcional):", defaultName);
    if (clientNameInput === null) return; // Cancelled

    sessionStorage.removeItem('casa_lucenzo_editing_client_name');

    const clientName = clientNameInput.trim() || `Cliente #${salesLog.length + 1}`;
    const timestamp = new Date().toISOString();
    
    // Create sales log items for each cart product (repeated rows if quantity > 1, or just separate rows)
    const newSales = [];
    currentCart.forEach(cartItem => {
        for (let i = 0; i < cartItem.quantity; i++) {
            const saleItem = {
                uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
                productId: cartItem.productId,
                name: `${cartItem.name} [${clientName}]`, // Store client name in brackets
                price: cartItem.price || 0,
                timestamp: timestamp
            };
            newSales.push(saleItem);
        }
    });

    salesLog.push(...newSales);
    window.StorageManager.saveSalesLog(salesLog);

    // Sync to Supabase
    if (window.SupabaseManager.isConfigured()) {
        try {
            const syncPromises = newSales.map(sale => window.SupabaseManager.insertSale(sale));
            await Promise.all(syncPromises);
        } catch (e) {
            console.error("Error syncing cart checkout sales to Supabase", e);
        }
    }

    currentCart = [];
    localStorage.removeItem('casa_lucenzo_current_cart');

    // Refresh UI views
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale);

    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }

    window.UIManager.showToast(`💵 Cuenta de "${clientName}" cobrada con éxito.`, "fa-solid fa-circle-check");
}

/**
 * Undoes a sales transaction by restoring stock and subtracting from register
 * @param {string} timestamp Sales log entry transaction timestamp
 */
function handleUndoSale(timestamp) {
    const matchingSales = salesLog.filter(s => s.timestamp === timestamp);
    if (matchingSales.length === 0) return;

    triggerHaptic(15);

    if (confirm(`¿Estás seguro de deshacer esta cuenta completa y devolver los productos al stock?`)) {
        matchingSales.forEach(sale => {
            const product = products.find(p => p.id === sale.productId);
            if (product) {
                product.stock = product.stock >= product.max ? product.stock + 1 : Math.min(product.max, product.stock + 1);
                if (window.SupabaseManager.isConfigured()) {
                    window.SupabaseManager.updateProductStock(product.id, product.stock);
                }
            }
            if (window.SupabaseManager.isConfigured()) {
                window.SupabaseManager.deleteSale(sale.uuid);
            }
        });

        // Filter out these sales from memory
        salesLog = salesLog.filter(s => s.timestamp !== timestamp);
        window.StorageManager.saveSalesLog(salesLog);
        window.StorageManager.saveProducts(products);

        // Refresh UI
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale, handleEditSale);

        if (currentRole === 'admin') {
            window.UIManager.renderStats(salesLog, expenses);
        }

        window.UIManager.showToast(`🔄 Cuenta deshecha y productos devueltos a vitrina.`, "fa-solid fa-rotate-left");
    }
}

/**
 * Loads a sales transaction back into the active cart for modification, deleting old sales records
 * @param {string} timestamp Sales log entry transaction timestamp
 */
async function handleEditSale(timestamp) {
    const matchingSales = salesLog.filter(s => s.timestamp === timestamp);
    if (matchingSales.length === 0) return;

    if (currentCart.length > 0) {
        if (!confirm("Ya tienes productos en la cuenta activa. ¿Deseas vaciarla para cargar esta cuenta del historial?")) {
            return;
        }
    }

    triggerHaptic(15);

    // 1. Group matching sales by product_id to reconstruct the cart
    const cartReconstructed = [];
    matchingSales.forEach(sale => {
        const existing = cartReconstructed.find(item => item.productId === sale.productId);
        if (existing) {
            existing.quantity++;
        } else {
            const cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado\))?$/, '');
            cartReconstructed.push({
                productId: sale.productId,
                name: cleanName,
                price: sale.price || 0,
                quantity: 1
            });
        }
    });

    // Extract client name
    let clientName = 'Cliente';
    const firstSale = matchingSales[0];
    const match = firstSale.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado\))?$/);
    if (match) {
        clientName = match[2];
    } else {
        clientName = firstSale.productId === 'abono' ? 'Abono Deuda' : 'Cliente';
    }

    // 2. Set active cart in memory and localStorage
    currentCart = cartReconstructed;
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));
    sessionStorage.setItem('casa_lucenzo_editing_client_name', clientName);

    // 3. Delete old sales records from Supabase and memory (no stock restoration, since they are now in the active cart)
    if (window.SupabaseManager.isConfigured()) {
        try {
            const deletePromises = matchingSales.map(sale => window.SupabaseManager.deleteSale(sale.uuid));
            await Promise.all(deletePromises);
        } catch (e) {
            console.error("Error deleting old sales during modification", e);
        }
    }

    salesLog = salesLog.filter(s => s.timestamp !== timestamp);
    window.StorageManager.saveSalesLog(salesLog);

    // 4. Switch to local view and update UI
    window.UIManager.switchView('local');
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale, handleEditSale);

    if (currentRole === 'admin') {
        window.UIManager.renderStats(salesLog, expenses);
    }

    window.UIManager.showToast(`✏️ Cuenta de "${clientName}" cargada para modificar.`, "fa-solid fa-pen-to-square");
}

/**
 * Marks a sales transaction as paid, updating Supabase and memory (changing suffix to include (Pagado))
 * @param {string} timestamp Sales log entry transaction timestamp
 */
async function markTransactionAsPaid(timestamp) {
    const matchingSales = salesLog.filter(s => s.timestamp === timestamp);
    if (matchingSales.length === 0) return;

    triggerHaptic(15);

    // 1. Map to updated sales
    const updatedSales = matchingSales.map(sale => {
        let newName = sale.name;
        if (!newName.endsWith(' (Pagado)')) {
            newName = `${sale.name} (Pagado)`;
        }
        return {
            ...sale,
            name: newName
        };
    });

    // 2. Delete old sales in Supabase, and insert updated sales
    if (window.SupabaseManager.isConfigured()) {
        try {
            // Delete old
            const deletePromises = matchingSales.map(sale => window.SupabaseManager.deleteSale(sale.uuid));
            await Promise.all(deletePromises);
            
            // Insert updated
            const insertPromises = updatedSales.map(sale => window.SupabaseManager.insertSale(sale));
            await Promise.all(insertPromises);
        } catch (e) {
            console.error("Error updating sale status to paid in Supabase", e);
        }
    }

    // Update local salesLog
    salesLog = salesLog.map(s => {
        if (s.timestamp === timestamp) {
            let newName = s.name;
            if (!newName.endsWith(' (Pagado)')) {
                newName = `${s.name} (Pagado)`;
            }
            return { ...s, name: newName };
        }
        return s;
    });

    window.StorageManager.saveSalesLog(salesLog);

    // Render
    renderAllViews();
    window.UIManager.showToast("💵 Cuenta marcada como Pagada.", "fa-solid fa-circle-check");
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
                window.SupabaseManager.updateProductStock(product.id, product.stock);
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
            window.SupabaseManager.updateProductStock(p.id, p.max);
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
        if (sale.productId !== 'abono') {
            const cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado\))?$/, '');
            if (!salesCount[cleanName]) salesCount[cleanName] = 0;
            salesCount[cleanName]++;
        } else {
            if (!salesCount[sale.name]) salesCount[sale.name] = 0;
            salesCount[sale.name]++;
        }
    });

    
    let message = `📋 *CIERRE DE JORNADA - CASA LUCENZO*\n`;
    message += `Fecha: ${new Date().toLocaleDateString()}\n`;
    message += `Tasa BCV del Día: ${bcvRate.toFixed(2)} Bs.\n`;
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
        message += `• ${exp.description}: -$${exp.amount.toFixed(2)} (Bs. ${(exp.amount * bcvRate).toFixed(2)})\n`;
    });
    if (expenses.length === 0) {
        message += `• Sin gastos registrados.\n`;
    }
    
    message += `--------------------------------------\n`;
    message += `💰 *Ingresos Ventas:* +$${totalSales.toFixed(2)} (Bs. ${(totalSales * bcvRate).toFixed(2)})\n`;
    message += `💸 *Total Gastos:* -$${totalExpenses.toFixed(2)} (Bs. ${(totalExpenses * bcvRate).toFixed(2)})\n`;
    message += `💵 *Caja Neta Final:* *$${netCash.toFixed(2)}* (Bs. *( ${(netCash * bcvRate).toFixed(2)} )*)\n`;
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

/**
 * Clear daily sales and expenses logs locally and sync to Supabase, and refill vitrina stock to max for tomorrow
 */
async function closeDayAndResetLogs() {
    try {
        window.UIManager.showToast("⏳ Cerrando jornada y preparando vitrina...", "fa-solid fa-hourglass-start");
        
        // 1. Sync deletes to Supabase if configured
        if (window.SupabaseManager.isConfigured()) {
            console.log("Clearing daily sales and expenses from Supabase...");
            const salesDeletes = salesLog.map(s => window.SupabaseManager.deleteSale(s.uuid));
            const expensesDeletes = expenses.map(e => window.SupabaseManager.deleteExpense(e.uuid));
            await Promise.all([...salesDeletes, ...expensesDeletes]);
        }

        // 2. Clear local arrays
        salesLog = [];
        expenses = [];

        // 3. Clear local storage logs
        window.StorageManager.clearSalesLog();
        window.StorageManager.clearExpenses();

        // 4. Refill all vitrina products to their maximum capacity
        products.forEach(p => {
            p.stock = p.max;
            if (window.SupabaseManager.isConfigured()) {
                window.SupabaseManager.updateProductStock(p.id, p.max);
            }
        });
        window.StorageManager.saveProducts(products);

        // 5. Re-render UI
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
        window.UIManager.renderExpenses(expenses, deleteExpense);
        
        if (currentRole === 'admin') {
            window.UIManager.renderStats(salesLog, expenses);
        }

        window.UIManager.showToast("🌅 ¡Jornada cerrada! Caja en cero y vitrina lista al 100% para mañana.", "fa-solid fa-circle-check");
    } catch (e) {
        console.error("Failed to reset logs during day close", e);
        window.UIManager.showToast("❌ Error al cerrar la jornada.", "fa-solid fa-circle-xmark");
    }
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

    const newStockVal = prompt("Cantidad actual en vitrina (Stock):", product.stock);
    if (newStockVal === null) return;
    const stockVal = parseInt(newStockVal);
    if (isNaN(stockVal) || stockVal < 0) {
        alert("Cantidad de stock inválida.");
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
    product.stock = stockVal;

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

    // Fetch app configuration (exchange rate)
    const supConfig = await window.SupabaseManager.fetchAppConfig();
    if (supConfig) {
        bcvRate = parseFloat(supConfig.bcv_rate) || 732.48;
        useAutoBcv = supConfig.use_auto_bcv !== false;
        window.bcvRate = bcvRate;
        window.StorageManager.saveBcvPreferences(bcvRate, useAutoBcv);
        
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
    
    const bcvPrefs = window.StorageManager.loadBcvPreferences();
    bcvRate = bcvPrefs.bcvRate || 732.48;
    useAutoBcv = bcvPrefs.useAutoBcv !== false;
    window.bcvRate = bcvRate;
    
    renderAllViews();
}

/**
 * Triggers rendering for all active templates
 */
function renderAllViews() {
    window.UIManager.renderSearchBar(handleSearchChange);
    window.UIManager.renderCategoryFilterBar(activeCategory, handleCategoryChange);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale, handleEditSale);
    window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);

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
async function handleRealtimeDbUpdate(tableName, payload) {
    console.log(`Realtime postgres update detected for table: ${tableName}`, payload);
    
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
                category: newRow.category || 'pastelitos'
            };
            if (idx !== -1) {
                products[idx] = formatted;
            } else {
                products.push(formatted);
            }
        }
        window.StorageManager.saveProducts(products);
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderCocina(products, deliverProduct, replenishments);
        window.UIManager.updateKitchenBadge(products);
    } else if (tableName === 'sales') {
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);

        if (eventType === 'DELETE') {
            salesLog = salesLog.filter(s => s.uuid !== oldRow.uuid);
        } else {
            const saleDate = new Date(newRow.timestamp);
            if (saleDate >= startOfDay) {
                const idx = salesLog.findIndex(s => s.uuid === newRow.uuid);
                const formatted = {
                    uuid: newRow.uuid,
                    productId: newRow.product_id,
                    name: newRow.name,
                    price: parseFloat(newRow.price) || 0,
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
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
        if (currentRole === 'admin') {
            window.UIManager.renderStats(salesLog, expenses);
        }
    } else if (tableName === 'expenses') {
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);

        if (eventType === 'DELETE') {
            expenses = expenses.filter(e => e.uuid !== oldRow.uuid);
        } else {
            const expDate = new Date(newRow.timestamp);
            if (expDate >= startOfDay) {
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
            window.UIManager.renderStats(salesLog, expenses);
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
        } else {
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
        window.UIManager.renderCocina(products, deliverProduct, replenishments);
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
            bcvRate = parseFloat(newRow.bcv_rate) || 732.48;
            useAutoBcv = newRow.use_auto_bcv !== false;
            window.bcvRate = bcvRate;
            window.StorageManager.saveBcvPreferences(bcvRate, useAutoBcv);
            
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

            // Re-render all views
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.renderCashRegister(salesLog, expenses);
            window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
            window.UIManager.renderDebts(debts, settleDebtPayment);
            window.UIManager.renderQuickConversionTable();
        }
    }
}

/**
 * Fallback full-fetch logic if real-time payloads fail or sync starts
 */
async function performFullFetch(tableName) {
    if (tableName === 'products') {
        const data = await window.SupabaseManager.fetchProducts();
        if (data) {
            products = data;
            window.StorageManager.saveProducts(products);
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.renderCocina(products, deliverProduct, replenishments);
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
            replenishments = data;
            window.StorageManager.saveReplenishments(replenishments);
            window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
            window.UIManager.renderCocina(products, deliverProduct, replenishments);
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
            bcvRate = parseFloat(data.bcv_rate) || 732.48;
            useAutoBcv = data.use_auto_bcv !== false;
            window.bcvRate = bcvRate;
            window.StorageManager.saveBcvPreferences(bcvRate, useAutoBcv);
            
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

            // Re-render
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.renderCashRegister(salesLog, expenses);
            window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
            window.UIManager.renderDebts(debts, settleDebtPayment);
            window.UIManager.renderQuickConversionTable();
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
    document.getElementById('btn-clientes').classList.remove('hidden');
    document.getElementById('btn-cocina').classList.remove('hidden');
    document.getElementById('btn-fiados').classList.remove('hidden');
    document.getElementById('btn-cambio').classList.remove('hidden');
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
        // Local seller: only Local + Clientes + Fiados + Cambio
        document.getElementById('btn-cocina').classList.add('hidden');
        btnSettings.classList.add('hidden');
        if (clearSales) clearSales.classList.add('hidden');
        
        // Dynamic numbering for local role
        const localSpan = document.querySelector('#btn-local span:last-child');
        const clientesSpan = document.querySelector('#btn-clientes span:last-child');
        const fiadosSpan = document.querySelector('#btn-fiados span:last-child');
        const cambioSpan = document.querySelector('#btn-cambio span:last-child');
        if (localSpan) localSpan.textContent = '1. LOCAL';
        if (clientesSpan) clientesSpan.textContent = '2. CLIENTES';
        if (fiadosSpan) fiadosSpan.textContent = '3. FIADOS';
        if (cambioSpan) cambioSpan.textContent = '4. CAMBIO';

        window.UIManager.switchView('local');
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    } else if (role === 'cocina') {
        // Kitchen parents: ONLY Kitchen view. Navigation bar hidden entirely.
        navBar.classList.add('hidden');
        btnSettings.classList.add('hidden');
        
        window.UIManager.switchView('cocina');
        window.UIManager.renderCocina(products, deliverProduct, replenishments);
        window.UIManager.renderIngredientsPantry(ingredients, addIngredientStock);
    } else if (role === 'admin') {
        // Full Admin: Everything visible, statistics dashboard loaded
        
        // Dynamic numbering for admin role
        const localSpan = document.querySelector('#btn-local span:last-child');
        const clientesSpan = document.querySelector('#btn-clientes span:last-child');
        const cocinaSpan = document.querySelector('#btn-cocina span:last-child');
        const fiadosSpan = document.querySelector('#btn-fiados span:last-child');
        const cambioSpan = document.querySelector('#btn-cambio span:last-child');
        if (localSpan) localSpan.textContent = '1. LOCAL';
        if (clientesSpan) clientesSpan.textContent = '2. CLIENTES';
        if (cocinaSpan) cocinaSpan.textContent = '3. COCINA';
        if (fiadosSpan) fiadosSpan.textContent = '4. FIADOS';
        if (cambioSpan) cambioSpan.textContent = '5. CAMBIO';

        window.UIManager.switchView('local');
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
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

/**
 * Saves BCV configuration locally and updates Supabase
 */
function saveAndSyncBcvConfig() {
    window.StorageManager.saveBcvPreferences(bcvRate, useAutoBcv);
    window.SupabaseManager.upsertAppConfig({ bcvRate, useAutoBcv });
}

/**
 * Update the header exchange rate text
 */
function updateBcvHeaderDisplay() {
    const el = document.getElementById('header-bcv-rate-input');
    if (el) {
        el.value = bcvRate;
    }
}

/**
 * Fetch the official BCV rate from DolarVZLA API (which updates correctly with next business day value date)
 */
async function fetchBcvRate() {
    if (!useAutoBcv) return;
    try {
        console.log("Fetching official BCV exchange rate...");
        const response = await fetch('https://rates.dolarvzla.com/bcv/current.json');
        if (response.ok) {
            const data = await response.json();
            if (data && data.current && data.current.usd) {
                bcvRate = parseFloat(data.current.usd);
                window.bcvRate = bcvRate;
                saveAndSyncBcvConfig();
                console.log(`BCV Rate updated successfully: ${bcvRate} Bs.`);
                
                const bcvRateInput = document.getElementById('pref-bcv-rate');
                if (bcvRateInput) {
                    bcvRateInput.value = bcvRate;
                }
                
                updateBcvHeaderDisplay();
                
                // Re-render UI
                window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
                window.UIManager.renderCashRegister(salesLog, expenses);
                window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
                window.UIManager.renderDebts(debts, settleDebtPayment);
                window.UIManager.renderQuickConversionTable();
            }
        }
    } catch (e) {
        console.error("Failed to fetch BCV rate, using fallback/cached value.", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Register PWA Service Worker (only if running on local server or online)
    if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('Service Worker Registered with scope:', reg.scope);
                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    if (installingWorker) {
                        installingWorker.onstatechange = () => {
                            if (installingWorker.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    console.log('New update installed, performing auto-reload.');
                                    if (window.UIManager && window.UIManager.showToast) {
                                        window.UIManager.showToast("🔄 Nueva versión cargada. Actualizando...", "fa-solid fa-arrows-rotate");
                                    }
                                    setTimeout(() => {
                                        window.location.reload();
                                    }, 1500);
                                }
                            }
                        };
                    }
                };
            })
            .catch(err => console.warn('Service Worker registration failed:', err));
    }

    // 2. Load preferences and inputs configuration
    preferences = window.StorageManager.loadPreferences();
    
    // Load active cart if stored
    const savedCart = localStorage.getItem('casa_lucenzo_current_cart');
    if (savedCart) {
        try {
            currentCart = JSON.parse(savedCart);
        } catch (e) {
            currentCart = [];
        }
    }

    
    // Initialize BCV Exchange Rate
    const bcvPrefs = window.StorageManager.loadBcvPreferences();
    bcvRate = bcvPrefs.bcvRate || 732.48;
    useAutoBcv = bcvPrefs.useAutoBcv !== false;
    window.bcvRate = bcvRate;
    
    const headerBcvInput = document.getElementById('header-bcv-rate-input');
    const autoBcvCheckbox = document.getElementById('pref-bcv-auto');
    const bcvRateInput = document.getElementById('pref-bcv-rate');
    
    if (headerBcvInput) {
        headerBcvInput.value = bcvRate;
        
        headerBcvInput.addEventListener('change', () => {
            const val = parseFloat(headerBcvInput.value);
            if (val > 0) {
                bcvRate = val;
                window.bcvRate = bcvRate;
                useAutoBcv = false; // Disable automatic sync since they manually set the rate
                saveAndSyncBcvConfig();
                
                // Sync Settings Modal components
                if (autoBcvCheckbox) autoBcvCheckbox.checked = false;
                if (bcvRateInput) {
                    bcvRateInput.value = bcvRate;
                    bcvRateInput.disabled = false;
                }
                
                // Re-render all views
                window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
                window.UIManager.renderCashRegister(salesLog, expenses);
                window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
                window.UIManager.renderDebts(debts, settleDebtPayment);
                
                window.UIManager.showToast(`💵 Tasa cambiada a ${bcvRate.toFixed(2)} Bs.`, "fa-solid fa-dollar-sign");
            }
        });
    }

    if (autoBcvCheckbox && bcvRateInput) {
        autoBcvCheckbox.checked = useAutoBcv;
        bcvRateInput.value = bcvRate;
        bcvRateInput.disabled = useAutoBcv;
        
        autoBcvCheckbox.addEventListener('change', () => {
            useAutoBcv = autoBcvCheckbox.checked;
            bcvRateInput.disabled = useAutoBcv;
            if (useAutoBcv) {
                fetchBcvRate();
            } else {
                saveAndSyncBcvConfig();
            }
        });
        
        bcvRateInput.addEventListener('change', () => {
            const val = parseFloat(bcvRateInput.value);
            if (val > 0) {
                bcvRate = val;
                window.bcvRate = bcvRate;
                saveAndSyncBcvConfig();
                
                // Sync Header input
                if (headerBcvInput) headerBcvInput.value = bcvRate;
                
                // Re-render
                window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
                window.UIManager.renderCashRegister(salesLog, expenses);
                window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
                window.UIManager.renderDebts(debts, settleDebtPayment);
            }
        });
    }
    
    updateBcvHeaderDisplay();
    if (useAutoBcv) {
        fetchBcvRate();
    }

    document.getElementById('pref-sound').checked = preferences.sound !== false;
    document.getElementById('pref-vibrate').checked = preferences.vibration !== false;
    document.getElementById('pref-supabase-url').value = preferences.supabaseUrl || 'https://xttpaqokeyywjaajvjyu.supabase.co';
    document.getElementById('pref-supabase-key').value = preferences.supabaseKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dHBhcW9rZXl5d2phYWp2anl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDQ2NDcsImV4cCI6MjA5OTgyMDY0N30.GUREG-_krI5l3cowwuGZv1774q3AaWEjbmwrWLqhXDE';

    // 3. Initialize connection status dots
    if (window.SupabaseManager.isConfigured()) {
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

    // 6. Bind navigation buttons (Vitrina, Clientes, Cocina, Fiados, Cambio)
    document.getElementById('btn-local').addEventListener('click', () => {
        window.UIManager.switchView('local');
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
        window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
    });

    document.getElementById('btn-clientes').addEventListener('click', () => {
        window.UIManager.switchView('clientes');
        window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
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

    document.getElementById('btn-cambio').addEventListener('click', () => {
        window.UIManager.switchView('cambio');
        window.UIManager.renderQuickConversionTable();
    });

    // Converter Calculator Logic
    const calcUsd = document.getElementById('calc-usd');
    const calcVes = document.getElementById('calc-ves');
    if (calcUsd && calcVes) {
        calcUsd.addEventListener('input', () => {
            const usd = parseFloat(calcUsd.value);
            if (!isNaN(usd)) {
                calcVes.value = (usd * bcvRate).toFixed(2);
            } else {
                calcVes.value = '';
            }
        });
        
        calcVes.addEventListener('input', () => {
            const ves = parseFloat(calcVes.value);
            if (!isNaN(ves)) {
                calcUsd.value = (ves / bcvRate).toFixed(2);
            } else {
                calcUsd.value = '';
            }
        });
    }

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
    document.getElementById('btn-cierre-dia-confirm').addEventListener('click', async () => {
        shareDayClose();
        closeDayCloseModal();
        await closeDayAndResetLogs();
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
