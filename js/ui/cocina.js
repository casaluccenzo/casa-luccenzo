// Vista Cocina.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Render the orders needed to be cooked in the kitchen view, including raw ingredients
 * @param {Array} products Current products list
 * @param {Function} deliverProduct Callback when product is filled (id)
 * @param {Array} replenishments Dispatches list to show pending
 */
function renderCocina(products, deliverProduct, replenishments = [], salesLog = []) {
    const container = document.getElementById('kitchen-orders-container');
    if (!container) return;
    products = forSale(products);

    const alertBanner = document.getElementById('kitchen-alert-banner');
    if (alertBanner) {
        const hasCritical = products.some(p => p.stock <= p.min);
        if (hasCritical) {
            alertBanner.classList.remove('hidden');
        } else {
            alertBanner.classList.add('hidden');
        }
    }

    // 1. Calculate sales per product for TODAY
    const startOfToday = new Date();
    startOfToday.setHours(0,0,0,0);

    const todaySales = salesLog.filter(s => {
        if (!s.timestamp) return true;
        const d = parseUTCTimestamp(s.timestamp);
        return d >= startOfToday;
    });

    const salesCountByProduct = {};
    todaySales.forEach(s => {
        const pId = s.productId;
        if (pId && pId !== 'abono') {
            salesCountByProduct[pId] = (salesCountByProduct[pId] || 0) + 1;
        }
    });

    // 2. Separate Pastelitos and Other products
    const getCat = (p) => (window.StorageManager && window.StorageManager.getProductCategory)
        ? window.StorageManager.getProductCategory(p)
        : (p.category || 'pastelitos');

    const pastelitoProducts = products.filter(p => getCat(p) === 'pastelitos');
    const otherProducts = products.filter(p => getCat(p) !== 'pastelitos');

    // Calculate Top 3 Most Sold Pastelitos
    const pastelitoSalesList = pastelitoProducts.map(p => ({
        ...p,
        soldCount: salesCountByProduct[p.id] || 0
    })).filter(p => p.soldCount > 0)
      .sort((a, b) => b.soldCount - a.soldCount);

    const top3Pastelitos = pastelitoSalesList.slice(0, 3);

    const pendingDispatches = replenishments.filter(r => r.status === 'en_camino');

    // Build Top 3 Minimalist Metric Banner
    let top3Html = '';
    if (top3Pastelitos.length > 0) {
        const medals = ['🥇', '🥈', '🥉'];
        top3Html = `
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(212,175,55,0.25); border-radius: 10px; padding: 0.6rem 0.8rem; margin-top: 1.25rem; font-size: 0.78rem;">
                <div style="font-size: 0.72rem; font-weight: 800; color: var(--color-gold); text-transform: uppercase; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="fa-solid fa-trophy"></i> Top 3 Productos Más Vendidos Hoy
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: space-between;">
                    ${top3Pastelitos.map((p, idx) => `
                        <div style="display: flex; align-items: center; gap: 0.35rem; background: var(--v-0-0-0-3, rgba(0, 0, 0, 0.3)); padding: 0.35rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); min-width: 120px;">
                            <span>${medals[idx]}</span>
                            <span style="font-weight: 800; color: var(--color-white); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100px;">${p.name}</span>
                            <span style="font-weight: 900; color: var(--color-success); margin-left: auto;">${p.soldCount} <span style="font-size: 0.65rem; font-weight: 700; color: var(--color-text-muted);">piezas</span></span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    let dispatchesHtml = '';
    if (pendingDispatches.length > 0) {
        dispatchesHtml = `
            <div class="recipe-container" style="border-color: var(--color-success-border); margin-bottom: 1rem;">
                <h4 class="recipe-title" style="color: var(--color-success);"><i class="fa-solid fa-truck-fast"></i> En Camino al Local:</h4>
                <div style="font-size: 0.75rem; color: var(--color-white); line-height: 1.6;">
                    ${pendingDispatches.map(d => `• <strong>${d.amount}</strong> ${d.unit} de <strong>${d.name}</strong> (Esperando confirmación de caja)`).join('<br>')}
                </div>
            </div>
        `;
    }

    let pastelitosSectionHtml = '';
    if (pastelitoProducts.length > 0) {
        pastelitosSectionHtml = `
            <div style="margin-bottom: 1.5rem;">
                <h3 style="font-size: 0.95rem; font-weight: 900; color: var(--color-gold); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
                    🥐 Monitoreo de Pastelitos por Sabor
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 0.85rem;" id="kitchen-pastelitos-list"></div>
            </div>
        `;
    }

    if (pastelitoProducts.length === 0) {
        pastelitosSectionHtml = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fa-solid fa-circle-check"></i></div>
                <h3 class="empty-state-title">No hay pastelitos registrados</h3>
            </div>
        `;
    }

    // Secondary Block for Bebidas & Dulces (Collapsible / Separate Card)
    let secondaryContentHtml = '';
    if (otherProducts.length > 0) {
        secondaryContentHtml = `
            <div style="margin-top: 1.5rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-lg); padding: 1rem;">
                <details style="cursor: pointer;">
                    <summary style="font-size: 0.85rem; font-weight: 800; color: var(--color-gold); display: flex; align-items: center; gap: 0.5rem; outline: none; list-style: none;">
                        <i class="fa-solid fa-box-open"></i> Stock de Bebidas y Dulces en Vitrina (${otherProducts.length} ítems)
                        <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: normal; margin-left: auto;">Toca para ver/ocultar ▾</span>
                    </summary>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.6rem; margin-top: 0.85rem;">
                        ${otherProducts.map(item => {
                            const sold = salesCountByProduct[item.id] || 0;
                            return `
                                <div style="display: flex; justify-content: space-between; align-items: center; background: var(--v-0-0-0-3, rgba(0, 0, 0, 0.3)); padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); font-size: 0.78rem;">
                                    <div>
                                        <div style="font-weight: 800; color: var(--color-white);">${item.name}</div>
                                        <div style="font-size: 0.68rem; color: var(--color-text-muted);">Vendidos hoy: ${sold}</div>
                                    </div>
                                    <span style="font-weight: 900; color: ${item.stock <= item.min ? '#F87171' : 'var(--color-gold)'};">
                                        ${item.stock} ${item.unit}
                                    </span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </details>
            </div>
        `;
    }

    container.innerHTML = `
        ${dispatchesHtml}
        ${pastelitosSectionHtml}
        ${secondaryContentHtml}
        ${top3Html}
    `;

    const renderProductionCards = (targetElementId, itemsList) => {
        const listEl = document.getElementById(targetElementId);
        if (!listEl) return;

        itemsList.forEach(item => {
            const soldCount = salesCountByProduct[item.id] || 0;
            const amountNeeded = Math.max(0, item.max - item.stock);
            const isDispatched = pendingDispatches.some(d => d.productId === item.id);
            const initialQty = amountNeeded > 0 ? amountNeeded : 5;

            const card = document.createElement('div');
            card.className = "kitchen-card";
            card.style.cssText = "display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem; padding: 0.85rem 1rem; border-radius: var(--radius-lg); background: rgba(10, 20, 38, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: var(--shadow-sm);";

            card.innerHTML = `
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.4rem;">
                        <h3 class="product-name" style="font-size: 1rem; font-weight: 800; color: var(--color-white); margin: 0;">${escapeHtml(item.name)}</h3>
                        <span style="font-size: 10px; font-weight: 800; padding: 0.15rem 0.4rem; border-radius: 4px; background: ${item.stock <= item.min ? 'rgba(248, 113, 113, 0.15)' : 'rgba(52, 211, 153, 0.12)'}; color: ${item.stock <= item.min ? '#F87171' : '#34D399'}; border: 1px solid ${item.stock <= item.min ? 'rgba(248, 113, 113, 0.3)' : 'rgba(52, 211, 153, 0.3)'};">
                            En Vitrina: ${item.stock} ${escapeHtml(item.unit)}
                        </span>
                    </div>

                    <!-- 3 Indicators Bar (En Vitrina, Vendidos Hoy, Falta Cocinar) -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.4rem; background: var(--v-0-0-0-3, rgba(0, 0, 0, 0.3)); padding: 0.4rem; border-radius: var(--radius-md); border: 1px solid rgba(255, 255, 255, 0.05); margin-top: 0.4rem; text-align: center; font-size: 0.7rem;">
                        <div>
                            <div style="color: var(--color-text-muted); font-size: 0.65rem; font-weight: 700;">VITRINA</div>
                            <div style="font-weight: 900; color: var(--color-white); font-size: 0.95rem;">${item.stock}</div>
                        </div>
                        <div style="border-left: 1px solid rgba(255,255,255,0.08); border-right: 1px solid rgba(255,255,255,0.08);">
                            <div style="color: var(--color-text-muted); font-size: 0.65rem; font-weight: 700;">VENDIDOS</div>
                            <div style="font-weight: 900; color: var(--color-success); font-size: 0.95rem;">${soldCount}</div>
                        </div>
                        <div>
                            <div style="color: var(--color-gold); font-size: 0.65rem; font-weight: 700;">FALTA</div>
                            <div style="font-weight: 900; color: ${amountNeeded > 0 ? '#F87171' : 'var(--color-text-muted)'}; font-size: 0.95rem;">${amountNeeded}</div>
                        </div>
                    </div>

                    <!-- Quantity Stepper Controls for Custom Dispatch -->
                    ${!isDispatched ? `
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: 0.5rem; background: var(--v-0-0-0-25, rgba(0, 0, 0, 0.25)); padding: 0.35rem 0.6rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                            <span style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 700;">CANTIDAD A ENVIAR:</span>
                            <div style="display: flex; align-items: center; gap: 0.3rem;">
                                <button type="button" class="btn-qty-minus" style="width: 26px; height: 26px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08); color: #FFF; font-weight: 900; cursor: pointer; font-size: 0.85rem;">-</button>
                                <input type="number" class="input-send-qty" value="${initialQty}" min="1" max="500" style="width: 44px; height: 26px; text-align: center; font-weight: 900; font-size: 0.85rem; border: 1px solid rgba(212,175,55,0.4); border-radius: 6px; background: rgba(0,0,0,0.6); color: var(--color-gold); font-family: monospace;">
                                <button type="button" class="btn-qty-plus" style="width: 26px; height: 26px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08); color: #FFF; font-weight: 900; cursor: pointer; font-size: 0.85rem;">+</button>
                            </div>
                        </div>
                    ` : ''}
                </div>

                <div>
                    ${isDispatched 
                        ? `<div style="text-align: center; font-size: 0.72rem; font-weight: 800; color: var(--color-gold); border: 1px dashed var(--color-gold); padding: 0.4rem; border-radius: var(--radius-md); background: rgba(212, 175, 55, 0.08);">
                             <i class="fa-solid fa-truck-fast"></i> En camino al local (Esperando confirmación)
                           </div>`
                        : `<button type="button" class="btn-touch btn-kitchen-deliver" title="Enviar al local" style="width: 100%; height: 36px; border-radius: var(--radius-md); border: none; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: #ffffff; font-weight: 800; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.4rem; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25); transition: transform 0.15s;">
                             <i class="fa-solid fa-truck-ramp-box"></i>
                             <span class="btn-deliver-text">¡ENVIAR ${initialQty} AL LOCAL!</span>
                           </button>`
                    }
                </div>
            `;

            if (!isDispatched) {
                const qtyInput = card.querySelector('.input-send-qty');
                const btnMinus = card.querySelector('.btn-qty-minus');
                const btnPlus = card.querySelector('.btn-qty-plus');
                const btnDeliver = card.querySelector('.btn-kitchen-deliver');
                const deliverText = card.querySelector('.btn-deliver-text');

                const updateBtnText = () => {
                    let val = parseInt(qtyInput.value, 10);
                    if (isNaN(val) || val < 1) val = 1;
                    if (deliverText) {
                        deliverText.textContent = `¡ENVIAR ${val} AL LOCAL!`;
                    }
                };

                if (btnMinus && qtyInput) {
                    btnMinus.addEventListener('click', () => {
                        let cur = parseInt(qtyInput.value, 10) || 1;
                        if (cur > 1) {
                            qtyInput.value = cur - 1;
                            updateBtnText();
                        }
                    });
                }

                if (btnPlus && qtyInput) {
                    btnPlus.addEventListener('click', () => {
                        let cur = parseInt(qtyInput.value, 10) || 1;
                        qtyInput.value = cur + 1;
                        updateBtnText();
                    });
                }

                if (qtyInput) {
                    qtyInput.addEventListener('input', updateBtnText);
                }

                if (btnDeliver && qtyInput) {
                    btnDeliver.addEventListener('click', () => {
                        const sendQty = parseInt(qtyInput.value, 10) || 1;
                        deliverProduct(item.id, sendQty);
                    });
                }
            }

            listEl.appendChild(card);
        });
    };

    renderProductionCards('kitchen-pastelitos-list', pastelitoProducts);

    // Recipe calculator (optional at bottom)
    const neededPastelitosList = pastelitoProducts.filter(p => p.stock < p.max);
    if (window.RecipeCalculator && neededPastelitosList.length > 0) {
        const ingredients = window.RecipeCalculator.calculateIngredients(neededPastelitosList);
        if (ingredients.length > 0) {
            const recipeSection = document.createElement('div');
            recipeSection.className = 'recipe-container';
            recipeSection.style.cssText = 'margin-top: 1rem; padding: 0.85rem; border-radius: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08);';
            recipeSection.innerHTML = `
                <h4 class="recipe-title" style="font-size: 0.8rem; font-weight: 800; color: var(--color-gold); margin-bottom: 0.5rem;"><i class="fa-solid fa-scale-balanced"></i> Ingredientes a preparar para esta Tanda:</h4>
                <div class="recipe-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.4rem; font-size: 0.72rem;">
                    ${ingredients.map(ing => `
                        <div class="recipe-item" style="background: var(--v-0-0-0-3, rgba(0, 0, 0, 0.3)); padding: 0.35rem 0.5rem; border-radius: 6px; display: flex; justify-content: space-between;">
                            <span class="recipe-item-name">${ing.name}:</span>
                            <span class="recipe-item-val" style="font-weight: 800; color: var(--color-gold);">${ing.amount} ${ing.unit}</span>
                        </div>
                    `).join('')}
                </div>
            `;
            container.appendChild(recipeSection);
        }
    }
}
