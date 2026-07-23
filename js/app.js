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
let costInsumos = [];
let paymentStatsFilter = 'day';
let categoryStatsFilter = 'day';

let lastCloseTime = null;

// Sound and vibration preferences
let preferences = { sound: true, vibration: true, supabaseUrl: '', supabaseKey: '' };

// User access role
let currentRole = null;

// Customizable security PIN codes
let pinLocal = localStorage.getItem('casa_lucenzo_pin_local') || '1111';
let pinCocina = localStorage.getItem('casa_lucenzo_pin_cocina') || '2222';
let pinAdmin = '070821';
localStorage.setItem('casa_lucenzo_pin_admin', '070821');

// BCV Exchange Rate state
let bcvRate = 732.48;
let useAutoBcv = true;

// Current report data displayed in the day close modal
let currentReportData = { sales: [], expenses: [] };

// Global cache for admin statistics and hourly chart mode
let hourlyActiveMode = 'today';
let adminStatsSales = [];

// Unique device identifier for active session management
let myDeviceId = localStorage.getItem('casa_lucenzo_device_id');
if (!myDeviceId) {
    myDeviceId = crypto.randomUUID ? crypto.randomUUID() : 'dev_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('casa_lucenzo_device_id', myDeviceId);
}

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

        const diff = newStock - originalStock;
        product.stock = newStock;
        product.initial_stock = (product.initial_stock !== undefined && product.initial_stock !== null) ? (product.initial_stock + diff) : newStock;
        window.StorageManager.saveProducts(products);

        if (window.SupabaseManager.isConfigured()) {
            window.SupabaseManager.updateProductStock(product.id, product.stock, product.max, product.initial_stock);
        }

        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    }
}

/**
 * Handle manual quantity entry, updating the active cart and adjusting available stock
 * @param {string} id Product identifier
 * @param {number} newQty Target quantity to purchase (from manual input)
 */
function handleCartQtyChange(id, newQty) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    const cartItem = currentCart.find(item => item.productId === id);
    const q_old = cartItem ? cartItem.quantity : 0;
    
    // Total available stock that can be placed in cart for this product
    const max_qty = product.stock + q_old;

    if (newQty > max_qty) {
        newQty = max_qty;
        triggerHaptic(30);
        window.UIManager.showToast(`⚠️ Stock insuficiente. Solo puedes cargar un máximo de ${max_qty} piezas.`, "fa-solid fa-triangle-exclamation");
    }

    if (newQty < 0 || isNaN(newQty)) {
        newQty = 0;
    }

    const diff = newQty - q_old;
    if (diff === 0) return; // No change

    triggerHaptic(15);

    const originalStock = product.stock;
    product.stock = Math.max(0, product.stock - diff);
    window.StorageManager.saveProducts(products);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.updateProductStock(product.id, product.stock);
    }

    // Update cart items array
    if (newQty === 0) {
        const cartItemIndex = currentCart.findIndex(item => item.productId === id);
        if (cartItemIndex !== -1) {
            currentCart.splice(cartItemIndex, 1);
        }
    } else {
        if (cartItem) {
            cartItem.quantity = newQty;
        } else {
            currentCart.push({
                productId: product.id,
                name: product.name,
                price: product.price || 0,
                quantity: newQty
            });
        }
    }
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));

    // Audio warning if stock falls under threshold
    if (product.stock <= product.min && originalStock > product.min) {
        window.UIManager.showToast(`⚠️ ¡Atención! "${product.name}" se está agotando. Ya se avisó a la cocina.`, "fa-solid fa-bell");
        if (preferences.sound) {
            window.AudioManager.playAlertSound();
        }
        triggerHaptic([50, 60, 50]);
    }

    // Re-render Views
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
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
async function handleClearCart() {
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

        // Delete old sales from Supabase if we were editing an existing account
        const editingSalesStr = sessionStorage.getItem('casa_lucenzo_editing_sales');
        if (editingSalesStr) {
            try {
                const editingSales = JSON.parse(editingSalesStr);
                if (window.SupabaseManager.isConfigured()) {
                    await window.SupabaseManager.deleteSales(editingSales.map(sale => sale.uuid));
                }
            } catch (e) {
                console.error("Failed to delete old sales on clear cart:", e);
            }
            sessionStorage.removeItem('casa_lucenzo_editing_sales');
            sessionStorage.removeItem('casa_lucenzo_editing_timestamp');
            sessionStorage.removeItem('casa_lucenzo_editing_client_name');
        }

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

    const clientName = clientNameInput.trim() || `Cliente #${salesLog.length + 1}`;
    
    const editingTimestamp = sessionStorage.getItem('casa_lucenzo_editing_timestamp');
    const editingSalesStr = sessionStorage.getItem('casa_lucenzo_editing_sales');
    const timestamp = editingTimestamp || new Date().toISOString();

    if (editingSalesStr && editingTimestamp) {
        try {
            const editingSales = JSON.parse(editingSalesStr);
            if (window.SupabaseManager.isConfigured()) {
                await window.SupabaseManager.deleteSales(editingSales.map(sale => sale.uuid));
            }
        } catch (e) {
            console.error("Failed to delete old sales during checkout modification:", e);
        }
        // Remove old entries from local memory log
        salesLog = salesLog.filter(s => s.timestamp !== editingTimestamp);
        
        sessionStorage.removeItem('casa_lucenzo_editing_sales');
        sessionStorage.removeItem('casa_lucenzo_editing_timestamp');
    }
    sessionStorage.removeItem('casa_lucenzo_editing_client_name');
    
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
    logActivity("Registro Venta", `Venta de ${newSales.length} ítems por $${newSales.reduce((s,x)=>s+x.price, 0).toFixed(2)}. Cliente: ${clientName || 'Sin Nombre'}`);

    // Sync to Supabase
    if (window.SupabaseManager.isConfigured()) {
        try {
            await window.SupabaseManager.insertSales(newSales);
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
            window.UIManager.renderStats(salesLog, expenses, products);
        }

        window.UIManager.showToast(`🔄 Cuenta deshecha y productos devueltos a vitrina.`, "fa-solid fa-rotate-left");
        logActivity("Anulación Venta", `Venta anulada por el usuario (monto total devuelto al stock: $${matchingSales.reduce((s,x)=>s+x.price,0).toFixed(2)})`);
    }
}

/**
 * Autocorrects today's sales log to match the physical vitrina stock discrepancies
 * @param {Array} discrepancyList Audited products with discrepancies
 */
async function handleAutocorrectSales(discrepancyList) {
    triggerHaptic(15);
    
    const timestamp = new Date().toISOString();
    const newSales = [];
    
    discrepancyList.forEach(item => {
        if (item.discrepancy <= 0) return; // Only autocorrect missing items (expected > logged)
        
        for (let i = 0; i < item.discrepancy; i++) {
            const saleItem = {
                uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
                productId: item.product.id,
                name: `${item.product.name} [Ajuste Inventario]`,
                price: item.product.price || 0,
                timestamp: timestamp
            };
            newSales.push(saleItem);
        }
    });
    
    if (newSales.length === 0) return;
    
    salesLog.push(...newSales);
    window.StorageManager.saveSalesLog(salesLog);
    
    // Sync to Supabase
    if (window.SupabaseManager.isConfigured()) {
        try {
            await window.SupabaseManager.insertSales(newSales);
        } catch (e) {
            console.error("Error syncing autocorrected sales to Supabase", e);
        }
    }
    
    window.UIManager.showToast(`✨ Se han registrado ${newSales.length} ventas faltantes con éxito.`, "fa-solid fa-circle-check");
    
    // Refresh UI dashboards
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale, handleEditSale);
    window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
}
window.handleAutocorrectSales = handleAutocorrectSales;


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
            const cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
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
    const match = firstSale.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
    if (match) {
        clientName = match[2];
    } else {
        clientName = firstSale.productId === 'abono' ? 'Abono Deuda' : 'Cliente';
    }

    // 2. Set active cart in memory and localStorage
    currentCart = cartReconstructed;
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));
    sessionStorage.setItem('casa_lucenzo_editing_client_name', clientName);
    sessionStorage.setItem('casa_lucenzo_editing_timestamp', timestamp);
    sessionStorage.setItem('casa_lucenzo_editing_sales', JSON.stringify(matchingSales));

    // 3. Remove old sales locally to avoid double counting in active cart
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
async function markTransactionAsPaid(timestamp, paymentMethod) {
    const matchingSales = salesLog.filter(s => s.timestamp === timestamp);
    if (matchingSales.length === 0) return;

    // Ask for payment method if not provided yet
    if (!paymentMethod) {
        const totalAmount = matchingSales.reduce((sum, s) => sum + (s.price || 0), 0);
        let clientName = "Cliente";
        const firstSale = matchingSales[0];
        const bracketMatch = firstSale.name.match(/\[(.*?)\]/);
        if (bracketMatch) {
            clientName = bracketMatch[1];
        }

        if (window.UIManager && window.UIManager.showPaymentMethodModal) {
            window.UIManager.showPaymentMethodModal(clientName, totalAmount, (method) => {
                markTransactionAsPaid(timestamp, method);
            });
        } else {
            // Fallback if modal is not loaded
            markTransactionAsPaid(timestamp, "Efectivo");
        }
        return;
    }

    triggerHaptic(15);

    // 1. Map to updated sales with selected payment method
    const updatedSales = matchingSales.map(sale => {
        let newName = sale.name.replace(/\s*\(Pagado(?: - .*?)?\)$/, '');
        newName = `${newName} (Pagado - ${paymentMethod})`;
        return {
            ...sale,
            name: newName
        };
    });

    if (window.SupabaseManager.isConfigured()) {
        try {
            // Delete old
            await window.SupabaseManager.deleteSales(matchingSales.map(sale => sale.uuid));
            
            // Insert updated
            await window.SupabaseManager.insertSales(updatedSales);
        } catch (e) {
            console.error("Error updating sale status to paid in Supabase", e);
        }
    }

    // Update local salesLog
    salesLog = salesLog.map(s => {
        if (s.timestamp === timestamp) {
            let newName = s.name.replace(/\s*\(Pagado(?: - .*?)?\)$/, '');
            newName = `${newName} (Pagado - ${paymentMethod})`;
            return { ...s, name: newName };
        }
        return s;
    });

    window.StorageManager.saveSalesLog(salesLog);

    // Render
    renderAllViews();
    window.UIManager.showToast(`💵 Cuenta pagada con ${paymentMethod}.`, "fa-solid fa-circle-check");
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
            window.UIManager.renderStats(salesLog, expenses, products);
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
    logActivity("Despacho Cocina", `Cocinado y enviado ${amountNeeded} ${product.name} a vitrina`);
}

