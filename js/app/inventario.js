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

/**
 * "Cargar pasteles" (27/11/2026, stock manual, migración 053).
 *
 * Gustavo carga el stock de pasteles a mano: una ventana con todos los
 * sabores, lo que hay ahora (en rojo si está en negativo) y una casilla por
 * sabor. Dos modos:
 *   - Sumar: lo escrito se agrega a lo que hay (una tanda que salió de cocina).
 *   - Dejar en: lo escrito pasa a ser el stock exacto (un conteo de vitrina).
 * Cada cambio es un movimiento en stock_movements (recordStockMovement), así
 * Postgres lo recalcula igual en todas las cajas. Vender nunca se bloquea:
 * si un sabor queda en negativo se sigue vendiendo y se corrige aquí.
 * Admin entra directo; la vendedora, con la clave de supervisor.
 */
async function openCargarPasteles() {
    if (!(await requireSupervisor('Cargar stock de pasteles'))) return;
    triggerHaptic(10);

    const sabores = products
        .filter(p => (p.category || (window.StorageManager ? window.StorageManager.getProductCategory(p) : 'pastelitos')) === 'pastelitos')
        .filter(p => !(window.Combos && window.Combos.isHiddenFromSale(p)))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    if (sabores.length === 0) {
        window.UIManager.showToast("No hay sabores de pasteles para cargar.", "fa-solid fa-circle-info");
        return;
    }

    let modo = 'sumar';
    const overlay = document.createElement('div');
    overlay.id = 'cargar-pasteles-modal';
    overlay.style.cssText = 'position: fixed; inset: 0; z-index: var(--z-modal-top, 1000); background: rgba(0,0,0,0.8); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 1rem;';

    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const stockColor = (n) => n < 0 ? 'var(--color-danger)' : (n === 0 ? 'var(--color-text-muted)' : 'var(--color-success)');

    overlay.innerHTML = `
        <div style="background: linear-gradient(135deg, #0A1426 0%, #010F20 100%); border: 1.5px solid var(--color-gold); border-radius: var(--radius-xl, 16px); width: 100%; max-width: 420px; max-height: 92vh; padding: 1.1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.8); display: flex; flex-direction: column; gap: 0.75rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.6rem;">
                <div>
                    <h3 style="font-size: 1.1rem; font-weight: 900; color: var(--color-white); margin: 0;">📦 Cargar pasteles</h3>
                    <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.25rem;">Lo que queda pasa al día siguiente. Si un sabor queda en negativo se sigue vendiendo.</div>
                </div>
                <button data-cp="cerrar" style="background: transparent; border: none; color: var(--color-text-muted); font-size: 1.4rem; cursor: pointer; padding: 0 0.25rem;" aria-label="Cerrar">&times;</button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;">
                <button data-modo="sumar" style="height: 40px; border-radius: 8px; font-weight: 900; font-size: 0.85rem; cursor: pointer;">➕ Sumar</button>
                <button data-modo="dejar" style="height: 40px; border-radius: 8px; font-weight: 900; font-size: 0.85rem; cursor: pointer;">✏️ Dejar en</button>
            </div>
            <div data-cp="ayuda" style="font-size: 0.75rem; color: var(--color-gold); font-weight: 700;"></div>
            <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--color-text-muted);">
                <span style="flex: 1;">Poner el mismo número a todos:</span>
                <input data-cp="todos" type="tel" inputmode="numeric" pattern="[0-9]*" placeholder="—" style="width: 64px; height: 34px; text-align: center; font-size: 1rem; font-weight: 900; color: var(--color-gold); background: rgba(0,0,0,0.4); border: 1.5px solid rgba(243,198,63,0.5); border-radius: 6px; outline: none; font-family: monospace;">
            </div>
            <div data-cp="lista" style="overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; padding-right: 0.15rem;">
                ${sabores.map(p => `
                    <div style="display: flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.45rem 0.55rem;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 800; color: var(--color-white); font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(p.name)}</div>
                            <div style="font-size: 0.72rem; color: var(--color-text-muted);">Hay: <strong style="color: ${stockColor(p.stock || 0)}; font-size: 0.85rem;">${p.stock || 0}</strong><span data-prev="${esc(p.id)}"></span></div>
                        </div>
                        <input data-id="${esc(p.id)}" type="tel" inputmode="numeric" pattern="[0-9]*" placeholder="0" style="width: 64px; height: 38px; text-align: center; font-size: 1.1rem; font-weight: 900; color: var(--color-gold); background: rgba(0,0,0,0.4); border: 1.5px solid var(--color-gold); border-radius: 6px; outline: none; font-family: monospace;">
                    </div>`).join('')}
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button data-cp="cancelar" style="flex: 1; height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: transparent; color: var(--color-text-muted); font-weight: 700; font-size: 0.85rem; cursor: pointer;">Cancelar</button>
                <button data-cp="guardar" style="flex: 2; height: 44px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--color-gold) 0%, var(--color-gold-dark) 100%); color: #000; font-weight: 900; font-size: 0.9rem; cursor: pointer;"><i class="fa-solid fa-check"></i> GUARDAR STOCK</button>
            </div>
        </div>`;

    const $ = (sel) => overlay.querySelector(sel);
    const inputs = Array.from(overlay.querySelectorAll('input[data-id]'));
    const leer = (inp) => {
        const v = String(inp.value || '').replace(/[^0-9]/g, '');
        return v === '' ? null : parseInt(v, 10);
    };
    const resultado = (p, n) => (modo === 'sumar' ? (p.stock || 0) + n : n);

    const pintar = () => {
        overlay.querySelectorAll('[data-modo]').forEach(b => {
            const on = b.dataset.modo === modo;
            b.style.border = `1.5px solid ${on ? 'var(--color-gold)' : 'rgba(255,255,255,0.12)'}`;
            b.style.background = on ? 'rgba(243,198,63,0.2)' : 'rgba(255,255,255,0.04)';
            b.style.color = on ? 'var(--color-gold)' : 'var(--color-white)';
        });
        $('[data-cp="ayuda"]').textContent = modo === 'sumar'
            ? 'Escribe cuántos pasteles NUEVOS entran de cada sabor. Se suman a lo que hay.'
            : 'Escribe cuántos hay EN TOTAL de cada sabor (conteo de vitrina). Los vacíos no cambian.';
        inputs.forEach(inp => {
            const p = sabores.find(s => s.id === inp.dataset.id);
            const n = leer(inp);
            const prev = Array.from(overlay.querySelectorAll('[data-prev]')).find(el => el.dataset.prev === inp.dataset.id);
            if (!prev) return;
            if (n === null || (modo === 'sumar' && n === 0)) { prev.innerHTML = ''; return; }
            const r = resultado(p, n);
            prev.innerHTML = ` → queda <strong style="color: ${stockColor(r)}; font-size: 0.85rem;">${r}</strong>`;
        });
    };

    const cerrar = () => overlay.remove();
    $('[data-cp="cerrar"]').onclick = cerrar;
    $('[data-cp="cancelar"]').onclick = cerrar;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
    overlay.querySelectorAll('[data-modo]').forEach(b => { b.onclick = () => { modo = b.dataset.modo; pintar(); }; });
    inputs.forEach(inp => { inp.oninput = pintar; });
    $('[data-cp="todos"]').oninput = (e) => {
        const v = String(e.target.value || '').replace(/[^0-9]/g, '');
        inputs.forEach(inp => { inp.value = v; });
        pintar();
    };

    $('[data-cp="guardar"]').onclick = () => {
        const cambios = [];
        inputs.forEach(inp => {
            const p = products.find(x => x.id === inp.dataset.id);
            const n = leer(inp);
            if (!p || n === null) return;
            const antes = p.stock || 0;
            if (modo === 'sumar') {
                if (n > 0 && applyStockLoad(p, n)) cambios.push({ p, antes });
            } else if (n !== antes) {
                applyStockCount(p, n);
                cambios.push({ p, antes });
            }
        });
        if (cambios.length === 0) {
            window.UIManager.showToast("No escribiste ningún número.", "fa-solid fa-circle-info");
            return;
        }
        window.StorageManager.saveProducts(products);
        cambios.forEach(({ p, antes }) => {
            const delta = p.stock - antes;
            recordStockMovement(p, delta, delta > 0 ? 'load' : 'count_down');
        });
        const detalle = cambios.map(({ p, antes }) => `${p.name}: ${antes} → ${p.stock}`).join(', ');
        logActivity("Carga de Pasteles", `${modo === 'sumar' ? 'Sumar' : 'Dejar en'} — ${detalle}`);
        cerrar();
        renderAllViews();
        window.UIManager.showToast(`✅ Stock guardado (${cambios.length} sabor${cambios.length === 1 ? '' : 'es'}).`, "fa-solid fa-circle-check");
    };

    document.body.appendChild(overlay);
    pintar();
}
window.openCargarPasteles = openCargarPasteles;
