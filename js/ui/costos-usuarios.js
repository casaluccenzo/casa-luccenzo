// Selector de cantidad, calculadora de costos y gestión de usuarios.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// Expose to window namespace
/**
 * Opens a quick numeric quantity selector modal for Vitrina
 * @param {Object} product Selected product details
 * @param {number} currentQty Current quantity in active cart
 * @param {Function} onConfirm Callback when quantity is selected (newQty)
 */
function openQuantitySelectorModal(product, currentQty = 0, onConfirm) {
    const modal = document.getElementById('qty-selector-modal');
    if (!modal) return;

    const titleEl = document.getElementById('qty-modal-prod-name');
    const infoEl = document.getElementById('qty-modal-prod-info');
    const inputEl = document.getElementById('qty-modal-input');
    const gridEl = document.getElementById('qty-modal-quick-grid');
    const btnClose = document.getElementById('qty-modal-close');
    const btnCancel = document.getElementById('qty-modal-cancel');
    const btnConfirm = document.getElementById('qty-modal-confirm');
    const btnMinus = document.getElementById('qty-modal-minus');
    const btnPlus = document.getElementById('qty-modal-plus');

    if (titleEl) titleEl.textContent = product.name;
    if (infoEl) infoEl.textContent = `$${(product.price || 0).toFixed(2)} • (Bs. ${((product.price || 0) * (window.bcvRate || 1)).toFixed(2)}) • Vitrina: ${product.stock || 0} ${product.unit || 'unid.'}`;

    let selectedQty = currentQty > 0 ? currentQty : 1;
    if (inputEl) inputEl.value = selectedQty;

    // Fast selector numbers grid
    const quickNumbers = [1, 2, 3, 4, 5, 6, 8, 10];
    if (gridEl) {
        gridEl.innerHTML = '';
        quickNumbers.forEach(num => {
            const btn = document.createElement('button');
            const isSelected = num === selectedQty;
            btn.style.cssText = `height: 42px; border-radius: 8px; border: 1.5px solid ${isSelected ? 'var(--color-gold)' : 'rgba(255,255,255,0.12)'}; background: ${isSelected ? 'rgba(243,198,63,0.2)' : 'rgba(255,255,255,0.04)'}; color: ${isSelected ? 'var(--color-gold)' : 'var(--color-white)'}; font-size: 1.1rem; font-weight: 900; cursor: pointer; transition: all 0.15s; font-family: monospace;`;
            btn.textContent = num;

            btn.addEventListener('click', () => {
                selectedQty = num;
                if (inputEl) inputEl.value = selectedQty;
                if (onConfirm) onConfirm(selectedQty);
                closeModal();
            });

            gridEl.appendChild(btn);
        });
    }

    const updateValue = (newVal) => {
        selectedQty = Math.max(0, parseInt(newVal) || 0);
        if (inputEl) inputEl.value = selectedQty;
    };

    if (btnMinus) {
        btnMinus.onclick = () => updateValue(selectedQty - 1);
    }
    if (btnPlus) {
        btnPlus.onclick = () => updateValue(selectedQty + 1);
    }
    if (inputEl) {
        inputEl.oninput = (e) => updateValue(e.target.value);
    }

    const closeModal = () => {
        modal.classList.add('hidden');
    };

    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;

    if (btnConfirm) {
        btnConfirm.onclick = () => {
            if (onConfirm) onConfirm(selectedQty);
            closeModal();
        };
    }

    modal.classList.remove('hidden');
}

/**
 * Render the Admin Cost & Net Profit Calculator view
 * @param {Array} products Current menu products list
 * @param {Array} costInsumos List of raw insumos and purchase costs
 * @param {Function} onDeleteInsumo Callback to delete an insumo
 */