/**
 * Request replenishment from sales terminal to Kitchen
 */
async function handleQuickReplenishment(productId, productName, unit = 'unid.') {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const amountNeeded = Math.max(1, product.max - product.stock);
    
    triggerHaptic(15);
    
    // Check if we already have a pending/en_camino replenishment for this product
    const alreadyExists = replenishments.some(r => r.productId === productId && (r.status === 'pendiente' || r.status === 'en_camino'));
    if (alreadyExists) {
        window.UIManager.showToast(`⚠️ Ya existe una solicitud de reposición activa para "${productName}".`, "fa-solid fa-triangle-exclamation");
        return;
    }
    
    const newDispatch = {
        uuid: crypto.randomUUID ? crypto.randomUUID() : 'rep_' + Math.random().toString(36).substring(2) + Date.now().toString(36),
        productId: productId,
        name: productName,
        amount: amountNeeded,
        unit: unit,
        status: 'pendiente',
        timestamp: new Date().toISOString()
    };
    
    replenishments.push(newDispatch);
    window.StorageManager.saveReplenishments(replenishments);
    
    if (window.SupabaseManager.isConfigured()) {
        await window.SupabaseManager.upsertReplenishment(newDispatch);
    }
    
    window.UIManager.renderCocina(products, deliverProduct, replenishments);
    window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
    window.UIManager.renderCriticalStockAlerts(products, handleQuickReplenishment);
    
    window.UIManager.showToast(`⚡ Solicitud de reposición de ${amountNeeded} ${unit} enviada a Cocina.`, "fa-solid fa-circle-check");
    logActivity("Reposición Solicitada", `Solicitado reposición de ${amountNeeded} ${productName} a Cocina`);
}

/**
 * Update stock manually for a product (direct load from kitchen)
 * @param {string} id Product identifier
 * @param {number} newStock New stock value
 */
async function updateProductStockDirect(id, newStock) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    triggerHaptic(15);
    const oldStock = product.stock || 0;
    const targetStock = Math.max(0, newStock);
    const addedDiff = targetStock > oldStock ? (targetStock - oldStock) : 0;

    product.stock = targetStock;
    if (addedDiff > 0) {
        product.max = (product.max || 0) + addedDiff;
    }
    window.StorageManager.saveProducts(products);

    if (window.SupabaseManager.isConfigured()) {
        try {
            await window.SupabaseManager.updateProductStock(product.id, product.stock, product.max);
        } catch (e) {
            console.error("Failed to update product stock and max in Supabase", e);
        }
    }

    renderAllViews();
    window.UIManager.showToast(`✅ Vitrina actualizada: "${product.name}" ahora tiene ${product.stock} ${product.unit || 'unid.'}.`, "fa-solid fa-circle-check");
}

/**
 * Add stock manually for a product (incremental load from kitchen)
 * @param {string} id Product identifier
 * @param {number} amountToAdd Stock to add
 */
async function addProductStockDirect(id, amountToAdd) {
    const product = products.find(p => p.id === id);
    if (!product) return;
    if (amountToAdd <= 0) return;

    triggerHaptic(15);
    product.stock = product.stock + amountToAdd;
    product.max = product.max + amountToAdd;
    window.StorageManager.saveProducts(products);

    if (window.SupabaseManager.isConfigured()) {
        try {
            await window.SupabaseManager.updateProductStock(product.id, product.stock, product.max);
        } catch (e) {
            console.error("Failed to add product stock and max in Supabase", e);
        }
    }

    renderAllViews();
    window.UIManager.showToast(`✅ Vitrina actualizada: Se sumaron ${amountToAdd} piezas a "${product.name}". Total: ${product.stock}.`, "fa-solid fa-circle-check");
}
window.addProductStockDirect = addProductStockDirect;


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
            const added = dispatch.amount || 0;
            product.stock = product.stock + added;
            product.max = product.max + added;
            product.initial_stock = (product.initial_stock !== undefined && product.initial_stock !== null) ? (product.initial_stock + added) : product.stock;
            if (window.SupabaseManager.isConfigured()) {
                window.SupabaseManager.updateProductStock(product.id, product.stock, product.max, product.initial_stock);
            }
        }
        dispatch.status = 'recibido';
        logActivity("Recepción Vitrina", `Recibidos ${added} de ${product ? product.name : dispatch.productId} en vitrina`);
        
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

