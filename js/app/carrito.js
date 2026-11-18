// Carrito de la caja: combos, comida del personal, delivery, extras, cantidades y cobro.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Adds one combo to the active cart: one line per pastel flavor at its fixed
 * price of the day plus the drink at the combo's price, each tagged with the
 * combo so the cart keeps them apart from loose items. Stock is taken from
 * every product, the same way a loose sale does.
 * @param {string} comboId Combos.COMBOS[].id
 * @param {string[]} flavorIds One pastelito product id per pastel in the combo
 */
function addComboToCart(comboId, flavorIds) {
    const combo = Combos && Combos.COMBOS.find(c => c.id === comboId);
    if (!combo) return;
    const drink = Combos.findDrink(combo, products);
    if (!drink) {
        window.UIManager.showToast(`⚠️ No encuentro "${combo.drink}" en los productos. Revisa el nombre en Configuración.`, "fa-solid fa-triangle-exclamation");
        return;
    }
    if (!(bcvRate > 0)) {
        window.UIManager.showToast("⚠️ Falta la tasa BCV del día para cobrar el combo en Bs.", "fa-solid fa-triangle-exclamation");
        return;
    }
    const pasteles = flavorIds.map(id => products.find(p => p.id === id)).filter(Boolean);
    if (pasteles.length !== combo.pasteles) return;

    triggerHaptic(15);
    // Inside a combo the pastel takes the weekday promo; loose ones never do.
    const lines = pasteles.map(p => ({ product: p, price: bsToUsd(Combos.comboPastelBsPrice(p, undefined, combo), bcvRate) || saleUsdPrice(p, bcvRate) }));
    lines.push({ product: drink, price: bsToUsd(combo.drinkBs, bcvRate) });

    lines.forEach(({ product, price }) => {
        const key = `${product.id}|${combo.id}`;
        const cartItem = currentCart.find(item => cartKeyOf(item) === key);
        if (cartItem) {
            cartItem.quantity++;
        } else {
            currentCart.push({
                productId: product.id,
                name: `${product.name} · ${combo.name}`,
                price,
                quantity: 1,
                combo: combo.id
            });
        }
        const before = product.stock;
        product.stock = product.stock - 1;
        recordStockMovement(product, product.stock - before, 'sale');
        warnIfOversold(product);
    });
    window.StorageManager.saveProducts(products);
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));

    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.showToast(`🥟 ${combo.name} agregado a la cuenta.`, "fa-solid fa-circle-check");
}
window.addComboToCart = addComboToCart;

/**
 * Adds one pastel for the staff to the active cart, at cost with no IVA (see
 * Combos.staffBsPrice). It keeps its own cart line ("Pollo · Consumo
 * personal", combo 'personal') so it never merges with a regular sale, and
 * takes stock like any other sale so the vitrina and the cierre still add up.
 * @param {string} productId Pastelito product id
 */
function addStaffMealToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || !Combos) return;
    const bs = Combos.staffBsPrice(product);
    if (!(bs > 0)) {
        window.UIManager.showToast(`⚠️ "${product.name}" no tiene costo cargado. Ponlo en Editar producto → Costo Bs.`, "fa-solid fa-triangle-exclamation");
        return;
    }
    if (!(bcvRate > 0)) {
        window.UIManager.showToast("⚠️ Falta la tasa BCV del día para cobrar en Bs.", "fa-solid fa-triangle-exclamation");
        return;
    }

    triggerHaptic(15);
    const key = `${product.id}|personal`;
    const cartItem = currentCart.find(item => cartKeyOf(item) === key);
    if (cartItem) {
        cartItem.quantity++;
    } else {
        currentCart.push({
            productId: product.id,
            name: `${product.name} · ${Combos.STAFF.label}`,
            price: bsToUsd(bs, bcvRate),
            quantity: 1,
            combo: 'personal'
        });
    }
    const before = product.stock;
    product.stock = product.stock - 1;
    recordStockMovement(product, product.stock - before, 'sale');
    warnIfOversold(product);
    window.StorageManager.saveProducts(products);
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));

    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.showToast(`👥 ${product.name} para el personal: Bs ${bs.toLocaleString('es-VE')}.`, "fa-solid fa-circle-check");
}
window.addStaffMealToCart = addStaffMealToCart;

