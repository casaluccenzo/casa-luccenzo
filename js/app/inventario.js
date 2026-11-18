// Inventario: despachos, reposición, ajustes directos de stock y recepción de tandas.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// ================= DISPATCH FLOWS (KITCHEN <-> LOCAL) =================

/**
 * Trigger product delivery/replenishment dispatch from Kitchen to Vitrina (Sales)
 * @param {string} id Product identifier
 * @param {number|null} customAmount Custom quantity specified by cook
 */
function deliverProduct(id, customAmount = null) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    let amountToSend = customAmount !== null ? parseInt(customAmount, 10) : (product.max - product.stock);
    if (isNaN(amountToSend) || amountToSend <= 0) {
        amountToSend = Math.max(1, product.max - product.stock);
    }

    triggerHaptic(15);

    const newDispatch = {
        uuid: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        productId: product.id,
        name: product.name,
        amount: amountToSend,
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
                if (recipeItem.name === "Relleno Queso Blanco") return ing.id === 'queso';
                return false;
            });
            if (targetIng) {
                const calculatedDeduction = (recipeItem.amount / (product.max - product.stock || 1)) * amountToSend;
                targetIng.stock = Math.max(0, targetIng.stock - calculatedDeduction);
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

    window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
    window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);

    window.UIManager.showToast(`🚚 "${product.name}" (${amountToSend} ${product.unit || 'unid.'}) enviado a vitrina.`, "fa-solid fa-paper-plane");
    logActivity("Despacho Cocina", `Cocinado y enviado ${amountToSend} ${product.unit || 'unid.'} de ${product.name} a vitrina`);
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
    
    window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
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
    const beforeCount = product.stock;
    applyStockCount(product, newStock);
    window.StorageManager.saveProducts(products);

    const countDelta = product.stock - beforeCount;
    recordStockMovement(product, countDelta, countDelta > 0 ? 'load' : 'count_down');

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
    const beforeAdd = product.stock;
    applyStockLoad(product, amountToAdd);

    window.StorageManager.saveProducts(products);

    recordStockMovement(product, product.stock - beforeAdd, 'load');

    renderAllViews();
    window.UIManager.showToast(`✅ Vitrina actualizada: Se sumaron ${amountToAdd} piezas a "${product.name}". Total: ${product.stock}.`, "fa-solid fa-circle-check");
}
window.addProductStockDirect = addProductStockDirect;


/**
 * Local trigger: Mark all pending dispatches as received, replenishing stocks.
 *
 * Idempotent on purpose: each batch may only ever be added to the vitrina
 * once. The uuids are burned into localStorage *before* any stock moves, so a
 * double tap, a realtime echo, or the 45s background re-sync landing before
 * the Supabase DELETE commits can no longer resurrect the card and add the
 * same pieces a second time.
 */
async function confirmReceipt() {
    if (isConfirmingReceipt) return;

    const consumed = new Set(window.StorageManager.loadConsumedReplenishmentUuids());
    const pending = replenishments.filter(r => r.status === 'en_camino' && !consumed.has(r.uuid));
    if (pending.length === 0) {
        // Nothing genuinely new: drop any stale card left over from a re-sync.
        replenishments = replenishments.filter(r => !consumed.has(r.uuid));
        window.StorageManager.saveReplenishments(replenishments);
        window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);
        return;
    }

    isConfirmingReceipt = true;
    triggerHaptic(15);

    // Claim the batch first -- everything below is now safe to retry.
    window.StorageManager.addConsumedReplenishmentUuids(pending.map(d => d.uuid));

    try {
        pending.forEach(dispatch => {
            const product = products.find(p => p.id === dispatch.productId);
            const beforeReceipt = product ? product.stock : 0;
            if (product && applyStockLoad(product, dispatch.amount)) {
                recordStockMovement(product, product.stock - beforeReceipt, 'load', dispatch.uuid);
                logActivity("Recepción Vitrina", `Recibidos ${dispatch.amount} ${product.unit || 'unid.'} de ${product.name} en vitrina. Stock actual: ${product.stock}/${product.max}`);
            }
            dispatch.status = 'recibido';
        });

        replenishments = replenishments.filter(r => r.status !== 'recibido' && !consumed.has(r.uuid));
        window.StorageManager.saveReplenishments(replenishments);
        window.StorageManager.saveProducts(products);

        // Refresh views
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderCocina(products, deliverProduct, replenishments, salesLog);
        window.UIManager.renderPendingDispatches(replenishments, confirmReceipt);

        window.UIManager.showToast("✨ ¡Mercancía recibida! Vitrina actualizada.", "fa-solid fa-circle-check");

        // Await the deletes so the next background sync cannot re-read them.
        if (window.SupabaseManager.isConfigured()) {
            await Promise.all(pending.map(d => window.SupabaseManager.deleteReplenishment(d.uuid)));
        }
    } finally {
        isConfirmingReceipt = false;
    }
}

async function resetToMax() {
    // Rellenar todo cambia el inventario de golpe: admin, o vendedora con clave de supervisor.
    if (!(await requireSupervisor('Rellenar todo: llenar la vitrina hasta el máximo'))) return;
    triggerHaptic(15);
    products.forEach(p => {
        const cat = p.category || (window.StorageManager ? window.StorageManager.getProductCategory(p) : 'pastelitos');
        const beforeReset = p.stock || 0;
        // Topping the shelf back up to capacity is a load like any other: only
        // the missing pieces enter, and the day's baseline grows by that much.
        if (cat === 'pastelitos' && applyStockLoad(p, (p.max || 0) - (p.stock || 0))) {
            recordStockMovement(p, p.stock - beforeReset, 'load');
        }
    });
    window.StorageManager.saveProducts(products);
    window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
    window.UIManager.showToast("✨ Vitrina de pastelitos rellenada al máximo.", "fa-solid fa-circle-check");
}