function resetToMax() {
    triggerHaptic(15);
    products.forEach(p => {
        if (p.category !== 'bebidas') {
            p.stock = p.max;
            p.initial_stock = p.max;
            if (window.SupabaseManager.isConfigured()) {
                window.SupabaseManager.updateProductStock(p.id, p.max, p.max, p.max);
            }
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
    const message = generateWhatsAppReport(salesLog, expenses, new Date().toLocaleDateString(), bcvRate, products);
    const encodedMessage = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?text=${encodedMessage}`, '_blank');
}

/**
 * Open Cierre de Día modal overlay
 */
function openDayCloseModal() {
    triggerHaptic(15);
    const todayLabel = new Date().toLocaleDateString();
    const currentRate = window.bcvRate || bcvRate;
    currentReportData = { sales: salesLog, expenses: expenses, dateLabel: todayLabel, rate: currentRate, isHistory: false };
    window.UIManager.renderDayCloseModal(salesLog, expenses, products, todayLabel, currentRate);
    document.getElementById('day-close-modal').classList.remove('hidden');
}

/**
 * Close Cierre de Día modal overlay
 */
function closeDayCloseModal() {
    triggerHaptic(15);
    document.getElementById('day-close-modal').classList.add('hidden');
}

function generateWhatsAppReport(reportSales, reportExpenses, dateLabel, rate, productsList = []) {
    const totalSales = reportSales.reduce((sum, s) => sum + (s.price || 0), 0);
    const totalExpenses = reportExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netCash = totalSales - totalExpenses;

    const categoryMap = {};

    reportSales.forEach(sale => {
        let cleanName = sale.name;
        if (sale.productId !== 'abono') {
            cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
        }

        let catKey = 'otros';
        let catLabel = '📦 Otros / Varios';
        let sortOrder = 99;

        if (sale.productId !== 'abono') {
            const product = productsList.find(p => p.id === sale.productId);
            const rawCat = product ? product.category : 'otros';

            if (rawCat === 'pastelitos') {
                const unitPrice = sale.price || (product ? product.price : 0);
                catKey = `pastelitos_${unitPrice.toFixed(2)}`;
                catLabel = `🥐 Pastelitos ($${unitPrice.toFixed(2)})`;
                sortOrder = 10 + unitPrice;
            } else if (rawCat === 'bebidas') {
                catKey = 'bebidas';
                catLabel = '🥤 Bebidas';
                sortOrder = 50;
            } else if (rawCat === 'tortas') {
                catKey = 'tortas';
                catLabel = '🍰 Tortas';
                sortOrder = 60;
            } else {
                catKey = 'otros';
                catLabel = '📦 Otros / Varios';
                sortOrder = 90;
            }
        }

        if (!categoryMap[catKey]) {
            categoryMap[catKey] = { label: catLabel, sortOrder: sortOrder, sales: {} };
        }

        const catGroup = categoryMap[catKey].sales;
        if (!catGroup[cleanName]) {
            catGroup[cleanName] = { count: 0, unitPrice: sale.price || 0, total: 0 };
        }
        catGroup[cleanName].count++;
        catGroup[cleanName].total += sale.price || 0;
    });

    const totalItemsSold = reportSales.filter(s => s.productId !== 'abono').length;

    let message = `📋 *CIERRE DE JORNADA - CASA LUCENZO*\n`;
    message += `📅 Fecha: ${dateLabel}\n`;
    message += `💱 Tasa BCV: ${rate.toFixed(2)} Bs.\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🛒 *VENTAS DEL DÍA* (${totalItemsSold} unidades)\n\n`;

    const sortedCategories = Object.values(categoryMap).sort((a, b) => a.sortOrder - b.sortOrder);

    for (const catData of sortedCategories) {
        const items = Object.entries(catData.sales);
        if (items.length > 0) {
            message += `*${catData.label.toUpperCase()}*\n`;
            for (const [name, data] of items) {
                message += `  • ${data.count}x ${name}\n`;
                message += `    $${data.unitPrice.toFixed(2)} c/u → *$${data.total.toFixed(2)}* (Bs. ${(data.total * rate).toFixed(2)})\n`;
            }
            message += `\n`;
        }
    }
    if (totalItemsSold === 0) {
        message += `  Sin ventas registradas.\n`;
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🏪 *GASTOS DEL LOCAL* (${reportExpenses.length})\n\n`;
    reportExpenses.forEach(exp => {
        message += `  • ${exp.description}: -$${exp.amount.toFixed(2)} (Bs. ${(exp.amount * rate).toFixed(2)})\n`;
    });
    if (reportExpenses.length === 0) {
        message += `  Sin gastos registrados.\n`;
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📊 *RESUMEN FINANCIERO*\n\n`;
    message += `  💰 Ventas:  +$${totalSales.toFixed(2)} (Bs. ${(totalSales * rate).toFixed(2)})\n`;
    message += `  💸 Gastos:  -$${totalExpenses.toFixed(2)} (Bs. ${(totalExpenses * rate).toFixed(2)})\n`;
    message += `  ─────────────────\n`;
    message += `  💵 *CAJA NETA: $${netCash.toFixed(2)}*\n`;
    message += `     _(Bs. ${(netCash * rate).toFixed(2)})_\n`;
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📢 _Cierre generado automáticamente._\n`;
    message += `_¡Casa Lucenzo!_ 🌟`;

    return message;
}

/**
 * Open report history modal and load days from Supabase
 */
async function openReportHistoryModal() {
    triggerHaptic(15);
    const modal = document.getElementById('report-history-modal');
    const body = document.getElementById('report-history-modal-body');
    modal.classList.remove('hidden');

    // Show loading
    body.innerHTML = `
        <div style="text-align: center; padding: 2rem 0; color: var(--color-text-muted); font-size: 0.8125rem;">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>
            Cargando historial...
        </div>
    `;

    if (!window.SupabaseManager.isConfigured()) {
        body.innerHTML = `
            <div style="text-align: center; padding: 2rem 0; color: var(--color-text-muted); font-size: 0.8125rem;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: var(--color-gold);"></i>
                Configura Supabase para acceder al historial de reportes.
            </div>
        `;
        return;
    }

    const days = await window.SupabaseManager.fetchReportDays(14);

    if (!days || days.length === 0) {
        body.innerHTML = `
            <div style="text-align: center; padding: 2rem 0; color: var(--color-text-muted); font-size: 0.8125rem;">
                <i class="fa-solid fa-inbox" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: var(--color-text-muted);"></i>
                No se encontraron reportes recientes.
            </div>
        `;
        return;
    }

    // Day name helper
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    let html = '';
    days.forEach(dateStr => {
        const d = new Date(dateStr + 'T12:00:00');
        const dayName = dayNames[d.getDay()];
        const displayDate = d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
        const today = new Date().toISOString().split('T')[0];
        const isToday = dateStr === today;
        const badge = isToday ? '<span style="font-size: 9px; background: var(--color-gold); color: #000; padding: 1px 6px; border-radius: 4px; font-weight: 800; margin-left: 0.35rem;">HOY</span>' : '';

        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--radius-md); margin-bottom: 0.5rem;">
                <div>
                    <div style="font-size: 0.8125rem; font-weight: 700; color: var(--color-white);">${dayName} ${badge}</div>
                    <div style="font-size: 0.6875rem; color: var(--color-text-muted);">${displayDate}</div>
                </div>
                <div style="display: flex; gap: 0.375rem;">
                    <button class="btn-report-view" data-date="${dateStr}" style="height: 34px; padding: 0 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-gold); background: transparent; color: var(--color-gold); font-weight: 700; font-size: 0.6875rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fa-solid fa-eye" style="font-size: 10px;"></i> Ver
                    </button>
                    <button class="btn-report-whatsapp" data-date="${dateStr}" data-label="${dayName} ${displayDate}" style="height: 34px; padding: 0 0.75rem; border-radius: var(--radius-md); border: none; background: var(--color-success); color: #fff; font-weight: 700; font-size: 0.6875rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fa-brands fa-whatsapp" style="font-size: 12px;"></i> Enviar
                    </button>
                </div>
            </div>
        `;
    });

    function formatReportDateStr(dateStr) {
        if (!dateStr) return new Date().toLocaleDateString();
        if (dateStr.includes('/')) return dateStr;
        const parts = dateStr.split('T')[0].split('-');
        if (parts.length === 3) {
            return `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`;
        }
        return dateStr;
    }

    body.innerHTML = html;

    // Bind view buttons
    body.querySelectorAll('.btn-report-view').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const dateStr = e.currentTarget.dataset.date;
            const formattedDate = formatReportDateStr(dateStr);
            triggerHaptic(15);
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            const report = await window.SupabaseManager.fetchDayReport(dateStr);
            if (report) {
                const reportRate = report.bcvRate || report.sales?.find(s => s.bcvRate)?.bcvRate || window.bcvRate || bcvRate;
                currentReportData = { sales: report.sales, expenses: report.expenses, dateLabel: formattedDate, rate: reportRate, isHistory: true };
                modal.classList.add('hidden');
                window.UIManager.renderDayCloseModal(report.sales, report.expenses, products, formattedDate, reportRate);
                document.getElementById('day-close-modal').classList.remove('hidden');
            } else {
                window.UIManager.showToast("❌ No se pudo cargar el reporte.", "fa-solid fa-circle-xmark");
            }
            btn.innerHTML = '<i class="fa-solid fa-eye" style="font-size: 10px;"></i> Ver';
        });
    });

    // Bind WhatsApp buttons
    body.querySelectorAll('.btn-report-whatsapp').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const dateStr = e.currentTarget.dataset.date;
            const formattedDate = formatReportDateStr(dateStr);
            triggerHaptic(15);
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            const report = await window.SupabaseManager.fetchDayReport(dateStr);
            if (report) {
                const reportRate = report.bcvRate || report.sales?.find(s => s.bcvRate)?.bcvRate || window.bcvRate || bcvRate;
                const message = generateWhatsAppReport(report.sales, report.expenses, formattedDate, reportRate, products);
                const encodedMessage = encodeURIComponent(message);
                window.open(`https://api.whatsapp.com/send?text=${encodedMessage}`, '_blank');
            } else {
                window.UIManager.showToast("❌ No se pudo cargar el reporte.", "fa-solid fa-circle-xmark");
            }
            btn.innerHTML = '<i class="fa-brands fa-whatsapp" style="font-size: 12px;"></i> Enviar';
        });
    });
}

/**
 * Clear daily sales and expenses logs locally and sync to Supabase, and refill vitrina stock to max for tomorrow
 */