/**
 * Pone (o cambia, o quita con 0) el cargo de delivery de la cuenta activa:
 * una sola línea con el monto en $ que cobra el motorizado. No es un producto
 * (no toca la vitrina ni products.price) y va fuera de IVA y de la factura
 * talonario (ver Combos.DELIVERY).
 * @param {number} usd Monto en dólares; 0 lo quita
 */
function setCartDelivery(usd) {
    if (!Combos) return;
    const D = Combos.DELIVERY;
    const amount = Math.round((parseFloat(usd) || 0) * 100) / 100;
    const idx = currentCart.findIndex(item => Combos.isDeliverySale(item));
    if (!(amount > 0)) {
        if (idx !== -1) currentCart.splice(idx, 1);
    } else if (amount > D.maxUsd) {
        window.UIManager.showToast(`⚠️ El delivery no puede pasar de $${D.maxUsd}.`, "fa-solid fa-triangle-exclamation");
        return;
    } else if (idx !== -1) {
        currentCart[idx].price = amount;
        currentCart[idx].quantity = 1;
    } else {
        currentCart.push({ productId: D.productId, name: D.name, price: amount, quantity: 1, combo: 'delivery' });
    }
    triggerHaptic(15);
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.showToast(amount > 0
        ? `🛵 Delivery $${amount.toFixed(2)} agregado (fuera de IVA).`
        : "🛵 Delivery quitado de la cuenta.", "fa-solid fa-motorcycle");
}
window.setCartDelivery = setCartDelivery;

/**
 * Agrega a la cuenta activa un producto extra: algo que no está en el sistema
 * (un jugo o una bebida comprada en el local de al lado). Lleva el nombre y
 * el precio que pone la caja; es venta del local con IVA incluido y va en la
 * factura talonario. No toca la vitrina, el stock ni products.price (ver
 * Combos.EXTRA). Si ya hay una línea con el mismo nombre y precio, suma.
 * @param {{name: string, unitUsd: number, qty: number, costBs?: number}} extra
 */