function renderCostCalculator(products, costInsumos, onDeleteInsumo) {
    // 1. Render Insumos List
    const insumosContainer = document.getElementById('cost-insumos-list-container');
    if (insumosContainer) {
        insumosContainer.innerHTML = '';
        if (!costInsumos || costInsumos.length === 0) {
            insumosContainer.innerHTML = `<div style="text-align: center; font-size: 11px; color: var(--color-text-muted); padding: 1rem;">No hay insumos registrados.</div>`;
        } else {
            costInsumos.forEach(item => {
                const card = document.createElement('div');
                card.style.cssText = "background: var(--v-0-0-0-3, rgba(0, 0, 0, 0.3)); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--radius-md); padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;";
                
                const unitPrice = item.price / (item.qty || 1);
                let detailText;
                let typeBadge;

                if (item.type === 'solid') {
                    const pricePerGram = unitPrice / 1000;
                    typeBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #10B981; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 800;">SÓLIDO</span>`;
                    detailText = `$${unitPrice.toFixed(2)} / kg • <b style="color: var(--color-gold);">$${pricePerGram.toFixed(4)} / gramo</b>`;
                } else if (item.type === 'liquid') {
                    const pricePerMl = unitPrice / 1000;
                    typeBadge = `<span style="background: rgba(59, 130, 246, 0.15); color: #60A5FA; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 800;">LÍQUIDO</span>`;
                    detailText = `$${unitPrice.toFixed(2)} / L • <b style="color: var(--color-gold);">$${pricePerMl.toFixed(4)} / ml</b>`;
                } else {
                    typeBadge = `<span style="background: rgba(201, 162, 74, 0.15); color: var(--color-gold); padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 800;">UNIDAD</span>`;
                    detailText = `$${unitPrice.toFixed(2)} / unidad`;
                }

                card.innerHTML = `
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; font-weight: 800; color: var(--color-white);">
                            <span>${item.name}</span>
                            ${typeBadge}
                        </div>
                        <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 2px;">
                            Compra: $${item.price.toFixed(2)} por ${item.qty} ${item.unit} | ${detailText}
                        </div>
                    </div>
                    <button class="btn-delete-insumo" style="background: rgba(239, 68, 68, 0.15); border: 1px solid var(--color-danger); color: var(--color-danger); width: 26px; height: 26px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 10px;" title="Eliminar insumo">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;

                card.querySelector('.btn-delete-insumo').addEventListener('click', () => {
                    if (onDeleteInsumo) onDeleteInsumo(item.id);
                });

                insumosContainer.appendChild(card);
            });
        }
    }

    // 2. Render Product Selector Dropdown
    const prodSelect = document.getElementById('cost-calc-product-select');
    if (prodSelect && products) {
        const currentSelectedId = prodSelect.value;
        prodSelect.innerHTML = '';
        products.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} ($${(p.price || 0).toFixed(2)})`;
            if (p.id === currentSelectedId) opt.selected = true;
            prodSelect.appendChild(opt);
        });
    }

    // 3. Render Financial Results Analysis
    renderCostFinancialResults(products, costInsumos);
}

/**
 * Calculates recipe cost, net profit, margin percentage and tray profit for selected product
 */
function renderCostFinancialResults(products, costInsumos) {
    const resultsContainer = document.getElementById('cost-financial-results-container');
    const prodSelect = document.getElementById('cost-calc-product-select');
    const sellPriceInput = document.getElementById('cost-calc-sell-price');
    if (!resultsContainer || !prodSelect) return;

    const selectedProdId = prodSelect.value || (products && products[0] ? products[0].id : null);
    const product = products.find(p => p.id === selectedProdId) || (products && products[0]);
    if (!product) return;

    // Update sell price input if switching product
    if (sellPriceInput && (!sellPriceInput.value || sellPriceInput.dataset.activeProdId !== product.id)) {
        sellPriceInput.value = (product.price || 1.50).toFixed(2);
        sellPriceInput.dataset.activeProdId = product.id;
    }

    const sellPrice = parseFloat(sellPriceInput ? sellPriceInput.value : 0) || (product.price || 1.50);
    const bcv = window.bcvRate || 1;

    // Calculate recipe production cost from insumos database
    const findInsumo = (key, defaultPricePerG) => {
        if (!costInsumos) return defaultPricePerG;
        const found = costInsumos.find(i => i.id === key || i.name.toLowerCase().includes(key));
        if (found) {
            const unitPrice = found.price / (found.qty || 1);
            return unitPrice / 1000; // price per gram or ml
        }
        return defaultPricePerG;
    };

    const priceHarinaG = findInsumo('harina', 22.00 / 25000); // 0.00088 / g
    const priceMargarinaG = findInsumo('margarina', 18.00 / 10000); // 0.0018 / g
    const priceAceiteMl = findInsumo('aceite', 20.00 / 10000); // 0.002 / ml

    let unitProductionCost;
    let ingredientBreakdownHtml;
    let costSourceHtml;

    if (product.cost > 0) {
        // Real cost the business actually pays (e.g. Bs.800/unit to the
        // third-party producer, set in Configurar Productos) beats any
        // ingredient-recipe guess -- using both at once is how this
        // calculator used to show a $0.26 "cost" and 753% margin on a
        // pastelito that really costs Bs.800 to have made.
        unitProductionCost = product.cost / bcv;
        ingredientBreakdownHtml = `
            <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 0.5rem; background: var(--v-0-0-0-2, rgba(0, 0, 0, 0.2)); padding: 0.5rem; border-radius: var(--radius-md);">
                • Costo real pagado al productor: Bs. ${product.cost.toFixed(2)} / unidad
            </div>
        `;
        costSourceHtml = `<span style="font-size: 9px; font-weight: 800; color: var(--color-success); text-transform: uppercase;"><i class="fa-solid fa-check-circle"></i> Costo real (Configurar Productos)</span>`;
    } else {

    // Standard dough cost for 1 pastelito (50g Harina + 5g Margarina + 15ml Fritura)
    const costHarina = 50 * priceHarinaG;
    const costMargarina = 5 * priceMargarinaG;
    const costAceite = 15 * priceAceiteMl;

    costSourceHtml = `<span style="font-size: 9px; font-weight: 800; color: #FBBF24; text-transform: uppercase;"><i class="fa-solid fa-triangle-exclamation"></i> Estimado por receta -- no es el costo real</span>`;

    if (product.category === 'pastelitos') {
        let fillingCost;
        let fillingName;
        let fillingGrams = 30;

        if (product.id.includes('mechada')) {
            fillingName = 'Carne Mechada';
            fillingCost = 30 * findInsumo('carne_mechada', 75.00 / 15000);
        } else if (product.id.includes('pollo')) {
            fillingName = 'Pollo Desmechado';
            fillingCost = 30 * findInsumo('pollo', 50.00 / 15000);
        } else if (product.id.includes('queso')) {
            fillingName = 'Queso Blanco';
            fillingCost = 30 * findInsumo('queso', 45.00 / 10000);
        } else if (product.id.includes('tocineta')) {
            fillingName = 'Tocineta y Queso';
            fillingCost = (15 * findInsumo('queso', 45.00 / 10000)) + (15 * findInsumo('tocineta', 30.00 / 5000));
        } else {
            fillingName = 'Relleno Especial';
            fillingCost = 35 * findInsumo('carne_mechada', 75.00 / 15000);
        }

        unitProductionCost = costHarina + costMargarina + costAceite + fillingCost;

        ingredientBreakdownHtml = `
            <div style="font-size: 10px; color: var(--color-text-muted); display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; margin-top: 0.5rem; background: var(--v-0-0-0-2, rgba(0, 0, 0, 0.2)); padding: 0.5rem; border-radius: var(--radius-md);">
                <div>• Harina (50g): $${costHarina.toFixed(3)}</div>
                <div>• Margarina (5g): $${costMargarina.toFixed(3)}</div>
                <div>• ${fillingName} (${fillingGrams}g): $${fillingCost.toFixed(3)}</div>
                <div>• Aceite de Fritura (15ml): $${costAceite.toFixed(3)}</div>
            </div>
        `;
    } else {
        // Fallback for non-pastelito items (drinks/cakes)
        unitProductionCost = sellPrice * 0.40; // 40% estimated cost basis
        ingredientBreakdownHtml = `
            <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 0.5rem; background: var(--v-0-0-0-2, rgba(0, 0, 0, 0.2)); padding: 0.5rem; border-radius: var(--radius-md);">
                • Costo estimado de adquisición/elaboración: $${unitProductionCost.toFixed(2)}
            </div>
        `;
    }

    } // end of the product.cost > 0 / recipe-estimate branch

    const netProfitPerUnit = Math.max(0, sellPrice - unitProductionCost);
    const netProfitBs = netProfitPerUnit * bcv;
    const profitMarginPct = unitProductionCost > 0 ? ((netProfitPerUnit / unitProductionCost) * 100) : 0;

    // Tray of 25 items calculation
    const trayProfitUsd = netProfitPerUnit * 25;
    const trayProfitBs = trayProfitUsd * bcv;
    const trayCostUsd = unitProductionCost * 25;
    const trayRevenueUsd = sellPrice * 25;

    resultsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.85rem;">

            <div style="text-align: center;">${costSourceHtml}</div>

            <!-- Main Metrics Cards Grid -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem;">
                <!-- Cost Card -->
                <div style="background: rgba(239, 68, 68, 0.1); border: 1.5px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-lg); padding: 0.6rem; text-align: center;">
                    <div style="font-size: 9px; font-weight: 800; color: var(--color-danger); text-transform: uppercase;">Costo Producción</div>
                    <div style="font-size: 1.15rem; font-weight: 900; color: var(--color-danger); margin-top: 2px; font-family: var(--font-mono);">$${unitProductionCost.toFixed(2)}</div>
                    <div style="font-size: 9px; color: var(--color-text-muted);">Bs. ${(unitProductionCost * bcv).toFixed(2)}</div>
                </div>

                <!-- Net Profit Card -->
                <div style="background: rgba(16, 185, 129, 0.1); border: 1.5px solid rgba(16, 185, 129, 0.35); border-radius: var(--radius-lg); padding: 0.6rem; text-align: center;">
                    <div style="font-size: 9px; font-weight: 800; color: #10B981; text-transform: uppercase;">Ganancia Neta / Unid</div>
                    <div style="font-size: 1.15rem; font-weight: 900; color: var(--color-success); margin-top: 2px; font-family: var(--font-mono);">$${netProfitPerUnit.toFixed(2)}</div>
                    <div style="font-size: 9px; color: #10B981; font-weight: 800;">Bs. ${netProfitBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                <!-- Margin % Card -->
                <div style="background: rgba(201, 162, 74, 0.1); border: 1.5px solid rgba(201, 162, 74, 0.35); border-radius: var(--radius-lg); padding: 0.6rem; text-align: center;">
                    <div style="font-size: 9px; font-weight: 800; color: var(--color-gold); text-transform: uppercase;">Rendimiento</div>
                    <div style="font-size: 1.15rem; font-weight: 900; color: var(--color-gold); margin-top: 2px; font-family: var(--font-mono);">${profitMarginPct.toFixed(0)}%</div>
                    <div style="font-size: 9px; color: var(--color-text-muted);">Margen sobre costo</div>
                </div>
            </div>

            <!-- Tray of 25 units Summary Box -->
            <div style="background: linear-gradient(135deg, rgba(243,198,63,0.15) 0%, rgba(16,185,129,0.15) 100%); border: 1px solid var(--color-gold); border-radius: var(--radius-lg); padding: 0.75rem;">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 0.4rem; margin-bottom: 0.5rem;">
                    <span style="font-size: 11px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; display: flex; align-items: center; gap: 0.35rem;">
                        <i class="fa-solid fa-layer-group"></i> Rendimiento por Lote (Bandeja 25 pzs)
                    </span>
                    <span style="font-size: 10px; font-weight: 900; color: #10B981;">+$${trayProfitUsd.toFixed(2)} Netos</span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; text-align: center; font-size: 10px;">
                    <div>
                        <span style="color: var(--color-text-muted); display: block;">Venta Total (25)</span>
                        <b style="font-size: 11px; color: white;">$${trayRevenueUsd.toFixed(2)}</b>
                    </div>
                    <div>
                        <span style="color: var(--color-text-muted); display: block;">Inversión Costo</span>
                        <b style="font-size: 11px; color: var(--color-danger);">$${trayCostUsd.toFixed(2)}</b>
                    </div>
                    <div>
                        <span style="color: var(--color-text-muted); display: block;">Ganancia Limpia</span>
                        <b style="font-size: 11px; color: var(--color-success);">Bs. ${trayProfitBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                    </div>
                </div>
            </div>

            <!-- Ingredients Breakdown -->
            <div>
                <div style="font-size: 10px; font-weight: 800; color: var(--color-gold); text-transform: uppercase;">📋 Desglose de Receta por Pieza:</div>
                ${ingredientBreakdownHtml}
            </div>

        </div>
    `;
}

/**
 * Renders the users management list in the Admin section
 * @param {Array} users List of system users
 * @param {Function} onEdit Callback to edit user
 * @param {Function} onDelete Callback to delete user
 */
function renderUsersManagement(users, onEdit, onDelete) {
    const container = document.getElementById('users-management-list');
    if (!container) return;

    if (!users || users.length === 0) {
        container.innerHTML = `<div style="font-size: 11px; color: var(--color-text-muted); text-align: center; padding: 0.5rem;">No hay usuarios registrados.</div>`;
        return;
    }

    container.innerHTML = users.map(u => {
        const roleKey = (u.role || '').toLowerCase();
        const userKey = (u.username || '').toLowerCase();
        const isAdmin = roleKey === 'admin' || userKey.includes('admin');
        const isCocina = roleKey === 'cocina' || userKey.includes('cocina');
        const roleLabel = isAdmin ? '👑 Admin' : (isCocina ? '👨‍🍳 Cocina' : '🥖 Ventas');
        const roleColor = isAdmin ? 'var(--color-gold)' : (isCocina ? '#F97316' : '#3B82F6');
        const isActive = u.active !== false;

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.6rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; opacity: ${isActive ? '1' : '0.55'};">
                <div>
                    <div style="font-size: 0.78rem; font-weight: 800; color: #FFF; display: flex; align-items: center; gap: 0.3rem;">
                        <span>${escapeHtml(u.name || u.username)}</span>
                        <span style="font-size: 9px; font-weight: 900; padding: 1px 5px; border-radius: 10px; background: rgba(255,255,255,0.1); color: ${roleColor};">${roleLabel}</span>
                        ${!isActive ? `<span style="font-size: 9px; font-weight: 900; padding: 1px 5px; border-radius: 10px; background: rgba(239,68,68,0.2); color: var(--color-danger);">DESACTIVADO</span>` : ''}
                    </div>
                    <div style="font-size: 10px; color: var(--color-text-muted); font-family: monospace;">
                        Usuario: <strong style="color: var(--color-gold);">${escapeHtml(u.username)}</strong> | Autenticación: <span style="color: var(--color-success);">Supabase Auth (Protegido)</span>
                    </div>
                </div>
                <div style="display: flex; gap: 0.3rem;">
                    <button class="btn-edit-user" data-id="${u.id}" style="padding: 0.2rem 0.4rem; border-radius: 4px; border: none; background: rgba(59,130,246,0.2); color: #60A5FA; cursor: pointer; font-size: 0.7rem;">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    ${u.username !== 'admin' && isActive ? `
                    <button class="btn-delete-user" data-id="${u.id}" title="Desactivar usuario" style="padding: 0.2rem 0.4rem; border-radius: 4px; border: none; background: rgba(239,68,68,0.2); color: var(--color-danger); cursor: pointer; font-size: 0.7rem;">
                        <i class="fa-solid fa-user-slash"></i>
                    </button>` : ''}
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.btn-edit-user').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const user = users.find(u => u.id === id);
            if (user && typeof onEdit === 'function') onEdit(user);
        });
    });

    container.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            if (typeof onDelete === 'function') onDelete(id);
        });
    });
}