async function closeDayAndResetLogs() {
    try {
        window.UIManager.showToast("⏳ Cerrando jornada y preparando vitrina...", "fa-solid fa-hourglass-start");
        
        const nowStr = new Date().toISOString();
        window.StorageManager.saveLastCloseTime(nowStr);

        // 1. Sync close time to Supabase or delete active sales if old DB schema
        if (window.SupabaseManager.isConfigured()) {
            if (window.SupabaseManager.getDbSupportsLastClose()) {
                console.log("Saving last day close timestamp to Supabase app_config...");
                await window.SupabaseManager.upsertAppConfig({ lastCloseTime: nowStr });
            } else {
                console.log("Database does not support last_close_time. Clearing daily sales and expenses from Supabase as fallback...");
                await window.SupabaseManager.deleteSales(salesLog.map(s => s.uuid));
                await window.SupabaseManager.deleteExpenses(expenses.map(e => e.uuid));
            }
        }

        // 2. Clear local arrays
        salesLog = [];
        expenses = [];

        // 3. Clear local storage logs
        window.StorageManager.clearSalesLog();
        window.StorageManager.clearExpenses();

        // 4. Reset showcase products' stock, keeping max capacity completely untouched and updating initial_stock
        products.forEach(p => {
            if (p.category !== 'bebidas') {
                p.stock = 0;
                p.initial_stock = 0;
                if (window.SupabaseManager.isConfigured()) {
                    window.SupabaseManager.updateProductStock(p.id, 0, p.max, 0);
                }
            } else {
                p.initial_stock = p.stock || 0;
                if (window.SupabaseManager.isConfigured()) {
                    window.SupabaseManager.updateProductStock(p.id, p.stock, p.max, p.initial_stock);
                }
            }
        });
        window.StorageManager.saveProducts(products);

        // 5. Re-render UI
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
        window.UIManager.renderExpenses(expenses, deleteExpense);
        
        if (currentRole === 'admin') {
            loadAndRenderAdminStats();
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

    const newProd = { id, name, stock: max, min, max, unit, price, category, initial_stock: max };
    products.push(newProd);
    window.StorageManager.saveProducts(products);

    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.upsertProduct(newProd);
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
    } else {
        lastCloseTime = window.StorageManager.loadLastCloseTime();
    }

    // 2. Fetch all other datasets in parallel to reduce network latency and roundtrips
    const [supProducts, supSales, supExpenses, supDebts, supRepls, supIng] = await Promise.all([
        window.SupabaseManager.fetchProducts(),
        window.SupabaseManager.fetchSales(),
        window.SupabaseManager.fetchExpenses(),
        window.SupabaseManager.fetchDebts(),
        window.SupabaseManager.fetchReplenishments(),
        window.SupabaseManager.fetchIngredients()
    ]);

    // Save and load products
    if (supProducts && supProducts.length > 0) {
        products = supProducts;
        window.StorageManager.saveProducts(products);
    } else {
        products = window.StorageManager.loadProducts();
    }
    
    // Save and load sales (merge local sales if any were saved offline or during schema mismatch)
    const localSales = window.StorageManager.loadSalesLog() || [];
    if (supSales && supSales.length > 0) {
        const supUuids = new Set(supSales.map(s => s.uuid));
        const missingLocal = localSales.filter(s => s.uuid && !supUuids.has(s.uuid));
        salesLog = [...supSales, ...missingLocal];
        if (missingLocal.length > 0) {
            console.log(`Restored ${missingLocal.length} local sales to Supabase.`);
            window.SupabaseManager.insertSales(missingLocal);
        }
        window.StorageManager.saveSalesLog(salesLog);
    } else if (localSales.length > 0) {
        salesLog = localSales;
    } else {
        salesLog = supSales || [];
    }

    // Clean any temporary auto-injected test sales from salesLog
    salesLog = salesLog.filter(s => !s.uuid || !s.uuid.startsWith('chica_'));
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

    // Save and load replenishments
    if (supRepls) {
        replenishments = supRepls;
        window.StorageManager.saveReplenishments(replenishments);
    } else {
        replenishments = window.StorageManager.loadReplenishments();
    }

    // Save and load raw ingredients
    if (supIng && supIng.length > 0) {
        ingredients = supIng;
        window.StorageManager.saveIngredients(ingredients);
    } else {
        ingredients = window.StorageManager.loadIngredients();
    }

    // Auto-heal showcase products stock if stock was accidentally reset to 0 but showcase capacity exists
    const showcaseProducts = products.filter(p => p.category !== 'bebidas');
    const totalShowcaseStock = showcaseProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
    if (showcaseProducts.length > 0 && totalShowcaseStock === 0) {
        console.log("Healing showcase stock from salesLog...");
        showcaseProducts.forEach(p => {
            const soldToday = salesLog.filter(s => s.productId === p.id).length;
            const maxCap = (p.max && p.max > 0) ? p.max : 10;
            p.initial_stock = (p.initial_stock && p.initial_stock > 0) ? p.initial_stock : maxCap;
            p.stock = Math.max(0, p.initial_stock - soldToday);
            if (window.SupabaseManager.isConfigured()) {
                window.SupabaseManager.updateProductStock(p.id, p.stock, p.max, p.initial_stock);
            }
        });
        window.StorageManager.saveProducts(products);
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
    


    // Load last close time from localStorage
    lastCloseTime = window.StorageManager.loadLastCloseTime();

    renderAllViews();
}

async function loadAndRenderAdminStats() {
    if (currentRole !== 'admin') return;
    
    let statsSales = salesLog;
    let statsExpenses = expenses;
    let devCount = 1;
    
    if (window.SupabaseManager.isConfigured() && navigator.onLine) {
        try {
            const data = await window.SupabaseManager.fetchStatsData();
            if (data) {
                statsSales = data.sales;
                statsExpenses = data.expenses;
            }
            const sessions = await window.SupabaseManager.fetchActiveSessions();
            devCount = sessions ? sessions.length : 0;
        } catch(e) {
            console.error("Failed to load historical stats from Supabase", e);
        }
    }
    
    const devKpi = document.getElementById('admin-kpi-devices');
    if (devKpi) devKpi.textContent = devCount;

    // Cache statsSales globally for toggle rendering
    adminStatsSales = statsSales;

    window.UIManager.renderStats(statsSales, statsExpenses, products);
    window.UIManager.renderHourlyStats(adminStatsSales, hourlyActiveMode);
    window.UIManager.renderCriticalStockAlerts(products, handleQuickReplenishment);
    window.UIManager.renderPaymentAndCategoryStats(statsSales, products, paymentStatsFilter, categoryStatsFilter);
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
        loadAndRenderAdminStats();
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
        window.UIManager.renderCocina(products, deliverProduct, replenishments);
        window.UIManager.updateKitchenBadge(products);
        window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
        if (currentRole === 'admin') {
            window.UIManager.renderCriticalStockAlerts(products, handleQuickReplenishment);
        }
    } else if (tableName === 'sales') {
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);
        const filterTime = lastCloseTime ? window.parseUTCTimestamp(lastCloseTime) : startOfDay;

        if (eventType === 'DELETE') {
            salesLog = salesLog.filter(s => s.uuid !== oldRow.uuid);
        } else {
            const saleDate = window.parseUTCTimestamp(newRow.timestamp);
            if (saleDate > filterTime) {
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
        window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);
        if (currentRole === 'admin') {
            if (eventType === 'INSERT') {
                const statFormatted = {
                    productId: newRow.product_id,
                    price: parseFloat(newRow.price) || 0,
                    timestamp: newRow.timestamp
                };
                if (!adminStatsSales.some(s => s.timestamp === statFormatted.timestamp && s.productId === statFormatted.productId)) {
                    adminStatsSales.push(statFormatted);
                }
            } else if (eventType === 'DELETE') {
                adminStatsSales = adminStatsSales.filter(s => s.timestamp !== oldRow.timestamp);
            }
            window.UIManager.renderStats(adminStatsSales, expenses, products);
            window.UIManager.renderHourlyStats(adminStatsSales, hourlyActiveMode);
            window.UIManager.renderPaymentAndCategoryStats(adminStatsSales, products, paymentStatsFilter, categoryStatsFilter);
        }
    } else if (tableName === 'expenses') {
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);
        const filterTime = lastCloseTime ? window.parseUTCTimestamp(lastCloseTime) : startOfDay;

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
            window.UIManager.renderStats(salesLog, expenses, products);
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
            // Check if last_close_time changed
            if (newRow.last_close_time && newRow.last_close_time !== lastCloseTime) {
                console.log("Detecting Day Close event from another device. Reloading data...");
                lastCloseTime = newRow.last_close_time;
                window.StorageManager.saveLastCloseTime(lastCloseTime);
                loadAllDataFromSupabase();
                return;
            }

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
    } else if (tableName === 'active_sessions') {
        const { eventType, new: newRow, old: oldRow } = payload;
        const targetId = eventType === 'DELETE' ? oldRow.device_id : newRow.device_id;
        
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

        // Also update the active devices KPI card in real-time
        if (window.SupabaseManager.isConfigured() && navigator.onLine) {
            window.SupabaseManager.fetchActiveSessions().then(sessions => {
                const devKpi = document.getElementById('admin-kpi-devices');
                if (devKpi) devKpi.textContent = sessions ? sessions.length : 0;
            }).catch(err => console.error("Error fetching sessions in realtime update:", err));
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

/**
 * Helper to log role activity both to Supabase and locally
 * @param {string} action Action description
 * @param {string} details Extra info details
 */
function logActivity(action, details) {
    const role = currentRole || 'local';
    if (window.SupabaseManager.isConfigured()) {
        window.SupabaseManager.insertActivityLog(role, action, details);
    } else {
        // Just save locally
        try {
            const localLogs = JSON.parse(localStorage.getItem('casa_lucenzo_local_activity_logs') || '[]');
            localLogs.push({
                role: role,
                action: action,
                details: details || '',
                timestamp: new Date().toISOString()
            });
            if (localLogs.length > 100) localLogs.shift();
            localStorage.setItem('casa_lucenzo_local_activity_logs', JSON.stringify(localLogs));
        } catch(e) {
            console.error("Local log failed", e);
        }
    }
}

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
 * Updates the UI lockout banner during penalty block
 */
function updateLockoutUI() {
    const banner = document.getElementById('pin-lockout-banner');
    if (!banner) return;

    const now = Date.now();
    if (now < lockoutUntil) {
        const remainingSec = Math.ceil((lockoutUntil - now) / 1000);
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

/**
 * Validates PIN input codes and applies corresponding role UI layout
 * @param {string} pin 4 to 8-digit code
 * @param {boolean} isFinalSubmit Whether this is a full submission (Enter key or max length)
 * @returns {boolean} True if PIN matched a role
 */
function handlePINInput(pin, isFinalSubmit = false) {
    const now = Date.now();
    if (now < lockoutUntil) {
        const remainingSec = Math.ceil((lockoutUntil - now) / 1000);
        triggerHaptic([80, 80]);
        window.UIManager.showToast(`⛔ Sistema bloqueado por seguridad. Espera ${remainingSec}s.`, "fa-solid fa-ban");
        updateLockoutUI();
        return false;
    }

    if (pin === pinLocal) {
        failedPinAttempts = 0;
        applyUserRole('local');
        window.UIManager.showToast("🔓 Acceso Local Concedido (Venta).", "fa-solid fa-shop");
        logActivity("Inicio de Sesión", "Ingreso al perfil Local (Ventas)");
        return true;
    } else if (pin === pinCocina) {
        failedPinAttempts = 0;
        applyUserRole('cocina');
        window.UIManager.showToast("🔓 Acceso Cocina Concedido (Producción).", "fa-solid fa-fire-burner");
        logActivity("Inicio de Sesión", "Ingreso al perfil Cocina");
        return true;
    } else if (pin === pinAdmin) {
        failedPinAttempts = 0;
        applyUserRole('admin');
        window.UIManager.showToast("🔓 Acceso Administrador Concedido.", "fa-solid fa-user-shield");
        logActivity("Inicio de Sesión", "Ingreso al perfil Administrador");
        return true;
    } else {
        // Only count as a failed attempt if this is a final submission or reached 8 digits
        if (isFinalSubmit || pin.length >= 8) {
            failedPinAttempts++;
            triggerHaptic([80, 80]); // Double haptic feedback on error
            
            if (failedPinAttempts >= 3) {
                lockoutUntil = Date.now() + 60000; // 60s lockout penalty
                failedPinAttempts = 0;
                window.UIManager.showToast("⛔ 3 intentos fallidos. Sistema bloqueado por 60 segundos.", "fa-solid fa-triangle-exclamation");
                logActivity("Seguridad Alerta", "Bloqueo de 60s activado por 3 intentos fallidos de PIN");
                
                updateLockoutUI();
                if (lockoutCountdownInterval) clearInterval(lockoutCountdownInterval);
                lockoutCountdownInterval = setInterval(updateLockoutUI, 1000);
            } else {
                const remaining = 3 - failedPinAttempts;
                window.UIManager.showToast(`❌ PIN incorrecto (${remaining} intento${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}).`, "fa-solid fa-circle-xmark");
            }
        }
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
    document.getElementById('btn-cocina').classList.remove('hidden');
    document.getElementById('btn-fiados').classList.remove('hidden');
    document.getElementById('btn-cambio').classList.remove('hidden');
    navBar.classList.remove('hidden');
    btnSettings.classList.remove('hidden');
    
    // Hide administrative actions inside sections if local
    const undoSales = document.getElementById('sales-history-section');
    const clearSales = document.getElementById('btn-clear-sales');
    const dayCloseSec = document.getElementById('day-close-trigger-section');

    if (undoSales) undoSales.classList.add('hidden');
    if (clearSales) clearSales.classList.remove('hidden');
    if (dayCloseSec) dayCloseSec.classList.remove('hidden');

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
        const fiadosSpan = document.querySelector('#btn-fiados .nav-label');
        const cambioSpan = document.querySelector('#btn-cambio .nav-label');
        if (localSpan) localSpan.textContent = '1. LOCAL';
        if (clientesSpan) clientesSpan.textContent = '2. CLIENTES';
        if (fiadosSpan) fiadosSpan.textContent = '3. CRÉDITOS';
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
        if (undoSales) undoSales.classList.remove('hidden');
        if (adminTab) adminTab.classList.remove('hidden');
        
        // Dynamic numbering for admin role
        const adminSpan = document.querySelector('#btn-admin-dashboard .nav-label');
        const localSpan = document.querySelector('#btn-local .nav-label');
        const clientesSpan = document.querySelector('#btn-clientes .nav-label');
        const cocinaSpan = document.querySelector('#btn-cocina .nav-label');
        const fiadosSpan = document.querySelector('#btn-fiados .nav-label');
        const cambioSpan = document.querySelector('#btn-cambio .nav-label');
        if (adminSpan) adminSpan.textContent = '1. CONTROL';
        if (localSpan) localSpan.textContent = '2. VITRINA';
        if (clientesSpan) clientesSpan.textContent = '3. CLIENTES';
        if (cocinaSpan) cocinaSpan.textContent = '4. COCINA';
        if (fiadosSpan) fiadosSpan.textContent = '5. CRÉDITOS';
        if (cambioSpan) cambioSpan.textContent = '6. CAMBIO';

        window.UIManager.switchView('admin-dashboard');
        loadAndRenderAdminStats();
        loadAndRenderActiveDevices();
    }

    // Refresh active session on Supabase
    refreshMySession();
}

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

    window.UIManager.initPinKeypad(handlePINInput);
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
    if (window.SupabaseManager.isConfigured() && navigator.onLine) {
        await window.SupabaseManager.registerSession(myDeviceId, getDeviceName(), currentRole || 'local');
    }
}

/**
 * Fetch and render all active connected devices in the admin settings modal
 */
async function loadAndRenderActiveDevices() {
    if (currentRole !== 'admin') return;
    if (window.SupabaseManager.isConfigured() && navigator.onLine) {
        const sessions = await window.SupabaseManager.fetchActiveSessions();
        window.UIManager.renderActiveDevices(sessions, myDeviceId, handleEjectDevice, handleTrustDevice);
    }
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
        let refreshing = false;
        
        // Listen for controllerchange to trigger automated reload when new sw takes over
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            console.log('Service Worker controller changed, reloading.');
            if (window.UIManager && window.UIManager.showUpdateOverlay) {
                window.UIManager.showUpdateOverlay();
                window.UIManager.updateOverlayStatusSuccess();
            }
            setTimeout(() => {
                window.location.reload();
            }, 1200);
        });

        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('Service Worker Registered with scope:', reg.scope);
                
                // If there's an update already waiting to be activated, trigger it!
                if (reg.waiting) {
                    console.log('New update is waiting in background. Triggering activation.');
                    if (window.UIManager && window.UIManager.showUpdateOverlay) {
                        window.UIManager.showUpdateOverlay();
                        window.UIManager.updateOverlayStatusSuccess();
                    }
                    setTimeout(() => {
                        window.location.reload();
                    }, 1200);
                    return;
                }

                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    if (installingWorker) {
                        // Display full screen update overlay when installing begins
                        if (window.UIManager && window.UIManager.showUpdateOverlay) {
                            window.UIManager.showUpdateOverlay();
                        }
                        
                        installingWorker.onstatechange = () => {
                            if (installingWorker.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    console.log('New update installed, performing auto-reload.');
                                    if (window.UIManager && window.UIManager.updateOverlayStatusSuccess) {
                                        window.UIManager.updateOverlayStatusSuccess();
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
    costInsumos = window.StorageManager.loadCostInsumos();
    
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

    const pinLocalInput = document.getElementById('pref-pin-local');
    const pinCocinaInput = document.getElementById('pref-pin-cocina');
    const pinAdminInput = document.getElementById('pref-pin-admin');
    if (pinLocalInput) pinLocalInput.value = pinLocal;
    if (pinCocinaInput) pinCocinaInput.value = pinCocina;
    if (pinAdminInput) pinAdminInput.value = pinAdmin;

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
        
        // Register active session & heartbeat
        refreshMySession();
        setInterval(refreshMySession, 45000); // 45s heartbeat
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

    // 6. Bind navigation buttons (Dashboard, Vitrina, Clientes, Cocina, Fiados, Cambio)
    const btnAdminDash = document.getElementById('btn-admin-dashboard');
    if (btnAdminDash) {
        btnAdminDash.addEventListener('click', () => {
            window.UIManager.switchView('admin-dashboard');
            loadAndRenderAdminStats();
            loadAndRenderActiveDevices();
        });
    }

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

    // 7. Bind Clientes sub-navigation buttons (Mesas vs Cuentas Activas vs Historial)
    const btnSubMesas = document.getElementById('btn-sub-mesas');
    const btnSubCuentas = document.getElementById('btn-sub-cuentas');
    const btnSubHistorial = document.getElementById('btn-sub-historial');
    const subViewMesas = document.getElementById('sub-view-mesas');
    const subViewCuentas = document.getElementById('sub-view-cuentas');
    const subViewHistorial = document.getElementById('sub-view-historial');

    if (btnSubMesas && btnSubCuentas && btnSubHistorial && subViewMesas && subViewCuentas && subViewHistorial) {
        btnSubMesas.addEventListener('click', () => {
            btnSubMesas.classList.add('active');
            btnSubMesas.classList.remove('inactive');
            btnSubMesas.setAttribute('aria-selected', 'true');
            
            btnSubCuentas.classList.remove('active');
            btnSubCuentas.classList.add('inactive');
            btnSubCuentas.setAttribute('aria-selected', 'false');
            
            btnSubHistorial.classList.remove('active');
            btnSubHistorial.classList.add('inactive');
            btnSubHistorial.setAttribute('aria-selected', 'false');

            subViewMesas.classList.remove('hidden');
            subViewCuentas.classList.add('hidden');
            subViewHistorial.classList.add('hidden');
            triggerHaptic(10);
        });

        btnSubCuentas.addEventListener('click', () => {
            btnSubCuentas.classList.add('active');
            btnSubCuentas.classList.remove('inactive');
            btnSubCuentas.setAttribute('aria-selected', 'true');
            
            btnSubMesas.classList.remove('active');
            btnSubMesas.classList.add('inactive');
            btnSubMesas.setAttribute('aria-selected', 'false');
            
            btnSubHistorial.classList.remove('active');
            btnSubHistorial.classList.add('inactive');
            btnSubHistorial.setAttribute('aria-selected', 'false');

            subViewCuentas.classList.remove('hidden');
            subViewMesas.classList.add('hidden');
            subViewHistorial.classList.add('hidden');
            triggerHaptic(10);
        });

        btnSubHistorial.addEventListener('click', () => {
            btnSubHistorial.classList.add('active');
            btnSubHistorial.classList.remove('inactive');
            btnSubHistorial.setAttribute('aria-selected', 'true');
            
            btnSubMesas.classList.remove('active');
            btnSubMesas.classList.add('inactive');
            btnSubMesas.setAttribute('aria-selected', 'false');
            
            btnSubCuentas.classList.remove('active');
            btnSubCuentas.classList.add('inactive');
            btnSubCuentas.setAttribute('aria-selected', 'false');

            subViewHistorial.classList.remove('hidden');
            subViewMesas.classList.add('hidden');
            subViewCuentas.classList.add('hidden');
            triggerHaptic(10);
        });
    }

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
        if (currentRole === 'admin') {
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
            loadAndRenderAdminStats();
            loadAndRenderActiveDevices();
        }
    });

    const btnSettingsClose = document.getElementById('btn-settings-close');
    if (btnSettingsClose) {
        btnSettingsClose.addEventListener('click', () => {
            window.UIManager.toggleSettingsModal(false);
        });
    }

    const btnSettingsCancel = document.getElementById('btn-settings-cancel');
    if (btnSettingsCancel) {
        btnSettingsCancel.addEventListener('click', () => {
            window.UIManager.switchView('local');
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
        });
    }

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
        // Send WhatsApp using whatever data is currently displayed in the modal
        const dateLabel = currentReportData.dateLabel || new Date().toLocaleDateString();
        const reportRate = currentReportData.rate || window.bcvRate || bcvRate;
        const message = generateWhatsAppReport(currentReportData.sales, currentReportData.expenses, dateLabel, reportRate, products);
        const encodedMessage = encodeURIComponent(message);
        window.open(`https://api.whatsapp.com/send?text=${encodedMessage}`, '_blank');
        
        // Actually perform the day close database and state reset (ONLY if active day close, NOT historical inspection)
        if (!currentReportData.isHistory) {
            await closeDayAndResetLogs();
        }
        
        closeDayCloseModal();
    });
    
    document.getElementById('btn-cierre-dia-pdf').addEventListener('click', () => {
        triggerHaptic(15);
        const dateLabel = currentReportData.dateLabel || new Date().toLocaleDateString();
        const reportRate = currentReportData.rate || window.bcvRate || bcvRate;
        window.UIManager.exportDayCloseToPDF(currentReportData.sales, currentReportData.expenses, products, dateLabel, reportRate);
    });

    // 15b. Bind Report Preview button (opens report modal without closing day)
    document.getElementById('btn-preview-report').addEventListener('click', () => {
        triggerHaptic(15);
        const todayLabel = new Date().toLocaleDateString();
        const currentRate = window.bcvRate || bcvRate;
        currentReportData = { sales: salesLog, expenses: expenses, dateLabel: todayLabel, rate: currentRate, isHistory: false };
        window.UIManager.renderDayCloseModal(salesLog, expenses, products, todayLabel, currentRate);
        document.getElementById('day-close-modal').classList.remove('hidden');
    });

    // 15c. Bind Report History button and modal controls
    document.getElementById('btn-report-history').addEventListener('click', openReportHistoryModal);
    document.getElementById('btn-report-history-close').addEventListener('click', () => {
        triggerHaptic(15);
        document.getElementById('report-history-modal').classList.add('hidden');
    });
    document.getElementById('btn-report-history-done').addEventListener('click', () => {
        triggerHaptic(15);
        document.getElementById('report-history-modal').classList.add('hidden');
    });

    // 16. Bind preference toggle checkboxes and credentials
    document.getElementById('pref-sound').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-vibrate').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-supabase-url').addEventListener('change', handlePreferencesChange);
    document.getElementById('pref-supabase-key').addEventListener('change', handlePreferencesChange);

    // 17. Bind lock icon buttons
    document.getElementById('btn-lock-user').addEventListener('click', lockSession);

    // 17b. Bind logo click to reload page
    const logoContainer = document.querySelector('.logo-container');
    if (logoContainer) {
        logoContainer.style.cursor = 'pointer';
        logoContainer.title = 'Toca el logo para recargar la aplicación';
        logoContainer.addEventListener('click', () => {
            triggerHaptic(15);
            window.location.reload();
        });
    }

    // 18. Bind online/offline, visibility & focus auto-reconnect listeners
    const autoSyncAndReconnect = () => {
        if (window.SupabaseManager.isConfigured() && navigator.onLine) {
            window.UIManager.updateConnectionStatus('online');
            window.SupabaseManager.syncOfflineQueue();
            window.SupabaseManager.subscribeToChanges(handleRealtimeDbUpdate);
            loadAllDataFromSupabase();
        }
    };

    window.addEventListener('online', autoSyncAndReconnect);
    window.addEventListener('offline', () => {
        if (window.SupabaseManager.isConfigured()) {
            window.UIManager.updateConnectionStatus('offline');
        }
    });

    // Auto-refresh data when user switches back to tab or turns screen on
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log("Tab/screen reactivated. Triggering instant background sync...");
            autoSyncAndReconnect();
        }
    });
    window.addEventListener('focus', () => {
        if (document.visibilityState === 'visible') {
            autoSyncAndReconnect();
        }
    });

    // Periodic silent background heartbeat (every 45s) to guarantee zero missing updates
    setInterval(() => {
        if (document.visibilityState === 'visible' && window.SupabaseManager.isConfigured() && navigator.onLine) {
            loadAllDataFromSupabase();
        }
    }, 45000);

    initAdminDashboardListeners();
    initAgentListeners();
});

