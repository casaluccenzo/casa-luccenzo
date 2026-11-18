// Vista Local (caja): despachos pendientes, grilla de productos e indicadores.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Render pending dispatches (en camino) at the top of local display
 * @param {Array} replenishments Current replenishments list
 * @param {Function} onConfirm Callback when user clicks "Recibido"
 */
function renderPendingDispatches(replenishments, onConfirm) {
    const container = document.getElementById('dispatch-container');
    if (!container) return;

    const pending = replenishments.filter(r => r.status === 'en_camino');
    if (pending.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="dispatch-card">
            <div class="dispatch-card-header">
                <span class="dispatch-card-title">
                    <i class="fa-solid fa-truck-ramp-box animate-pulse"></i> ¡Envío en camino desde la cocina!
                </span>
            </div>
            <ul class="dispatch-list">
                ${pending.map(p => `<li>${p.amount} ${p.unit} de <strong>${p.name}</strong></li>`).join('')}
            </ul>
            <button class="btn-confirm-receipt" id="btn-confirm-receipt">
                <i class="fa-solid fa-square-check"></i> ¡YA LLEGÓ! CONFIRMAR RECIBIDO
            </button>
        </div>
    `;

    const confirmBtn = document.getElementById('btn-confirm-receipt');
    confirmBtn.addEventListener('click', async () => {
        // One batch, one load. Lock the button for the whole round trip so an
        // impatient double tap cannot put the same mercancía in twice.
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.6';
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> CONFIRMANDO...';
        try {
            await onConfirm();
        } finally {
            // The list re-renders on success; only a failure leaves this node
            // on screen, and then it must be usable again.
            if (document.body.contains(confirmBtn)) {
                confirmBtn.disabled = false;
                confirmBtn.style.opacity = '';
                confirmBtn.innerHTML = '<i class="fa-solid fa-square-check"></i> ¡YA LLEGÓ! CONFIRMAR RECIBIDO';
            }
        }
    });
}

/**
 * Render vitrina list items in the store view, filtered by category and search query
 * @param {Array} products Current products list
 * @param {Function} adjustStock Callback to adjust stock levels (id, amount, clickEvent)
 * @param {string} activeCategory Filter category ID
 * @param {string} searchQuery Filter text query
 */
function renderLocal(products, adjustStock, activeCategory = 'todos', searchQuery = '') {
    const listContainer = document.getElementById('inventory-list');
    if (!listContainer) return;
    products = forSale(products);

    // Render POS Quick Access Bar (Productos Frecuentes)
    const quickBarContainer = document.getElementById('pos-quick-items-list');
    if (quickBarContainer && window.SalesManager && window.SalesManager.getQuickProductsList) {
        const quickProducts = window.SalesManager.getQuickProductsList(products);
        if (quickProducts && quickProducts.length > 0) {
            quickBarContainer.innerHTML = quickProducts.map(p => `
                <button class="btn-quick-pos-item" data-id="${p.id}" style="padding: 0.35rem 0.65rem; border-radius: 8px; border: 1px solid var(--color-gold); background: rgba(201, 162, 74, 0.15); color: #FFF; font-weight: 800; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="fa-solid fa-plus-circle" style="color: var(--color-gold);"></i> ${escapeHtml(p.name)} ($${(p.price || 0).toFixed(2)})
                </button>
            `).join('');

            quickBarContainer.querySelectorAll('.btn-quick-pos-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const productId = btn.getAttribute('data-id');
                    const targetProduct = products.find(p => p.id === productId);
                    if (targetProduct) {
                        const activeAddToCart = window.handleAddToCart || ((product) => {
                            if (window.SalesManager && window.SalesManager.addToCart) {
                                window.currentCart = window.SalesManager.addToCart(window.currentCart || [], product);
                                window.UIManager.renderActiveCart(window.currentCart, window.handleAddToCart, window.handleRemoveFromCart, window.handleClearCart, window.handleCheckoutCart);
                            }
                        });
                        activeAddToCart(targetProduct);
                    }
                });
            });
        }
    }

    // Render vitrina header summary stats
    const statsContainer = document.getElementById('vitrina-summary-stats');
    if (statsContainer) {
        const pastelitoProducts = products.filter(p => p.category === 'pastelitos');
        const totalStock = pastelitoProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
        const totalMax = pastelitoProducts.reduce((sum, p) => sum + (p.max || 0), 0);
        const totalCritical = pastelitoProducts.filter(p => p.stock <= p.min).length;

        statsContainer.innerHTML = `
            <div class="vitrina-stat-badge gold">
                <i class="fa-solid fa-cookie-bite"></i> 
                <span>Total Vitrina: <strong>${totalStock} / ${totalMax}</strong> piezas</span>
            </div>
            ${totalCritical > 0 ? `
                <div class="vitrina-stat-badge" style="border-color: rgba(239,68,68,0.4); color: var(--color-danger);">
                    <i class="fa-solid fa-triangle-exclamation"></i> 
                    <span>Críticos: <strong>${totalCritical}</strong></span>
                </div>
            ` : `
                <div class="vitrina-stat-badge success">
                    <i class="fa-solid fa-circle-check"></i> 
                    <span>Vitrina Llena</span>
                </div>
            `}
        `;
    }
    
    if (activeCategory === 'personal') {
        renderStaffMeals(products, listContainer, searchQuery);
        return;
    }

    renderCombosBar(products);

    listContainer.innerHTML = '';

    // Apply category filter
    let filteredProducts = activeCategory === 'todos' 
        ? products 
        : products.filter(p => {
            const cat = (window.StorageManager && window.StorageManager.getProductCategory) 
                ? window.StorageManager.getProductCategory(p) 
                : (p.category || 'pastelitos');
            return cat === activeCategory;
        });

    // Apply search filter
    if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase().trim();
        filteredProducts = filteredProducts.filter(p => p.name.toLowerCase().includes(query));
    }

    if (filteredProducts.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.875rem; padding: 2rem 0;">
                No se encontraron productos.
            </div>
        `;
        return;
    }

    filteredProducts.forEach(product => {
        const isCritical = product.stock <= product.min;
        const card = document.createElement('div');
        
        card.className = `product-card${isCritical ? ' critical' : ''}`;
        
        const alertBadge = isCritical 
            ? `<span class="badge-alert animate-pulse">¡Falta!</span>` 
            : '';
            
        const stockStyle = isCritical ? 'stock-value critical' : 'stock-value';
        // max=0 is used deliberately for items whose daily stock varies by flavor
        // (pastelería) -- there's no fixed cap to compare against, so just show the
        // count. For items with a real max, stock can still legitimately exceed it
        // (e.g. a delivery bigger than what fits on display) -- don't lose that real
        // count, just don't show a confusing "44 de 34" either.
        const hasMax = product.max > 0;
        const overMax = hasMax && product.stock > product.max;
        let stockOfMaxText;
        if (!hasMax) {
            stockOfMaxText = escapeHtml(product.unit);
        } else if (overMax) {
            stockOfMaxText = `${escapeHtml(product.unit)} <span style="opacity:.7;font-size:.85em;">(vitrina llena, máx. ${product.max})</span>`;
        } else {
            stockOfMaxText = `de ${product.max} ${escapeHtml(product.unit)}`;
        }

        // Find current quantity of this product in the active cart
        const cartItem = (window.currentCart || []).find(item => item.productId === product.id && !item.combo);
        const cartQty = cartItem ? cartItem.quantity : 0;
        const cartQtyDisplay = cartQty > 0 ? cartQty : '';

        card.innerHTML = `
            <div class="product-info">
                <div class="product-header-row">
                    <h3 class="product-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
                    ${alertBadge}
                </div>
                <p class="product-stock-desc">
                    Quedan: <span class="${stockStyle}">${product.stock}</span> ${stockOfMaxText}
                    <span style="color: var(--color-gold); margin-left: 0.5rem; font-weight: 600;">
                        ${fixedBsOf(product) > 0
                            ? `Bs. ${fixedBsOf(product).toFixed(2)}
                        <span style="font-size: 0.725rem; font-weight: 400; opacity: 0.8; margin-left: 0.25rem;">(${fixedBsOf(product) < product.price_bs ? 'promo hoy' : 'fijo'} &bull; ≈ $${(fixedBsOf(product) / (window.bcvRate || 1)).toFixed(2)})</span>`
                            : `$${(product.price || 0).toFixed(2)} 
                        <span style="font-size: 0.725rem; font-weight: 400; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${((product.price || 0) * (window.bcvRate || 1)).toFixed(2)})</span>`}
                    </span>
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 0.35rem;">
                <input type="tel" data-id="${product.id}" class="cart-qty-input" min="0" value="${cartQtyDisplay}" placeholder="0" inputmode="numeric" pattern="[0-9]*">
                ${cartQty > 0 
                    ? `<button data-id="${product.id}" data-action="increase" class="btn-touch btn-success disabled" disabled title="Ya en cuenta">✓</button>`
                    : `<button data-id="${product.id}" data-action="increase" class="btn-touch btn-success" title="Agregar a la cuenta">+</button>`
                }
            </div>
        `;

        const btnIncrease = card.querySelector('[data-action="increase"]');
        if (btnIncrease && cartQty === 0) {
            btnIncrease.addEventListener('click', (e) => {
                adjustStock(product.id, -1, e);
            });
        }

        const qtyInput = card.querySelector('.cart-qty-input');
        if (qtyInput) {
            qtyInput.setAttribute('readonly', 'readonly');
            qtyInput.style.cursor = 'pointer';
            qtyInput.addEventListener('click', (e) => {
                e.preventDefault();
                e.target.blur();
                openQuantitySelectorModal(product, cartQty, (val) => {
                    if (window.handleCartQtyChange) {
                        window.handleCartQtyChange(product.id, val);
                    }
                });
            });
        }

        listContainer.appendChild(card);
    });

    updateKitchenBadge(products);
}

/**
 * Spawns a floating indicator anim element at the specified screen coordinates
 * @param {number} x clientX Coordinate
 * @param {number} y clientY Coordinate
 * @param {string} text Symbol to show (e.g. '-1', '+1')
 * @param {string} colorClass CSS color class (e.g. 'float-plus', 'float-minus')
 */
function spawnFloatingIndicator(x, y, text, colorClass) {
    if (x === undefined || y === undefined) return;

    const el = document.createElement('div');
    el.className = `floating-indicator ${colorClass}`;
    el.innerText = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    document.body.appendChild(el);

    // Remove element once CSS animation ends
    setTimeout(() => {
        el.remove();
    }, 800);
}

/**
 * Update the red circle indicator count on the Kitchen tab
 * @param {Array} products Current products list
 */
function updateKitchenBadge(products) {
    const neededCount = forSale(products).filter(p => p.stock < p.max).length;
    const badge = document.getElementById('kitchen-badge');
    const wsBtn = document.getElementById('btn-whatsapp-share');

    if (badge) {
        if (neededCount > 0) {
            badge.innerText = neededCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    if (wsBtn) {
        if (neededCount > 0) {
            wsBtn.classList.remove('opacity-50');
            wsBtn.style.pointerEvents = 'auto';
        } else {
            wsBtn.classList.add('opacity-50');
            wsBtn.style.pointerEvents = 'none';
        }
    }
}