function addCartExtra({ name, unitUsd, qty, costBs = 0 }) {
    if (!Combos) return false;
    const E = Combos.EXTRA;
    const cleanName = Combos.cleanExtraName(name);
    const price = Math.round((parseFloat(unitUsd) || 0) * 1e6) / 1e6;
    const quantity = Math.floor(parseFloat(qty) || 0);
    const cost = Math.round((parseFloat(costBs) || 0) * 100) / 100;
    if (!cleanName) {
        window.UIManager.showToast("⚠️ Escriba el nombre del producto.", "fa-solid fa-triangle-exclamation");
        return false;
    }
    if (!(price > 0) || price > E.maxUsd) {
        window.UIManager.showToast(`⚠️ Revise el precio (hasta $${E.maxUsd} por unidad).`, "fa-solid fa-triangle-exclamation");
        return false;
    }
    if (!(quantity >= 1) || quantity > E.maxQty) {
        window.UIManager.showToast(`⚠️ La cantidad va de 1 a ${E.maxQty}.`, "fa-solid fa-triangle-exclamation");
        return false;
    }
    const same = currentCart.find(item => Combos.isExtraSale(item) && item.name === cleanName && Math.abs(item.price - price) < 1e-6 && (item.costBs || 0) === cost);
    if (same) {
        same.quantity = Math.min(E.maxQty, same.quantity + quantity);
    } else {
        currentCart.push({
            productId: E.productId,
            name: cleanName,
            price,
            quantity,
            costBs: cost,
            combo: `extra-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        });
    }
    triggerHaptic(15);
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.showToast(`🛍️ ${quantity} × ${cleanName} agregado a la cuenta.`, "fa-solid fa-bag-shopping");
    return true;
}
window.addCartExtra = addCartExtra;

/**
 * Heads-up when a sale leaves the vitrina below zero. The sale itself still
 * goes through; the negative count is what tells the cashier a recount is due.
 * @param {Object} product Product just sold
 */
function warnIfOversold(product) {
    if (product.stock >= 0) return;
    window.UIManager.showToast(`⚠️ "${product.name}" quedó en ${product.stock}. Se vendió igual; corrige la vitrina cuando puedas.`, "fa-solid fa-triangle-exclamation");
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
        // Adding 1 to cart / selling. An empty (or negative) vitrina no longer
        // blocks the sale: the count on screen can lag the shelf, and refusing
        // a real sale is worse than a negative number to fix with a recount.
        // Spawn floating number indicator on tap coordinates
        if (event && event.clientX !== undefined) {
            window.UIManager.spawnFloatingIndicator(event.clientX, event.clientY, `-1`, 'float-minus');
        }

        triggerHaptic(15);

        // Add to active cart
        const cartItem = currentCart.find(item => item.productId === id && !item.combo);
        if (cartItem) {
            cartItem.quantity++;
        } else {
            currentCart.push({
                productId: product.id,
                name: product.name,
                price: saleUsdPrice(product, bcvRate),
                quantity: 1
            });
        }
        localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));

        const originalStock = product.stock;
        product.stock = product.stock - 1;
        window.StorageManager.saveProducts(products);

        recordStockMovement(product, product.stock - originalStock, 'sale');
        warnIfOversold(product);

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
        if (window.InventoryManager && window.InventoryManager.updateLowStockUI) {
            window.InventoryManager.updateLowStockUI(products, ingredients, currentRole);
        }
    } else if (amount === 1) {
        // Restocking vitrina (standard + button)
        if (event && event.clientX !== undefined) {
            window.UIManager.spawnFloatingIndicator(event.clientX, event.clientY, `+1`, 'float-plus');
        }

        triggerHaptic(15);

        const beforeLoad = product.stock;
        applyStockLoad(product, 1);
        window.StorageManager.saveProducts(products);

        recordStockMovement(product, product.stock - beforeLoad, 'load');

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

    const cartItem = currentCart.find(item => item.productId === id && !item.combo);
    const q_old = cartItem ? cartItem.quantity : 0;
    
    if (newQty < 0 || isNaN(newQty)) {
        newQty = 0;
    }

    const diff = newQty - q_old;
    if (diff === 0) return; // No change

    triggerHaptic(15);

    const originalStock = product.stock;
    product.stock = product.stock - diff;
    window.StorageManager.saveProducts(products);

    recordStockMovement(product, product.stock - originalStock, diff > 0 ? 'sale' : 'sale_return');
    if (diff > 0) warnIfOversold(product);

    // Update cart items array
    if (newQty === 0) {
        const cartItemIndex = currentCart.findIndex(item => item.productId === id && !item.combo);
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
                price: saleUsdPrice(product, bcvRate),
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
    // The quick-access bar hands over the product itself.
    if (productId && typeof productId === 'object') productId = productId.id;
    // Producto extra: "+" suma uno a esa línea (no hay vitrina que descontar).
    if (Combos && String(productId).startsWith(`${Combos.EXTRA.productId}|`)) {
        const line = currentCart.find(item => cartKeyOf(item) === productId);
        if (!line || line.quantity >= Combos.EXTRA.maxQty) return;
        triggerHaptic(15);
        line.quantity++;
        localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));
        window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
        return;
    }
    // "+" is hidden on combo lines; another combo goes through the combo picker.
    if (String(productId).includes('|')) return;
    const product = products.find(p => p.id === productId);
    if (!product) return;

    triggerHaptic(15);

    const cartItem = currentCart.find(item => item.productId === productId && !item.combo);
    if (cartItem) {
        cartItem.quantity++;
    } else {
        currentCart.push({
            productId: product.id,
            name: product.name,
            price: saleUsdPrice(product, bcvRate),
            quantity: 1
        });
    }
    localStorage.setItem('casa_lucenzo_current_cart', JSON.stringify(currentCart));

    const beforeAdd = product.stock;
    product.stock = product.stock - 1;
    window.StorageManager.saveProducts(products);

    recordStockMovement(product, product.stock - beforeAdd, 'sale');
    warnIfOversold(product);

    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
}

/**
 * Decrement cart item quantity (returning to vitrina stock)
 */
function handleRemoveFromCart(cartKey) {
    const cartItemIndex = currentCart.findIndex(item => cartKeyOf(item) === cartKey);
    if (cartItemIndex === -1) return;

    triggerHaptic(15);

    const cartItem = currentCart[cartItemIndex];
    const product = products.find(p => p.id === cartItem.productId);

    if (product) {
        const beforeRemove = product.stock;
        product.stock = product.stock >= product.max ? product.stock + 1 : Math.min(product.max, product.stock + 1);
        window.StorageManager.saveProducts(products);
        recordStockMovement(product, product.stock - beforeRemove, 'sale_return');
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
                const beforeClear = product.stock;
                product.stock = product.stock >= product.max ? product.stock + cartItem.quantity : Math.min(product.max, product.stock + cartItem.quantity);
                recordStockMovement(product, product.stock - beforeClear, 'sale_return');
            }
        });

        // Delete old sales from Supabase if we were editing an existing account.
        // Same timestamp-keyed delete as handleCheckoutCart -- a stale uuid list
        // could otherwise leave the account undeleted while the screen clears
        // locally, so it silently reappears in Cuentas Activas on the next sync.
        const editingSalesStr = sessionStorage.getItem('casa_lucenzo_editing_sales');
        const editingTimestampForClear = sessionStorage.getItem('casa_lucenzo_editing_timestamp');
        if (editingSalesStr && editingTimestampForClear) {
            if (window.SupabaseManager.isConfigured()) {
                const voided = await window.SupabaseManager.voidSalesByTimestamp(editingTimestampForClear, "Cuenta vaciada durante edición");
                if (!voided) {
                    window.UIManager.showToast("⚠️ No se pudo confirmar el vaciado por falta de conexión. La cuenta podría reaparecer -- revisala en Cuentas Activas.", "fa-solid fa-triangle-exclamation");
                }
            }
            sessionStorage.removeItem('casa_lucenzo_editing_sales');
            sessionStorage.removeItem('casa_lucenzo_editing_timestamp');
        }
        sessionStorage.removeItem('casa_lucenzo_editing_client_name');

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

    // A double-tap on "Cobrar" (or a stray duplicate click while the previous
    // checkout is still awaiting Supabase) used to run this whole function
    // twice concurrently. On a "Modificar" edit, both copies delete-then-
    // insert the same account under the same timestamp -- if the second
    // delete lands after the first insert, it wipes the first copy's rows
    // and both copies insert on top, stacking duplicate rows silently
    // (no error, no extra activity log entry). This flag makes a second
    // call while one is already in flight a no-op instead of a second run.
    if (handleCheckoutCart._inProgress) {
        window.UIManager.showToast("⏳ Ya se está procesando esta cuenta, esperá un momento.", "fa-solid fa-hourglass-half");
        return;
    }
    handleCheckoutCart._inProgress = true;
    try {

    triggerHaptic(15);
    const defaultName = sessionStorage.getItem('casa_lucenzo_editing_client_name') || "";
    const cameFromClientes = !!defaultName;
    // Nombre y cédula en una sola ventana, con buscador de clientes que ya
    // vinieron (js/clientes-frecuentes.js).
    // Al modificar una cuenta el nombre viene como "Nombre - V-123": la cédula va en su casilla.
    const defaultMatch = defaultName.match(/^(.*?)\s+-\s+([VJEGP]-[\d.\-\s]+)$/i);
    const clientData = await window.UIManager.promptClientData(
        defaultMatch ? defaultMatch[1] : defaultName,
        salesLog,
        defaultMatch ? defaultMatch[2].trim() : ''
    );
    if (clientData === null) return; // Cancelled

    const rawName = (clientData.name || '').trim() || `Cliente #${salesLog.length + 1}`;
    const rawRif = (clientData.rif || '').trim();
    const clientName = rawRif ? `${rawName} - ${rawRif}` : rawName;
    
    const editingTimestamp = sessionStorage.getItem('casa_lucenzo_editing_timestamp');
    const editingSalesStr = sessionStorage.getItem('casa_lucenzo_editing_sales');
    const timestamp = editingTimestamp || new Date().toISOString();

    if (editingSalesStr && editingTimestamp) {
        // Void by timestamp (the account's real identity key), not by a
        // uuid list captured back when "Modificar" was pressed -- that list
        // can go stale, which used to leave the old rows behind forever
        // while the corrected set was inserted right on top of them,
        // silently doubling that account's sales. If the void can't be
        // confirmed right now, stop here instead of inserting a replacement
        // on top of rows that might still be active.
        if (window.SupabaseManager.isConfigured()) {
            const voided = await window.SupabaseManager.voidSalesByTimestamp(editingTimestamp, "Corrección de cuenta");
            if (!voided) {
                window.UIManager.showToast("⚠️ No se pudo confirmar la corrección por falta de conexión. Probá de nuevo en unos segundos -- no se guardó nada todavía.", "fa-solid fa-triangle-exclamation");
                return;
            }
        }
        // Remove old entries from local memory log
        salesLog = salesLog.filter(s => s.timestamp !== editingTimestamp);

        sessionStorage.removeItem('casa_lucenzo_editing_sales');
        sessionStorage.removeItem('casa_lucenzo_editing_timestamp');
    }
    sessionStorage.removeItem('casa_lucenzo_editing_client_name');

    // Create sales log items for each cart product (as open active account)
    const newSales = [];
    currentCart.forEach(cartItem => {
        const prod = products.find(p => p.id === cartItem.productId);
        for (let i = 0; i < cartItem.quantity; i++) {
            const saleItem = {
                uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
                productId: cartItem.productId,
                name: `${cartItem.name} [${clientName}]`,
                price: cartItem.price || 0,
                // Producto extra: lo que costó afuera (si la caja lo puso).
                // Costo en $ (si lo tiene) se pasa a Bs con la tasa de este cobro.
                cost: prod ? window.AnalyticsManager.productCostBs(prod, bcvRate) : (Combos && Combos.isExtraSale(cartItem) ? (cartItem.costBs || 0) : 0),
                timestamp: timestamp
            };
            newSales.push(saleItem);
        }
    });

    salesLog.push(...newSales);
    window.StorageManager.saveSalesLog(salesLog);
    logActivity("Registro Venta", `Venta de ${newSales.length} ítems por $${newSales.reduce((s,x)=>s+x.price, 0).toFixed(2)}. Cliente: ${clientName || 'Sin Nombre'}`);

    currentCart = [];
    localStorage.removeItem('casa_lucenzo_current_cart');

    // Refresh UI views
    window.UIManager.renderActiveCart(currentCart, handleAddToCart, handleRemoveFromCart, handleClearCart, handleCheckoutCart);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.renderCashRegister(salesLog, expenses);
    window.UIManager.renderSalesHistory(salesLog, handleUndoSale, handleEditSale);
    window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);

    window.UIManager.showToast(`📝 Cuenta de "${clientName}" creada en Cuentas Activas (Consumiendo).`, "fa-solid fa-user-clock");

    // Return straight to Cuentas Activas when this checkout came from Clientes
    // (editing an existing account, or starting a new one from there) -- avoids
    // having to manually re-click the tab while juggling several accounts.
    if (cameFromClientes) {
        window.UIManager.switchView('clientes');
    }

    // Save AFTER painting: the account is already in salesLog (and in
    // localStorage), so Cuentas Activas shows it right away instead of
    // waiting on the local-DB (or network) write first -- that wait is what
    // made new accounts "arrive late" on the till. Still awaited inside the
    // try so the double-tap guard stays up until the write lands.
    // insertSales writes local-first (PowerSync) when synced, Supabase-direct
    // otherwise -- it handles its own fallback/errors internally.
    if (window.SupabaseManager.isConfigured()) {
        await window.SupabaseManager.insertSales(newSales);
    }

    // Admin stats re-read the stored sales, so they go after the write.
    if (currentRole === 'admin') {
        loadAndRenderAdminStats();
    }

    } finally {
        handleCheckoutCart._inProgress = false;
    }
}