// Expose functions globally for UI callbacks and fallbacks
window.handleEditSale = handleEditSale;
window.handleUndoSale = handleUndoSale;
window.handleCartQtyChange = handleCartQtyChange;
window.updateProductStockDirect = updateProductStockDirect;

// Dynamically link currentCart to window.currentCart to avoid array reference mismatch
Object.defineProperty(window, 'currentCart', {
    get: () => currentCart,
    set: (val) => { currentCart = val; }
});

function handleDeleteCostInsumo(id) {
    triggerHaptic(15);
    costInsumos = costInsumos.filter(i => i.id !== id);
    window.StorageManager.saveCostInsumos(costInsumos);
    window.UIManager.renderCostCalculator(products, costInsumos, handleDeleteCostInsumo);
    window.UIManager.showToast("🗑️ Insumo eliminado de la calculadora.", "fa-solid fa-trash");
}

/**
 * Initialize listeners for the custom admin widescreen dashboard
 */
function initAdminDashboardListeners() {
    const tabSummaryBtn = document.getElementById('admin-tab-btn-summary');
    const tabProductsBtn = document.getElementById('admin-tab-btn-products');
    const tabDevicesBtn = document.getElementById('admin-tab-btn-devices');
    const tabLogsBtn = document.getElementById('admin-tab-btn-logs');
    const tabCostsBtn = document.getElementById('admin-tab-btn-costs');
    const tabAgentBtn = document.getElementById('admin-tab-btn-agent');
    const tabPreferencesBtn = document.getElementById('admin-tab-btn-preferences');

    const panelSummary = document.getElementById('admin-panel-summary');
    const panelProducts = document.getElementById('admin-panel-products');
    const panelDevices = document.getElementById('admin-panel-devices');
    const panelLogs = document.getElementById('admin-panel-logs');
    const panelCosts = document.getElementById('admin-panel-costs');
    const panelAgent = document.getElementById('admin-panel-agent');
    const panelPreferences = document.getElementById('admin-panel-preferences');

    if (!tabSummaryBtn) return; // Not loaded yet

    const allTabBtns = [tabSummaryBtn, tabProductsBtn, tabDevicesBtn, tabLogsBtn, tabCostsBtn, tabAgentBtn, tabPreferencesBtn].filter(Boolean);
    const allPanels = [panelSummary, panelProducts, panelDevices, panelLogs, panelCosts, panelAgent, panelPreferences].filter(Boolean);

    function activateTab(btn, panel) {
        triggerHaptic(10);
        allTabBtns.forEach(b => b.classList.remove('active'));
        allPanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        panel.classList.add('active');
    }

    tabSummaryBtn.addEventListener('click', () => {
        activateTab(tabSummaryBtn, panelSummary);
        loadAndRenderAdminStats();
    });

    tabProductsBtn.addEventListener('click', () => {
        activateTab(tabProductsBtn, panelProducts);
        window.UIManager.renderSettingsProducts(products, editProductPrompt, deleteProduct);
    });

    tabDevicesBtn.addEventListener('click', () => {
        activateTab(tabDevicesBtn, panelDevices);
        loadAndRenderActiveDevices();
    });

    tabLogsBtn.addEventListener('click', async () => {
        activateTab(tabLogsBtn, panelLogs);
        await refreshActivityLogsView();
    });

    if (tabCostsBtn && panelCosts) {
        tabCostsBtn.addEventListener('click', () => {
            activateTab(tabCostsBtn, panelCosts);
            window.UIManager.renderCostCalculator(products, costInsumos, handleDeleteCostInsumo);
        });
    }

    if (tabAgentBtn && panelAgent) {
        tabAgentBtn.addEventListener('click', () => {
            activateTab(tabAgentBtn, panelAgent);
        });
    }

    tabPreferencesBtn.addEventListener('click', () => {
        activateTab(tabPreferencesBtn, panelPreferences);
    });

    // Form to Add New Cost Insumo
    const formAddInsumo = document.getElementById('form-add-cost-insumo');
    if (formAddInsumo) {
        formAddInsumo.addEventListener('submit', (e) => {
            e.preventDefault();
            triggerHaptic(15);
            const name = document.getElementById('cost-insumo-name').value.trim();
            const type = document.getElementById('cost-insumo-type').value;
            const qty = parseFloat(document.getElementById('cost-insumo-qty').value) || 1;
            const price = parseFloat(document.getElementById('cost-insumo-price').value) || 0;

            if (!name || qty <= 0 || price <= 0) return;

            let unitLabel = 'kg';
            if (type === 'liquid') unitLabel = 'L';
            if (type === 'unit') unitLabel = 'unid.';

            const newInsumo = {
                id: 'ins_' + Math.random().toString(36).substring(2) + Date.now().toString(36),
                name,
                type,
                qty,
                price,
                unit: unitLabel
            };

            costInsumos.push(newInsumo);
            window.StorageManager.saveCostInsumos(costInsumos);
            formAddInsumo.reset();

            window.UIManager.renderCostCalculator(products, costInsumos, handleDeleteCostInsumo);
            window.UIManager.showToast(`📦 Insumo "${name}" registrado correctamente.`, "fa-solid fa-circle-check");
            logActivity("Calculadora Costos", `Nuevo insumo registrado: ${name} ($${price.toFixed(2)} / ${qty}${unitLabel})`);
        });
    }

    const costProdSelect = document.getElementById('cost-calc-product-select');
    const costSellPriceInput = document.getElementById('cost-calc-sell-price');
    if (costProdSelect) {
        costProdSelect.addEventListener('change', () => {
            window.UIManager.renderCostFinancialResults(products, costInsumos);
        });
    }
    if (costSellPriceInput) {
        costSellPriceInput.addEventListener('input', () => {
            window.UIManager.renderCostFinancialResults(products, costInsumos);
        });
    }

    // Bind Payment Methods Day/Week toggle buttons
    const btnPayDay = document.getElementById('btn-stats-payment-day');
    const btnPayWeek = document.getElementById('btn-stats-payment-week');
    if (btnPayDay && btnPayWeek) {
        btnPayDay.addEventListener('click', () => {
            triggerHaptic(10);
            paymentStatsFilter = 'day';
            window.UIManager.renderPaymentAndCategoryStats(adminStatsSales, products, paymentStatsFilter, categoryStatsFilter);
        });
        btnPayWeek.addEventListener('click', () => {
            triggerHaptic(10);
            paymentStatsFilter = 'week';
            window.UIManager.renderPaymentAndCategoryStats(adminStatsSales, products, paymentStatsFilter, categoryStatsFilter);
        });
    }

    // Bind Category Performance Day/Week toggle buttons
    const btnCatDay = document.getElementById('btn-stats-cat-day');
    const btnCatWeek = document.getElementById('btn-stats-cat-week');
    if (btnCatDay && btnCatWeek) {
        btnCatDay.addEventListener('click', () => {
            triggerHaptic(10);
            categoryStatsFilter = 'day';
            window.UIManager.renderPaymentAndCategoryStats(adminStatsSales, products, paymentStatsFilter, categoryStatsFilter);
        });
        btnCatWeek.addEventListener('click', () => {
            triggerHaptic(10);
            categoryStatsFilter = 'week';
            window.UIManager.renderPaymentAndCategoryStats(adminStatsSales, products, paymentStatsFilter, categoryStatsFilter);
        });
    }

    // Refresh logs button
    const refreshLogsBtn = document.getElementById('btn-admin-logs-refresh');
    if (refreshLogsBtn) {
        refreshLogsBtn.addEventListener('click', async () => {
            triggerHaptic(15);
            await refreshActivityLogsView();
        });
    }

    // Security PINs form submission
    const pinesForm = document.getElementById('admin-pines-form');
    if (pinesForm) {
        pinesForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            triggerHaptic(20);
            
            const newLocal = document.getElementById('pref-pin-local').value.trim();
            const newCocina = document.getElementById('pref-pin-cocina').value.trim();
            const newAdmin = document.getElementById('pref-pin-admin').value.trim();

            if (!newLocal || !newCocina || !newAdmin) {
                window.UIManager.showToast("⚠️ Todos los PINes son obligatorios.", "fa-solid fa-triangle-exclamation");
                return;
            }

            pinLocal = newLocal;
            pinCocina = newCocina;
            pinAdmin = newAdmin;

            localStorage.setItem('casa_lucenzo_pin_local', pinLocal);
            localStorage.setItem('casa_lucenzo_pin_cocina', pinCocina);
            localStorage.setItem('casa_lucenzo_pin_admin', pinAdmin);

            if (window.SupabaseManager.isConfigured()) {
                window.UIManager.showToast("⏳ Guardando pines en Supabase...", "fa-solid fa-spinner");
                await window.SupabaseManager.upsertAppConfig({
                    bcvRate: bcvRate,
                    useAutoBcv: useAutoBcv,
                    pinLocal: pinLocal,
                    pinCocina: pinCocina,
                    pinAdmin: pinAdmin
                });
            }

            window.UIManager.showToast("🔒 Pines actualizados correctamente.", "fa-solid fa-lock");
            logActivity("Ajuste Seguridad", `Pines actualizados (Local: ${pinLocal}, Cocina: ${pinCocina}, Admin: ${pinAdmin})`);
        });
    }

    // Live price calculation in Bs.
    const editPriceInput = document.getElementById('edit-prod-price');
    if (editPriceInput) {
        editPriceInput.addEventListener('input', updateEditPriceBsPreview);
    }

    // Steppers (-) and (+) for Stock, Max Vitrina, and Alerta Mínima
    const bindEditStepper = (btnMinusId, btnPlusId, inputId, minVal = 0) => {
        const btnMinus = document.getElementById(btnMinusId);
        const btnPlus = document.getElementById(btnPlusId);
        const inputEl = document.getElementById(inputId);
        if (btnMinus && btnPlus && inputEl) {
            btnMinus.addEventListener('click', () => {
                triggerHaptic(10);
                const current = parseInt(inputEl.value) || 0;
                inputEl.value = Math.max(minVal, current - 1);
            });
            btnPlus.addEventListener('click', () => {
                triggerHaptic(10);
                const current = parseInt(inputEl.value) || 0;
                inputEl.value = current + 1;
            });
        }
    };

    bindEditStepper('btn-edit-stock-minus', 'btn-edit-stock-plus', 'edit-prod-stock', 0);
    bindEditStepper('btn-edit-max-minus', 'btn-edit-max-plus', 'edit-prod-max', 1);
    bindEditStepper('btn-edit-min-minus', 'btn-edit-min-plus', 'edit-prod-min', 0);

    // Edit Product form submission
    const editProductForm = document.getElementById('edit-product-form');
    if (editProductForm) {
        editProductForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            triggerHaptic(20);
            
            const id = document.getElementById('edit-prod-id').value;
            const product = products.find(p => p.id === id);
            if (!product) return;

            const newName = document.getElementById('edit-prod-name').value.trim();
            const newPrice = parseFloat(document.getElementById('edit-prod-price').value) || 0;
            const newCategory = document.getElementById('edit-prod-category').value;
            const stockVal = parseInt(document.getElementById('edit-prod-stock').value) || 0;
            const maxVal = parseInt(document.getElementById('edit-prod-max').value) || 1;
            const minVal = parseInt(document.getElementById('edit-prod-min').value) || 0;

            if (!newName) {
                alert("El nombre no puede estar vacío.");
                return;
            }

            const oldStock = product.stock || 0;
            const oldMax = product.max || 0;
            const stockDiff = stockVal > oldStock ? (stockVal - oldStock) : 0;

            product.name = newName;
            product.price = newPrice;
            product.category = newCategory;
            product.stock = stockVal;
            product.min = minVal;

            if (maxVal !== oldMax && maxVal > 0) {
                product.max = maxVal;
            } else if (stockDiff > 0) {
                product.max = oldMax + stockDiff;
            }

            window.StorageManager.saveProducts(products);

            if (window.SupabaseManager.isConfigured()) {
                window.SupabaseManager.upsertProduct(product);
            }

            // Close modal
            document.getElementById('edit-product-modal').classList.add('hidden');

            window.UIManager.renderSettingsProducts(products, editProductPrompt, deleteProduct);
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.showToast("✏️ Producto editado correctamente.", "fa-solid fa-pen-to-square");
            logActivity("Producto Editado", `Editado: ${product.name} (Stock: ${stockVal}, Max: ${maxVal}, Precio: $${newPrice.toFixed(2)}, Cat: ${newCategory})`);
        });
    }

    const btnEditProductCancel = document.getElementById('btn-edit-product-cancel');
    if (btnEditProductCancel) {
        btnEditProductCancel.addEventListener('click', () => {
            triggerHaptic(10);
            document.getElementById('edit-product-modal').classList.add('hidden');
        });
    }

    const btnEditProductClose = document.getElementById('btn-edit-product-close');
    if (btnEditProductClose) {
        btnEditProductClose.addEventListener('click', () => {
            triggerHaptic(10);
            document.getElementById('edit-product-modal').classList.add('hidden');
        });
    }

    // Hourly stats toggle button listeners
    const btnHourlyToday = document.getElementById('btn-hourly-today');
    const btnHourlyWeekly = document.getElementById('btn-hourly-weekly');
    if (btnHourlyToday && btnHourlyWeekly) {
        btnHourlyToday.addEventListener('click', () => {
            triggerHaptic(10);
            hourlyActiveMode = 'today';
            btnHourlyToday.classList.add('active');
            btnHourlyWeekly.classList.remove('active');
            window.UIManager.renderHourlyStats(adminStatsSales, hourlyActiveMode);
        });

        btnHourlyWeekly.addEventListener('click', () => {
            triggerHaptic(10);
            hourlyActiveMode = 'weekly';
            btnHourlyWeekly.classList.add('active');
            btnHourlyToday.classList.remove('active');
            window.UIManager.renderHourlyStats(adminStatsSales, hourlyActiveMode);
        });

        const btnHourlyPdf = document.getElementById('btn-hourly-pdf');
        if (btnHourlyPdf) {
            btnHourlyPdf.addEventListener('click', () => {
                triggerHaptic(15);
                window.UIManager.exportHourlyStatsToPDF(adminStatsSales, hourlyActiveMode);
            });
        }
    }
}

/**
 * Fetch and render recent audit activity logs in admin logs panel
 */
async function refreshActivityLogsView() {
    if (window.SupabaseManager.isConfigured()) {
        const logs = await window.SupabaseManager.fetchActivityLogs();
        window.UIManager.renderActivityLogs(logs);
    } else {
        const localLogs = JSON.parse(localStorage.getItem('casa_lucenzo_local_activity_logs') || '[]');
        window.UIManager.renderActivityLogs([...localLogs].reverse());
    }
}

/**
 * Initialize event handlers and chat behavior for the AI Agent
 */
function initAgentListeners() {
    const chatForm = document.getElementById('agent-chat-form');
    const chatInput = document.getElementById('agent-chat-input');
    const chatMessages = document.getElementById('agent-chat-messages');
    const prefGeminiKey = document.getElementById('pref-gemini-key');

    if (prefGeminiKey && window.AgentManager) {
        prefGeminiKey.value = window.AgentManager.getGeminiApiKey();
        prefGeminiKey.addEventListener('change', () => {
            window.AgentManager.setGeminiApiKey(prefGeminiKey.value);
            window.UIManager.showToast("🔑 API Key de Gemini guardada correctamente.", "fa-solid fa-key");
        });
    }

    if (!chatForm || !chatInput || !chatMessages) return;

    const handleSendPrompt = async (promptText) => {
        const text = promptText.trim();
        if (!text) return;

        triggerHaptic(10);
        appendAgentMessage('user', text);
        chatInput.value = '';

        const typingEl = appendAgentTyping();

        const context = {
            products: products,
            salesLog: salesLog,
            expenses: expenses,
            bcvRate: bcvRate,
            actions: {
                addExpense: (desc, amount) => {
                    const newExpense = {
                        id: 'exp_' + Math.random().toString(36).substring(2) + Date.now().toString(36),
                        description: desc,
                        amount: amount,
                        date: new Date().toISOString()
                    };
                    expenses.push(newExpense);
                    window.StorageManager.saveExpenses(expenses);
                    if (window.SupabaseManager.isConfigured()) {
                        window.SupabaseManager.insertExpense(newExpense);
                    }
                    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
                    logActivity("Gasto por IA", `Agregado gasto: ${desc} ($${amount})`);
                },
                updateProductPrice: (prodId, newPrice) => {
                    const prod = products.find(p => p.id === prodId);
                    if (prod) {
                        prod.price = newPrice;
                        window.StorageManager.saveProducts(products);
                        if (window.SupabaseManager.isConfigured()) {
                            window.SupabaseManager.upsertProduct(prod);
                        }
                        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
                        logActivity("Precio por IA", `Actualizado precio de ${prod.name} a $${newPrice}`);
                    }
                },
                resetToMax: () => {
                    resetToMax();
                },
                addNewProduct: (prodData) => {
                    const newProd = {
                        id: 'prod_' + Math.random().toString(36).substring(2),
                        name: prodData.name,
                        price: prodData.price,
                        stock: prodData.stock || 15,
                        min: prodData.min || 5,
                        max: prodData.max || 15,
                        unit: prodData.unit || 'unid.',
                        category: prodData.category || 'pastelitos'
                    };
                    products.push(newProd);
                    window.StorageManager.saveProducts(products);
                    if (window.SupabaseManager.isConfigured()) {
                        window.SupabaseManager.upsertProduct(newProd);
                    }
                    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
                    logActivity("Producto por IA", `Creado producto: ${prodData.name} ($${prodData.price})`);
                }
            }
        };

        try {
            const response = await window.AgentManager.processQuery(text, context);
            typingEl.remove();
            appendAgentMessage('agent', response.text);
        } catch (e) {
            console.error("Error processing agent query:", e);
            typingEl.remove();
            appendAgentMessage('agent', "❌ Lo siento, ocurrió un error al procesar tu solicitud.");
        }
    };

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSendPrompt(chatInput.value);
    });

    document.querySelectorAll('.agent-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            if (prompt) {
                handleSendPrompt(prompt);
            }
        });
    });
}

function appendAgentMessage(sender, text) {
    const chatMessages = document.getElementById('agent-chat-messages');
    if (!chatMessages) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `agent-msg ${sender}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'agent-msg-bubble';
    
    let formatted = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/_(.*?)_/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');

    bubbleDiv.innerHTML = formatted;
    msgDiv.appendChild(bubbleDiv);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendAgentTyping() {
    const chatMessages = document.getElementById('agent-chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'agent-msg agent';

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'agent-msg-bubble';
    bubbleDiv.innerHTML = `<em>🤖 Pensando...</em>`;
    msgDiv.appendChild(bubbleDiv);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgDiv;
}


