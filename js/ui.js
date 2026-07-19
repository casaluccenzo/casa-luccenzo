// UI Rendering and DOM Interactions

/**
 * Switch view tabs in the header and toggle main sections
 * @param {string} view 'local' or 'cocina' or 'fiados'
 */
function switchView(view) {
    const btnLocal = document.getElementById('btn-local');
    const btnClientes = document.getElementById('btn-clientes');
    const btnCocina = document.getElementById('btn-cocina');
    const btnFiados = document.getElementById('btn-fiados');
    const btnCambio = document.getElementById('btn-cambio');
    
    const viewLocal = document.getElementById('view-local');
    const viewClientes = document.getElementById('view-clientes');
    const viewCocina = document.getElementById('view-cocina');
    const viewFiados = document.getElementById('view-fiados');
    const viewCambio = document.getElementById('view-cambio');

    btnLocal.classList.remove('active');
    btnLocal.classList.add('inactive');
    btnLocal.setAttribute('aria-selected', 'false');

    if (btnClientes) {
        btnClientes.classList.remove('active');
        btnClientes.classList.add('inactive');
        btnClientes.setAttribute('aria-selected', 'false');
    }

    btnCocina.classList.remove('active');
    btnCocina.classList.add('inactive');
    btnCocina.setAttribute('aria-selected', 'false');

    btnFiados.classList.remove('active');
    btnFiados.classList.add('inactive');
    btnFiados.setAttribute('aria-selected', 'false');

    if (btnCambio) {
        btnCambio.classList.remove('active');
        btnCambio.classList.add('inactive');
        btnCambio.setAttribute('aria-selected', 'false');
    }

    viewLocal.classList.add('hidden');
    if (viewClientes) viewClientes.classList.add('hidden');
    viewCocina.classList.add('hidden');
    viewFiados.classList.add('hidden');
    if (viewCambio) viewCambio.classList.add('hidden');

    if (view === 'local') {
        btnLocal.classList.add('active');
        btnLocal.classList.remove('inactive');
        btnLocal.setAttribute('aria-selected', 'true');
        viewLocal.classList.remove('hidden');
    } else if (view === 'clientes') {
        if (btnClientes) {
            btnClientes.classList.add('active');
            btnClientes.classList.remove('inactive');
            btnClientes.setAttribute('aria-selected', 'true');
        }
        if (viewClientes) viewClientes.classList.remove('hidden');
    } else if (view === 'cocina') {
        btnCocina.classList.add('active');
        btnCocina.classList.remove('inactive');
        btnCocina.setAttribute('aria-selected', 'true');
        viewCocina.classList.remove('hidden');
    } else if (view === 'fiados') {
        btnFiados.classList.add('active');
        btnFiados.classList.remove('inactive');
        btnFiados.setAttribute('aria-selected', 'true');
        viewFiados.classList.remove('hidden');
    } else if (view === 'cambio') {
        if (btnCambio) {
            btnCambio.classList.add('active');
            btnCambio.classList.remove('inactive');
            btnCambio.setAttribute('aria-selected', 'true');
        }
        if (viewCambio) viewCambio.classList.remove('hidden');
    }
}

/**
 * Render search input bar
 * @param {Function} onSearchChange Callback when search query changes
 */
function renderSearchBar(onSearchChange) {
    const container = document.getElementById('search-bar-container');
    if (!container) return;

    // Do not overwrite input if already rendered to prevent focus loss
    if (container.children.length > 0) return;

    container.innerHTML = `
        <div class="search-container">
            <i class="fa-solid fa-magnifying-glass search-icon"></i>
            <input type="text" id="search-input" class="search-input" placeholder="Buscar sabor (ej: mechada)...">
        </div>
    `;

    document.getElementById('search-input').addEventListener('input', (e) => {
        onSearchChange(e.target.value);
    });
}

/**
 * Render category selector filters
 * @param {string} activeCategory Selected category ID
 * @param {Function} onCategoryChange Callback when category changes
 */
function renderCategoryFilterBar(activeCategory, onCategoryChange) {
    const container = document.getElementById('category-filter-container');
    if (!container) return;

    const categories = [
        { id: 'todos', name: 'Todo' },
        { id: 'pastelitos', name: 'Pastelitos' },
        { id: 'tortas', name: 'Tortas' },
        { id: 'bebidas', name: 'Bebidas' }
    ];

    container.innerHTML = '';
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `category-pill${activeCategory === cat.id ? ' active' : ''}`;
        btn.innerText = cat.name;
        btn.addEventListener('click', () => onCategoryChange(cat.id));
        container.appendChild(btn);
    });
}

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

    document.getElementById('btn-confirm-receipt').addEventListener('click', onConfirm);
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
    
    listContainer.innerHTML = '';

    // Apply category filter
    let filteredProducts = activeCategory === 'todos' 
        ? products 
        : products.filter(p => p.category === activeCategory);

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

        // Find current quantity of this product in the active cart
        const cartItem = (window.currentCart || []).find(item => item.productId === product.id);
        const cartQty = cartItem ? cartItem.quantity : 0;
        const cartQtyDisplay = cartQty > 0 ? cartQty : '';

        card.innerHTML = `
            <div class="product-info">
                <div class="product-header-row">
                    <h3 class="product-name" title="${product.name}">${product.name}</h3>
                    ${alertBadge}
                </div>
                <p class="product-stock-desc">
                    Quedan: <span class="${stockStyle}">${product.stock}</span> de ${product.max} ${product.unit} 
                    <span style="color: var(--color-gold); margin-left: 0.5rem; font-weight: 600;">
                        $${(product.price || 0).toFixed(2)} 
                        <span style="font-size: 0.725rem; font-weight: 400; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${((product.price || 0) * (window.bcvRate || 1)).toFixed(2)})</span>
                    </span>
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 0.35rem;">
                <button data-id="${product.id}" data-action="decrease" class="btn-touch btn-danger" title="Vender 1">-</button>
                <input type="number" data-id="${product.id}" class="cart-qty-input" min="0" value="${cartQtyDisplay}" placeholder="0" inputmode="numeric" pattern="[0-9]*">
                <button data-id="${product.id}" data-action="increase" class="btn-touch btn-success" title="Sumar 1">+</button>
            </div>
        `;

        card.querySelector('[data-action="decrease"]').addEventListener('click', (e) => {
            adjustStock(product.id, -1, e);
        });

        card.querySelector('[data-action="increase"]').addEventListener('click', (e) => {
            adjustStock(product.id, 1, e);
        });

        const qtyInput = card.querySelector('.cart-qty-input');
        if (qtyInput) {
            qtyInput.addEventListener('change', (e) => {
                let val = parseInt(e.target.value);
                if (isNaN(val) || val < 0) val = 0;
                if (window.handleCartQtyChange) {
                    window.handleCartQtyChange(product.id, val);
                }
            });
            qtyInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.target.blur();
                }
            });
            qtyInput.addEventListener('focus', (e) => {
                e.target.select();
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
    const neededCount = products.filter(p => p.stock < p.max).length;
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

/**
 * Render the orders needed to be cooked in the kitchen view, including raw ingredients
 * @param {Array} products Current products list
 * @param {Function} deliverProduct Callback when product is filled (id)
 * @param {Array} replenishments Dispatches list to show pending
 */
function renderCocina(products, deliverProduct, replenishments = []) {
    const container = document.getElementById('kitchen-orders-container');
    if (!container) return;

    if (!window.currentKitchenTab) {
        window.currentKitchenTab = 'stock';
    }

    const alertBanner = document.getElementById('kitchen-alert-banner');
    if (alertBanner) {
        const hasCritical = products.some(p => p.stock <= p.min);
        if (hasCritical) {
            alertBanner.classList.remove('hidden');
        } else {
            alertBanner.classList.add('hidden');
        }
    }

    const neededItems = products.filter(p => p.stock < p.max);
    const pendingDispatches = replenishments.filter(r => r.status === 'en_camino');

    // Generate HTML for Stock tab (Cargar Stock)
    let stockHtml = `
        <p class="kitchen-notice" style="margin-bottom: 1rem;">
            🥖 Carga el stock disponible en la vitrina para iniciar la jornada.
        </p>
        <div style="display: flex; flex-direction: column; gap: 1.25rem;">
    `;

    const categories = {
        'pastelitos': { name: 'Pastelitos', icon: 'fa-cookie', color: '#FFB085' },
        'bebidas': { name: 'Bebidas (Refrescos)', icon: 'fa-bottle-water', color: '#8BE8CB' },
        'tortas': { name: 'Tortas', icon: 'fa-cake-slice', color: '#FFAAA6' },
        'otros': { name: 'Otros', icon: 'fa-boxes-stacked', color: '#D4A373' }
    };

    const groupedProducts = {};
    products.forEach(p => {
        const cat = p.category || 'otros';
        if (!groupedProducts[cat]) groupedProducts[cat] = [];
        groupedProducts[cat].push(p);
    });

    Object.entries(categories).forEach(([catKey, catMeta]) => {
        const items = groupedProducts[catKey] || [];
        if (items.length === 0) return;

        stockHtml += `
            <div class="card-pantry" style="padding: 1rem; border-color: rgba(255, 255, 255, 0.05); background: rgba(10, 15, 30, 0.4);">
                <h4 style="font-size: 11px; font-weight: 900; color: ${catMeta.color}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="fa-solid ${catMeta.icon}"></i> ${catMeta.name}
                </h4>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        `;

        items.forEach(p => {
            stockHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; font-size: 0.85rem; color: var(--color-white); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name}</div>
                        <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 0.15rem;">
                            Stock: <strong style="color: ${p.stock <= p.min ? 'var(--color-danger)' : 'var(--color-success)'};">${p.stock}</strong> / Max: ${p.max} ${p.unit || 'unid.'}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                        <!-- Set to Max shortcut button -->
                        <button class="btn-set-max" data-id="${p.id}" data-max="${p.max}" style="height: 28px; padding: 0 0.5rem; font-size: 9px; font-weight: 800; border-radius: 4px; border: 1px solid rgba(212,175,55,0.3); background: rgba(212,175,55,0.05); color: var(--color-gold); cursor: pointer; transition: all 0.2s;" title="Fijar al Máximo">
                            Max (${p.max})
                        </button>
                        <!-- Minus button -->
                        <button class="btn-qty-minus" data-id="${p.id}" style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.02); color: var(--color-white); cursor: pointer;">-</button>
                        <!-- Input -->
                        <input type="number" class="input-stock-val" id="input-stock-${p.id}" data-id="${p.id}" value="${p.stock}" min="0" max="999" style="width: 38px; height: 28px; text-align: center; font-size: 0.8rem; font-weight: 800; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.2); color: var(--color-white); outline: none; -moz-appearance: textfield; padding: 0;">
                        <!-- Plus button -->
                        <button class="btn-qty-plus" data-id="${p.id}" style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.02); color: var(--color-white); cursor: pointer;">+</button>
                        <!-- Save button -->
                        <button class="btn-save-stock" data-id="${p.id}" style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 4px; border: none; background-color: var(--color-success); color: #000000; cursor: pointer; transition: all 0.2s;" title="Actualizar en Vitrina">
                            <i class="fa-solid fa-check"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        stockHtml += `
                </div>
            </div>
        `;
    });

    stockHtml += `</div>`;

    // Render Container structure with sub-tabs
    container.innerHTML = `
        <div class="sub-switch-nav" id="kitchen-sub-nav" role="tablist" style="display: flex; gap: 0.25rem; background-color: rgba(0, 0, 0, 0.3); padding: 0.25rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05); margin-bottom: 1rem;">
            <button class="${window.currentKitchenTab === 'stock' ? 'active' : 'inactive'}" id="btn-kitchen-stock" role="tab" style="flex: 1; height: 32px; border-radius: 6px; font-size: 0.75rem; font-weight: 800; border: none; cursor: pointer; transition: all 0.2s;">
                <i class="fa-solid fa-boxes-stacked"></i> Cargar Stock
            </button>
            <button class="${window.currentKitchenTab === 'todo' ? 'active' : 'inactive'}" id="btn-kitchen-todo" role="tab" style="flex: 1; height: 32px; border-radius: 6px; font-size: 0.75rem; font-weight: 800; border: none; cursor: pointer; transition: all 0.2s;">
                <i class="fa-solid fa-fire-burner"></i> Por Cocinar / Reponer
            </button>
        </div>

        <div id="kitchen-tab-content"></div>
    `;

    // Bind sub-navigation button events
    const btnStock = document.getElementById('btn-kitchen-stock');
    const btnTodo = document.getElementById('btn-kitchen-todo');
    const contentDiv = document.getElementById('kitchen-tab-content');

    if (btnStock && btnTodo && contentDiv) {
        btnStock.addEventListener('click', () => {
            window.currentKitchenTab = 'stock';
            renderCocina(products, deliverProduct, replenishments);
        });

        btnTodo.addEventListener('click', () => {
            window.currentKitchenTab = 'todo';
            renderCocina(products, deliverProduct, replenishments);
        });

        if (window.currentKitchenTab === 'stock') {
            contentDiv.innerHTML = stockHtml;

            // Bind stock control buttons
            contentDiv.querySelectorAll('.btn-qty-minus').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    const input = document.getElementById(`input-stock-${id}`);
                    if (input) {
                        const val = Math.max(0, parseInt(input.value) - 1);
                        input.value = val;
                    }
                });
            });

            contentDiv.querySelectorAll('.btn-qty-plus').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    const input = document.getElementById(`input-stock-${id}`);
                    if (input) {
                        const val = parseInt(input.value) + 1;
                        input.value = val;
                    }
                });
            });

            contentDiv.querySelectorAll('.btn-set-max').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    const maxVal = btn.getAttribute('data-max');
                    const input = document.getElementById(`input-stock-${id}`);
                    if (input) {
                        input.value = maxVal;
                    }
                });
            });

            contentDiv.querySelectorAll('.btn-save-stock').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    const input = document.getElementById(`input-stock-${id}`);
                    if (input && window.updateProductStockDirect) {
                        window.updateProductStockDirect(id, parseInt(input.value) || 0);
                    }
                });
            });
        } else {
            // Render traditional todo list
            if (neededItems.length === 0) {
                let dispatchesHtml = '';
                if (pendingDispatches.length > 0) {
                    dispatchesHtml = `
                        <div class="recipe-container" style="border-color: var(--color-success-border); margin-top: 1.5rem;">
                            <h4 class="recipe-title" style="color: var(--color-success);"><i class="fa-solid fa-truck-fast"></i> En Camino al Local:</h4>
                            <div style="font-size: 0.75rem; color: #E2E8F0; line-height: 1.6;">
                                ${pendingDispatches.map(d => `• <strong>${d.amount}</strong> ${d.unit} de <strong>${d.name}</strong> (Esperando recibo)`).join('<br>')}
                            </div>
                        </div>
                    `;
                }

                contentDiv.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">
                            <i class="fa-solid fa-circle-check"></i>
                        </div>
                        <h3 class="empty-state-title">¡Todo Completo!</h3>
                        <p class="empty-state-subtitle">El local tiene pastelitos suficientes de todo. ¡A descansar un ratico!</p>
                    </div>
                    ${dispatchesHtml}
                `;
                return;
            }

            contentDiv.innerHTML = `
                <p class="kitchen-notice">
                    📢 Cocinar las cantidades indicadas abajo y enviarlas al local.
                </p>
                <div style="display: flex; flex-direction: column; gap: 1rem;" id="kitchen-list"></div>
            `;

            const list = document.getElementById('kitchen-list');

            neededItems.forEach(item => {
                const amountNeeded = item.max - item.stock;
                const isDispatched = pendingDispatches.some(d => d.productId === item.id);

                const row = document.createElement('div');
                row.className = "kitchen-card";
                
                row.innerHTML = `
                    <div class="kitchen-card-header">
                        <div>
                            <h3 class="product-name" style="font-size: 1.125rem;">${item.name}</h3>
                            <p class="stock-value critical" style="font-size: 0.75rem; margin-top: 0.25rem;">
                                Solo quedan ${item.stock} en la vitrina.
                            </p>
                        </div>
                        <div class="kitchen-amount-needed">
                            <span class="kitchen-amount-label">Falta Cocinar:</span>
                            <span class="kitchen-amount-val">
                                ${amountNeeded} <span class="kitchen-amount-unit">${item.unit}</span>
                            </span>
                        </div>
                    </div>
                    ${isDispatched 
                        ? `<div style="text-align: center; font-size: 0.75rem; font-weight: 700; color: var(--color-success); border: 1px dashed var(--color-success); padding: 0.5rem; border-radius: var(--radius-md);">
                             <i class="fa-solid fa-truck-fast"></i> ¡Enviado! Esperando confirmación de la tienda.
                           </div>`
                        : `<button class="btn-touch btn-kitchen-deliver" title="Enviar al local">
                             <i class="fa-solid fa-truck-ramp-box"></i>
                             ¡YA LO COCINÉ Y LO ENVIÉ!
                           </button>`
                    }
                `;

                if (!isDispatched) {
                    row.querySelector('.btn-kitchen-deliver').addEventListener('click', () => {
                        deliverProduct(item.id);
                    });
                }

                list.appendChild(row);
            });

            if (window.RecipeCalculator) {
                const ingredients = window.RecipeCalculator.calculateIngredients(neededItems);
                if (ingredients.length > 0) {
                    const recipeSection = document.createElement('div');
                    recipeSection.className = 'recipe-container';
                    recipeSection.innerHTML = `
                        <h4 class="recipe-title"><i class="fa-solid fa-scale-balanced"></i> Ingredientes para esta Tanda:</h4>
                        <div class="recipe-grid">
                            ${ingredients.map(ing => `
                                <div class="recipe-item">
                                    <span class="recipe-item-name">${ing.name}</span>
                                    <span class="recipe-item-val">${ing.amount} ${ing.unit}</span>
                                </div>
                            `).join('')}
                        </div>
                    `;
                    contentDiv.appendChild(recipeSection);
                }
            }
        }
    }
}

/**
 * Render the daily cash total card (calculates Net Cash: Sales - Expenses)
 * @param {Array} salesLog History of sales
 * @param {Array} expenses Daily expenses
 */
function renderCashRegister(salesLog, expenses = []) {
    const valueEl = document.getElementById('cash-value');
    if (!valueEl) return;

    const totalSales = salesLog.reduce((sum, sale) => sum + (sale.price || 0), 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const netCash = totalSales - totalExpenses;

    const vesCash = netCash * (window.bcvRate || 1);
    valueEl.innerHTML = `$${netCash.toFixed(2)} <span style="font-size: 0.875rem; font-weight: normal; opacity: 0.8; margin-left: 0.5rem;">(Bs. ${vesCash.toFixed(2)})</span>`;

    // Update header cash register badge
    const headerCashValEl = document.getElementById('header-cash-val');
    if (headerCashValEl) {
        headerCashValEl.textContent = `$${netCash.toFixed(2)}`;
    }
}

/**
 * Render the sales transaction log list with undo buttons
 * @param {Array} salesLog History of sales
 * @param {Function} onUndo Callback to trigger undo action (uuid)
 */
function renderSalesHistory(salesLog, onUndo, onEdit) {
    const listContainer = document.getElementById('history-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (salesLog.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.75rem; padding: 1.25rem 0;">
                No hay ventas registradas hoy.
            </div>
        `;
        return;
    }

    // Group salesLog by timestamp
    const groups = {};
    salesLog.forEach(sale => {
        let productName = sale.name;
        let clientName = '';
        const match = sale.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
        if (match) {
            productName = match[1];
            clientName = match[2];
        } else {
            productName = sale.name;
            clientName = sale.productId === 'abono' ? 'Abono Deuda' : 'Cliente';
        }
        
        const key = sale.timestamp;
        if (!groups[key]) {
            groups[key] = {
                timestamp: sale.timestamp,
                clientName: clientName,
                items: [],
                total: 0
            };
        }
        
        const existingItem = groups[key].items.find(item => item.name === productName);
        if (existingItem) {
            existingItem.quantity += 1;
            existingItem.totalPrice += sale.price;
        } else {
            groups[key].items.push({
                name: productName,
                price: sale.price,
                quantity: 1,
                totalPrice: sale.price
            });
        }
        groups[key].total += sale.price;
    });

    const groupedList = Object.values(groups).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    groupedList.forEach(group => {
        const item = document.createElement('div');
        item.className = 'history-item';

        let timeStr = '';
        try {
            const date = new Date(group.timestamp);
            timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch(e) {
            timeStr = 'Ahora';
        }

        const itemsSummary = group.items.map(it => `${it.quantity}x ${it.name}`).join(', ');

        const activeEdit = onEdit || window.handleEditSale;

        item.innerHTML = `
            <div class="history-item-desc" style="flex: 1; min-width: 0;">
                <span class="history-item-title" style="font-weight: 800; color: var(--color-gold);">
                    ${group.clientName} <span style="font-weight: normal; color: var(--color-white); font-size: 0.75rem;">(${itemsSummary})</span>
                </span>
                <span class="history-item-time">
                    ${timeStr} &bull; Total: $${group.total.toFixed(2)} 
                    <span style="opacity: 0.8; font-size: 0.675rem; margin-left: 0.25rem;">(Bs. ${(group.total * (window.bcvRate || 1)).toFixed(2)})</span>
                </span>
            </div>
            <div style="display: flex; align-items: center;">
                ${activeEdit ? `<button class="btn-modify-sale">Modificar</button>` : ''}
                <button class="btn-undo">Deshacer</button>
            </div>
        `;

        if (activeEdit) {
            const btnModify = item.querySelector('.btn-modify-sale');
            if (btnModify) {
                btnModify.addEventListener('click', () => {
                    activeEdit(group.timestamp);
                });
            }
        }

        item.querySelector('.btn-undo').addEventListener('click', () => {
            onUndo(group.timestamp);
        });

        listContainer.appendChild(item);
    });
}


/**
 * Render daily expenses ledger list
 * @param {Array} expenses List of expenses
 * @param {Function} onRemove Callback to delete an expense item (uuid)
 */
function renderExpenses(expenses, onRemove) {
    const listContainer = document.getElementById('expense-list');
    const totalEl = document.getElementById('expense-total');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const total = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    if (totalEl) totalEl.innerHTML = `$${total.toFixed(2)} <span style="font-size: 0.675rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(total * (window.bcvRate || 1)).toFixed(2)})</span>`;

    if (expenses.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.7rem; padding: 0.5rem 0;">
                No hay gastos registrados hoy.
            </div>
        `;
        return;
    }

    expenses.forEach(exp => {
        const row = document.createElement('div');
        row.className = 'expense-item';
        row.innerHTML = `
            <span class="expense-desc">${exp.description}</span>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="expense-amount">-$${exp.amount.toFixed(2)} <span style="font-size: 0.625rem; opacity: 0.75; margin-left: 0.125rem;">(Bs. ${(exp.amount * (window.bcvRate || 1)).toFixed(2)})</span></span>
                <button class="btn-undo" style="padding: 0.125rem 0.25rem; font-size: 8px;" data-action="remove-expense">&times;</button>
            </div>
        `;

        row.querySelector('[data-action="remove-expense"]').addEventListener('click', () => {
            onRemove(exp.uuid);
        });

        listContainer.appendChild(row);
    });
}

/**
 * Render the clients lists and balances in the Debts tab
 * @param {Array} debts List of customer debts
 * @param {Function} onRecordPayment Callback when a payment is processed (uuid)
 */
function renderDebts(debts, onRecordPayment) {
    const container = document.getElementById('debts-list');
    if (!container) return;

    container.innerHTML = '';

    if (debts.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.875rem; padding: 3rem 0;">
                No hay deudas anotadas en el cuaderno virtual.
            </div>
        `;
        return;
    }

    debts.forEach(debt => {
        const isDebtor = debt.amount > 0;
        const card = document.createElement('div');
        card.className = `client-card${isDebtor ? ' debtor' : ''}`;
        
        let dateStr = '';
        try {
            dateStr = new Date(debt.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
        } catch(e) {
            dateStr = 'Reciente';
        }

        card.innerHTML = `
            <div class="client-info">
                <span class="client-name">${debt.clientName}</span>
                <span class="client-debt-desc">
                    Última act: ${dateStr} ${debt.description ? `&bull; ${debt.description}` : ''}
                </span>
            </div>
            <div class="client-balance-group">
                <span class="client-balance">${isDebtor ? `$${debt.amount.toFixed(2)}` : '$0.00'}</span>
                ${isDebtor ? `<span style="font-size: 0.675rem; opacity: 0.8; font-weight: normal; margin-top: 0.125rem; margin-bottom: 0.25rem;">(Bs. ${(debt.amount * (window.bcvRate || 1)).toFixed(2)})</span>` : ''}
                ${isDebtor 
                    ? `<button class="btn-pay">Abonar / Pagar</button>` 
                    : '<span style="color: var(--color-success); font-size: 11px; font-weight: 700; margin-top: 0.25rem;">Al Día</span>'
                }
            </div>
        `;

        if (isDebtor) {
            card.querySelector('.btn-pay').addEventListener('click', () => {
                onRecordPayment(debt.uuid);
            });
        }

        container.appendChild(card);
    });
}

/**
 * Renders financial breakdown inside the Day Close Modal
 * @param {Array} salesLog History of sales
 * @param {Array} expenses Daily expenses
 */
function renderDayCloseModal(salesLog, expenses) {
    const modalBody = document.getElementById('day-close-modal-body');
    if (!modalBody) return;

    const totalSales = salesLog.reduce((sum, sale) => sum + (sale.price || 0), 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const netCash = totalSales - totalExpenses;

    const salesCount = {};
    salesLog.forEach(sale => {
        let cleanName = sale.name;
        if (sale.productId !== 'abono') {
            cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
        }
        if (!salesCount[cleanName]) {
            salesCount[cleanName] = { count: 0, total: 0 };
        }
        salesCount[cleanName].count++;
        salesCount[cleanName].total += sale.price;
    });


    let salesHtml = '';
    for (const [name, data] of Object.entries(salesCount)) {
        salesHtml += `
            <div class="summary-row">
                <span>${data.count}x ${name}</span>
                <span>$${data.total.toFixed(2)}</span>
            </div>
        `;
    }

    modalBody.innerHTML = `
        <div style="margin-bottom: 1.25rem;">
            <h4 style="font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 0.5rem; font-weight: 900; letter-spacing: 0.05em;">Ventas por Producto</h4>
            ${salesHtml || '<div style="font-size: 0.75rem; color: var(--color-text-muted); text-align: center; padding: 0.5rem 0;">No hubo ventas hoy.</div>'}
        </div>
        
        <div>
            <h4 style="font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 0.5rem; font-weight: 900; letter-spacing: 0.05em;">Resultados Financieros</h4>
            <div class="summary-row">
                <span>Ingreso por Ventas:</span>
                <span style="color: var(--color-success); font-weight: 700;">+$${totalSales.toFixed(2)} <span style="font-size: 0.75rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(totalSales * (window.bcvRate || 1)).toFixed(2)})</span></span>
            </div>
            <div class="summary-row">
                <span>Total Gastos:</span>
                <span style="color: var(--color-danger); font-weight: 700;">-$${totalExpenses.toFixed(2)} <span style="font-size: 0.75rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(totalExpenses * (window.bcvRate || 1)).toFixed(2)})</span></span>
            </div>
            <div class="summary-row total">
                <span>Total en Caja:</span>
                <span>$${netCash.toFixed(2)} <span style="font-size: 0.825rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(netCash * (window.bcvRate || 1)).toFixed(2)})</span></span>
            </div>
        </div>
    `;
}

/**
 * Render list of products inside the admin settings modal
 * @param {Array} products Current products list
 * @param {Function} editProduct Callback to prompt editing a product (id)
 * @param {Function} deleteProduct Callback to delete a product (id)
 */
function renderSettingsProducts(products, editProduct, deleteProduct) {
    const container = document.getElementById('settings-products-list');
    if (!container) return;

    container.innerHTML = '';

    products.forEach(p => {
        const item = document.createElement('div');
        item.className = "settings-product-item";
        
        let catLabel = 'Pastelitos';
        if (p.category === 'bebidas') catLabel = 'Bebidas';
        if (p.category === 'tortas') catLabel = 'Tortas';

        item.innerHTML = `
            <div class="settings-product-info">
                <span class="settings-product-name" title="${p.name}">${p.name}</span>
                <span class="settings-product-details">
                    Precio: $${(p.price || 0).toFixed(2)} | ${catLabel} | Máx: ${p.max} | Alerta: &le;${p.min} | ${p.unit}
                </span>
            </div>
            <div class="settings-actions">
                <button class="btn-settings-action edit" data-action="edit" title="Editar">
                    <i class="fa-solid fa-pen" style="font-size: 10px;"></i>
                </button>
                <button class="btn-settings-action delete" data-action="delete" title="Eliminar">
                    <i class="fa-solid fa-trash-can" style="font-size: 10px;"></i>
                </button>
            </div>
        `;

        item.querySelector('[data-action="edit"]').addEventListener('click', () => {
            editProduct(p.id);
        });
        
        item.querySelector('[data-action="delete"]').addEventListener('click', () => {
            deleteProduct(p.id);
        });

        container.appendChild(item);
    });
}

/**
 * Toggle admin settings modal visibility
 * @param {boolean} show Open or close
 * @param {Array} products Optional products list to render if opening
 * @param {Function} editProduct Callback for editing a product
 * @param {Function} deleteProduct Callback for deleting a product
 */
function toggleSettingsModal(show, products, editProduct, deleteProduct) {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    if (show) {
        modal.classList.remove('hidden');
        if (products) {
            renderSettingsProducts(products, editProduct, deleteProduct);
        }
    } else {
        modal.classList.add('hidden');
    }
}

/**
 * Show a sleek toast message at the bottom of the screen
 * @param {string} message Text to display
 * @param {string} iconClass FontAwesome class list (e.g. 'fa-solid fa-circle-check')
 */
function showToast(message, iconClass) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');

    if (!toast || !toastMessage || !toastIcon) return;

    toastMessage.innerText = message;
    toastIcon.innerHTML = `<i class="${iconClass}"></i>`;

    toast.classList.add('show');

    const hideTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3500);

    toast.onclick = () => {
        clearTimeout(hideTimeout);
        toast.classList.remove('show');
    };
}

// ================= NEW ACCESSIBILITY & SECURITY FUNCTIONS =================

/**
 * Binds the click handlers for the PIN keypad overlay
 * @param {Function} onPINValid Validation callback (returns true if valid)
 */
function initPinKeypad(onPINValid) {
    const input = document.getElementById('pin-input');
    if (!input) return;

    input.value = '';
    
    // Create clone and replace to clear old event listeners
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('input', (e) => {
        const val = newInput.value;
        
        if (val.length === 4) {
            setTimeout(() => {
                const isValid = onPINValid(val);
                if (!isValid) {
                    newInput.value = '';
                }
            }, 100);
        }
    });

    // Tap overlay anywhere to focus
    const overlay = document.getElementById('pin-overlay');
    if (overlay) {
        overlay.onclick = () => {
            newInput.focus();
        };
    }

    // Auto-focus input
    setTimeout(() => {
        newInput.focus();
    }, 300);
}

/**
 * Update the connection status dot
 * @param {'online' | 'local' | 'offline'} status Status mode
 */
function updateConnectionStatus(status) {
    const dot = document.getElementById('conn-status');
    if (!dot) return;

    dot.className = `conn-status ${status}`;
    
    let title = 'Sincronizado con base de datos (En vivo)';
    if (status === 'local') title = 'Modo Local Activo (Sin Base de Datos)';
    if (status === 'offline') title = 'Sin Internet / Guardando cambios localmente';

    dot.setAttribute('title', title);
}

/**
 * Render ingredients pantry stock levels inside the kitchen view
 * @param {Array} ingredients Current ingredients stock
 * @param {Function} onAddStock Callback when clicked "Comprar" to add stock
 */
function renderIngredientsPantry(ingredients, onAddStock) {
    const container = document.getElementById('kitchen-orders-container');
    if (!container) return;

    let pantry = document.getElementById('kitchen-pantry-card');
    if (!pantry) {
        pantry = document.createElement('div');
        pantry.id = 'kitchen-pantry-card';
        pantry.className = 'ingredient-list-card';
        container.appendChild(pantry);
    }

    pantry.innerHTML = `
        <h4 class="recipe-title" style="margin-bottom: 0.5rem;"><i class="fa-solid fa-warehouse"></i> Inventario en Alacena:</h4>
        <div style="display: flex; flex-direction: column;">
            ${ingredients.map(ing => {
                const isLow = ing.stock <= (ing.id === 'harina' ? 5.0 : 2.0);
                const stockClass = isLow ? 'ingredient-stock-val low' : 'ingredient-stock-val';
                return `
                    <div class="ingredient-row">
                        <div class="ingredient-info">
                            <span class="ingredient-name">${ing.name}</span>
                            <span class="ingredient-stock">
                                Quedan: <span class="${stockClass}">${parseFloat(ing.stock).toFixed(1)} ${ing.unit}</span>
                            </span>
                        </div>
                        <button class="btn-add-stock" data-id="${ing.id}">
                            <i class="fa-solid fa-plus"></i> Comprar
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    pantry.querySelectorAll('.btn-add-stock').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            onAddStock(id);
        });
    });
}

/**
 * Render weekly statistics inside the Admin panel
 * @param {Array} salesLog History of sales
 * @param {Array} expenses Daily expenses list
 */
function renderStats(salesLog, expenses = []) {
    const container = document.getElementById('stats-chart-content');
    if (!container) return;

    // 1. Calculate daily income for last 7 days
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0,0,0,0);
        last7Days.push({
            date: d,
            label: d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }),
            income: 0
        });
    }

    salesLog.forEach(sale => {
        const saleDate = new Date(sale.timestamp);
        last7Days.forEach(day => {
            const dayEnd = new Date(day.date);
            dayEnd.setHours(23,59,59,999);
            if (saleDate >= day.date && saleDate <= dayEnd) {
                day.income += sale.price || 0;
            }
        });
    });

    const maxIncome = Math.max(...last7Days.map(d => d.income), 1.0);

    let barsHtml = '';
    last7Days.forEach(day => {
        const pct = (day.income / maxIncome) * 100;
        barsHtml += `
            <div class="chart-bar-row">
                <span class="chart-bar-label">${day.label}</span>
                <div class="chart-bar-track">
                    <div class="chart-bar-fill" style="width: ${pct}%"></div>
                </div>
                <span class="chart-bar-val">$${day.income.toFixed(1)}</span>
            </div>
        `;
    });

    // 2. Best-selling flavors
    const productCounts = {};
    salesLog.forEach(sale => {
        if (sale.productId !== 'abono') {
            const cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
            productCounts[cleanName] = (productCounts[cleanName] || 0) + 1;
        }
    });


    const topProducts = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    let topHtml = '';
    if (topProducts.length > 0) {
        topHtml = `
            <div style="margin-top: 1rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.75rem;">
                <h5 style="font-size: 10px; font-weight: 800; color: var(--color-gold); text-transform: uppercase; margin-bottom: 0.5rem;">Favoritos de la Semana</h5>
                ${topProducts.map(([name, count], index) => `
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 0.25rem;">
                        <span>${index+1}. ${name}</span>
                        <span style="font-weight: 700; color: var(--color-gold);">${count} vendid.</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // 3. Combined net profit
    const totalIncome = salesLog.reduce((sum, s) => sum + (s.price || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalIncome - totalExpenses;

    container.innerHTML = `
        <div style="margin-bottom: 0.75rem;">
            ${barsHtml}
        </div>
        
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 700; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.5rem; margin-top: 0.5rem;">
            <span>Total Ventas:</span>
            <span style="color: var(--color-success);">+$${totalIncome.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 700; margin-top: 0.25rem;">
            <span>Gastos:</span>
            <span style="color: var(--color-danger);">-$${totalExpenses.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 800; color: var(--color-gold); margin-top: 0.25rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.25rem;">
            <span>Ganancia Neta:</span>
            <span>$${netProfit.toFixed(2)}</span>
        </div>
        
        ${topHtml}
    `;
}

/**
 * Render quick conversion table for common bills
 */
function renderQuickConversionTable() {
    const container = document.getElementById('conversion-quick-table');
    if (!container) return;
    
    container.innerHTML = '';
    const bills = [1, 2, 5, 10, 20, 50, 100];
    
    bills.forEach(usd => {
        const ves = usd * (window.bcvRate || 1);
        const row = document.createElement('div');
        row.className = 'summary-row';
        row.style.padding = '0.375rem 0';
        row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        row.innerHTML = `
            <span style="font-weight: 700; color: var(--color-white); font-size: 0.8125rem;">$${usd.toFixed(2)} USD</span>
            <span style="color: var(--color-gold); font-weight: 800; font-size: 0.8125rem;">Bs. ${ves.toFixed(2)} VES</span>
        `;
        container.appendChild(row);
    });
}

/**
 * Render active customer account / cart card
 * @param {Array} cart Current items in cart
 * @param {Function} onAdd Callback to add 1 quantity
 * @param {Function} onRemove Callback to remove 1 quantity
 * @param {Function} onClear Callback to empty the cart
 * @param {Function} onCheckout Callback to checkout
 */
function renderActiveCart(cart, onAdd, onRemove, onClear, onCheckout) {
    const container = document.getElementById('active-cart-container');
    if (!container) return;

    if (!cart || cart.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    const totalUSD = cart.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
    const totalVES = totalUSD * (window.bcvRate || 1);

    container.innerHTML = `
        <div class="active-cart-card">
            <div class="active-cart-header">
                <span class="active-cart-title">
                    <i class="fa-solid fa-cart-shopping animate-pulse"></i> Cuenta del Cliente Activa
                </span>
                <span style="font-size: 10px; color: var(--color-gold); font-weight: bold;">
                    ${cart.reduce((sum, item) => sum + item.quantity, 0)} artículos
                </span>
            </div>
            
            <div class="cart-items-list">
                ${cart.map(item => `
                    <div class="cart-item-row">
                        <div class="cart-item-details">
                            <span class="cart-item-title">${item.name}</span>
                            <span class="cart-item-sub">
                                $${(item.price || 0).toFixed(2)} &bull; Sub: $${((item.price || 0) * item.quantity).toFixed(2)}
                            </span>
                        </div>
                        <div class="cart-item-controls">
                            <button class="btn-cart-adjust-circle minus" data-id="${item.productId}" data-action="minus">-</button>
                            <span class="cart-qty-badge">${item.quantity}</span>
                            <button class="btn-cart-adjust-circle plus" data-id="${item.productId}" data-action="plus">+</button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="cart-totals-section">
                <div class="cart-total-row">
                    <span class="cart-total-lbl">Total a Cobrar:</span>
                    <span class="cart-total-val-usd">$${totalUSD.toFixed(2)}</span>
                </div>
                <div class="cart-total-row" style="justify-content: flex-end;">
                    <span class="cart-total-val-ves">Bs. ${totalVES.toFixed(2)} VES</span>
                </div>
            </div>

            <div class="cart-actions-grid">
                <button class="btn-cart-submit" id="btn-cart-checkout">
                    <i class="fa-solid fa-hand-holding-dollar text-lg"></i> COBRAR / REGISTRAR VENTA
                </button>
                <button class="btn-cart-secondary danger-outline" id="btn-cart-clear">
                    <i class="fa-solid fa-trash-can"></i> Vaciar
                </button>
                <button class="btn-cart-secondary whatsapp-outline" id="btn-cart-share">
                    <i class="fa-brands fa-whatsapp"></i> Ticket Cliente
                </button>
            </div>
        </div>
    `;

    // Bind event listeners
    container.querySelectorAll('[data-action="minus"]').forEach(btn => {
        btn.addEventListener('click', () => {
            onRemove(btn.getAttribute('data-id'));
        });
    });

    container.querySelectorAll('[data-action="plus"]').forEach(btn => {
        btn.addEventListener('click', () => {
            onAdd(btn.getAttribute('data-id'));
        });
    });

    document.getElementById('btn-cart-checkout').addEventListener('click', onCheckout);
    document.getElementById('btn-cart-clear').addEventListener('click', onClear);
    document.getElementById('btn-cart-share').addEventListener('click', () => {
        const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        let msg = `🛒 *TICKET DE COMPRA - CASA LUCENZO*\n`;
        msg += `--------------------------------------\n`;
        cart.forEach(item => {
            msg += `• ${item.quantity}x ${item.name} - $${(item.price * item.quantity).toFixed(2)}\n`;
        });
        msg += `--------------------------------------\n`;
        msg += `💰 *TOTAL A PAGAR:* *$${total.toFixed(2)} USD*\n`;
        msg += `💵 *Tasa BCV:* ${(window.bcvRate || 1).toFixed(2)} Bs.\n`;
        msg += `🇻🇪 *Total en Bolívares:* *Bs. ${(total * (window.bcvRate || 1)).toFixed(2)} VES*\n`;
        msg += `--------------------------------------\n`;
        msg += `¡Muchas gracias por su compra! 🌟`;

        const encoded = encodeURIComponent(msg);
        window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
    });
}

/**
 * Create and show a modal dialog with options for a specific table
 */
function showTableOptionsModal(tableName, salesLog, onUndo, onEdit, onPay, products) {
    // Find active sales for this table
    const tableSales = salesLog.filter(s => {
        const match = s.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
        if (match) {
            const client = match[2];
            const isPaid = !!match[3];
            return client === tableName && !isPaid;
        }
        return false;
    });

    const isOccupied = tableSales.length > 0;
    const totalConsumed = tableSales.reduce((sum, s) => sum + (s.price || 0), 0);
    const timestamp = isOccupied ? tableSales[0].timestamp : null;

    // Create modal backdrop overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(10, 15, 30, 0.8)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '3000';
    overlay.style.padding = '1rem';
    overlay.style.boxSizing = 'border-box';
    
    // Group active items for display
    let itemsListHtml = '';
    const grouped = {};
    if (isOccupied) {
        tableSales.forEach(s => {
            const cleanName = s.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
            if (!grouped[cleanName]) {
                grouped[cleanName] = { count: 0, total: 0 };
            }
            grouped[cleanName].count++;
            grouped[cleanName].total += s.price;
        });
        
        itemsListHtml = `
            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 0.875rem; border-radius: 8px; margin: 1rem 0; font-size: 0.8rem; text-align: left; max-height: 150px; overflow-y: auto;">
                <strong style="color: var(--color-gold); display: block; margin-bottom: 0.5rem; font-size: 0.85rem; border-bottom: 1px solid rgba(212,175,55,0.2); padding-bottom: 0.25rem;">
                    <i class="fa-solid fa-receipt"></i> Consumo de la Mesa:
                </strong>
                <div style="display: flex; flex-direction: column; gap: 0.35rem; line-height: 1.4;">
                    ${Object.entries(grouped).map(([name, data]) => `
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: var(--color-white); opacity: 0.9;">${data.count}x ${name}</span>
                            <span style="font-weight: 700; color: var(--color-gold);">$${data.total.toFixed(2)}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top: 0.75rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 0.85rem; color: var(--color-white);">
                        <span>Total USD:</span>
                        <span style="color: var(--color-success); font-size: 0.95rem;">$${totalConsumed.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                        <span>Total Bs:</span>
                        <span>Bs. ${(totalConsumed * (window.bcvRate || 1)).toFixed(2)}</span>
                    </div>
                </div>
            </div>
        `;
    } else {
        itemsListHtml = `
            <div style="background: rgba(255,255,255,0.01); border: 1px dashed rgba(255,255,255,0.08); padding: 1.25rem; border-radius: 8px; margin: 1rem 0; font-size: 0.8rem; color: var(--color-text-muted);">
                <i class="fa-solid fa-circle-info" style="font-size: 1.25rem; color: var(--color-gold); display: block; margin-bottom: 0.5rem;"></i>
                Esta mesa no tiene consumos activos registrados.
            </div>
        `;
    }

    const modalBody = document.createElement('div');
    modalBody.className = 'card-pantry';
    modalBody.style.width = '100%';
    modalBody.style.maxWidth = '360px';
    modalBody.style.padding = '1.5rem';
    modalBody.style.borderRadius = '12px';
    modalBody.style.boxSizing = 'border-box';
    modalBody.style.border = '1px solid var(--color-gold)';
    modalBody.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5), 0 0 20px rgba(212,175,55,0.15)';

    modalBody.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.75rem; margin-bottom: 0.5rem;">
            <h3 style="font-family: var(--font-serif); font-weight: 900; color: var(--color-gold); font-size: 1.25rem; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-utensils"></i> ${tableName}
            </h3>
            <span style="font-size: 9px; font-weight: 800; text-transform: uppercase; padding: 0.25rem 0.5rem; border-radius: 4px; ${isOccupied ? 'background: rgba(212,175,55,0.15); border: 1px solid var(--color-gold); color: var(--color-gold);' : 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-text-muted);'}">
                ${isOccupied ? 'Ocupada' : 'Libre'}
            </span>
        </div>
        
        ${itemsListHtml}
        
        <div style="display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.25rem;">
            ${isOccupied ? `
                <button class="btn-modify-modal" style="height: 42px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s; background-color: var(--color-gold); color: #000000; width: 100%;">
                    <i class="fa-solid fa-cart-plus"></i> Comprar Más Cosas
                </button>
                <button class="btn-pay-modal" style="height: 42px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s; background-color: var(--color-success); color: #000000; width: 100%;">
                    <i class="fa-solid fa-circle-check"></i> Cerrar Venta (Pagar)
                </button>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; width: 100%;">
                    <button class="btn-share-modal" style="height: 38px; display: flex; align-items: center; justify-content: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(16,185,129,0.3); cursor: pointer; transition: all 0.2s; background-color: rgba(16,185,129,0.05); color: #A7F3D0;">
                        <i class="fa-brands fa-whatsapp"></i> Compartir
                    </button>
                    <button class="btn-detail-modal" style="height: 38px; display: flex; align-items: center; justify-content: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s; background-color: rgba(255,255,255,0.02); color: var(--color-white);">
                        <i class="fa-solid fa-eye"></i> Ver Detalle
                    </button>
                </div>
            ` : `
                <button class="btn-open-modal" style="height: 42px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s; background-color: var(--color-gold); color: #000000; width: 100%;">
                    <i class="fa-solid fa-cart-plus"></i> Abrir Mesa (Consumir)
                </button>
            `}
            <button class="btn-close-modal" style="height: 38px; display: flex; align-items: center; justify-content: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: all 0.2s; background-color: transparent; color: var(--color-text-muted); width: 100%;">
                Cancelar
            </button>
        </div>
    `;

    overlay.appendChild(modalBody);
    document.body.appendChild(overlay);

    // Event listener setup
    const closeModal = () => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    modalBody.querySelector('.btn-close-modal').addEventListener('click', closeModal);

    if (isOccupied) {
        modalBody.querySelector('.btn-modify-modal').addEventListener('click', () => {
            closeModal();
            if (onEdit) onEdit(timestamp);
        });
        modalBody.querySelector('.btn-pay-modal').addEventListener('click', () => {
            closeModal();
            if (onPay) onPay(timestamp);
        });
        modalBody.querySelector('.btn-share-modal').addEventListener('click', () => {
            closeModal();
            let msg = `*CASA LUCCENZO* 🥖\n`;
            msg += `*Ticket de Consumo* 🧾\n`;
            msg += `--------------------------------------\n`;
            msg += `👤 *Cliente/Mesa:* ${tableName}\n`;
            msg += `📅 *Fecha/Hora:* ${new Date(timestamp).toLocaleString()}\n`;
            msg += `--------------------------------------\n`;
            Object.entries(grouped).forEach(([name, data]) => {
                msg += `• ${data.count}x ${name} - $${data.total.toFixed(2)}\n`;
            });
            msg += `--------------------------------------\n`;
            msg += `💵 *Total a Pagar:* *$${totalConsumed.toFixed(2)} USD*\n`;
            msg += `💵 *Tasa BCV:* ${(window.bcvRate || 1).toFixed(2)} Bs.\n`;
            msg += `🇻🇪 *Total en Bolívares:* *Bs. ${(totalConsumed * (window.bcvRate || 1)).toFixed(2)} VES*\n`;
            msg += `--------------------------------------\n`;
            msg += `¡Muchas gracias por su compra! 🌟`;

            const encoded = encodeURIComponent(msg);
            window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
        });
        modalBody.querySelector('.btn-detail-modal').addEventListener('click', () => {
            closeModal();
            // Switch to Cuentas tab and scroll
            const btnSubCuentas = document.getElementById('btn-sub-cuentas');
            if (btnSubCuentas) btnSubCuentas.click();
            
            setTimeout(() => {
                const element = document.querySelector(`[data-client-timestamp="${timestamp}"]`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    element.style.background = 'rgba(212,175,55,0.12)';
                    setTimeout(() => {
                        element.style.background = '';
                    }, 1500);
                }
            }, 100);
        });
    } else {
        modalBody.querySelector('.btn-open-modal').addEventListener('click', () => {
            closeModal();
            sessionStorage.setItem('casa_lucenzo_editing_client_name', tableName);
            switchView('local');
            showToast(`📝 Cuenta iniciada para ${tableName}. ¡Agrega pastelitos!`, 'fa-solid fa-pen-to-square');
        });
    }
}

/**
 * Render the dedicated Clientes view
 * @param {Array} salesLog Today's sales log
 * @param {Function} onUndo Undo sale callback
 * @param {Function} onEdit Edit sale callback
 * @param {Function} onPay Pay/Close sale callback
 * @param {Array} products All products list
 */
function renderClientesView(salesLog, onUndo, onEdit, onPay, products) {
    // 1. Update Live Statistics Card
    const liveVitrinaEl = document.getElementById('live-stat-vitrina');
    const liveVendidosEl = document.getElementById('live-stat-vendidos');
    const liveVentasEl = document.getElementById('live-stat-ventas');

    // Total in vitrina: sum of all product stock (only savory pastelitos)
    const pastelitoProducts = products.filter(p => p.category === 'pastelitos');
    const totalInVitrina = pastelitoProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
    const totalMaxVitrina = pastelitoProducts.reduce((sum, p) => sum + (p.max || 0), 0);
    if (liveVitrinaEl) {
        liveVitrinaEl.textContent = `${totalInVitrina} / ${totalMaxVitrina}`;
    }

    // Total sold: count of all checked out sales (except debt payments 'abono')
    const totalPiecesSold = salesLog.filter(s => s.productId !== 'abono').length;
    if (liveVendidosEl) {
        liveVendidosEl.textContent = totalPiecesSold;
    }

    const rate = window.bcvRate || 1;

    // Total sales money
    const totalSalesMoney = salesLog.reduce((sum, s) => sum + (s.price || 0), 0);
    const totalSalesVES = totalSalesMoney * rate;
    if (liveVentasEl) {
        liveVentasEl.innerHTML = `
            <div style="font-size: 1.125rem; font-weight: 900; color: var(--color-success);">$${totalSalesMoney.toFixed(2)}</div>
            <div style="font-size: 9px; font-weight: 700; color: var(--color-text-muted); margin-top: 1px;">Bs. ${totalSalesVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        `;
    }

    // Total Real Sold (based on physical difference in vitrina: max - stock)
    const expectedSalesValue = products.reduce((sum, p) => {
        if (p.id === 'abono') return sum;
        const max = p.max || 0;
        const stock = p.stock || 0;
        const expectedQty = Math.max(0, max - stock);
        return sum + (expectedQty * (p.price || 0));
    }, 0);

    // Add any manual abonos/other non-inventory transactions recorded in salesLog
    const abonosValue = salesLog.filter(s => s.productId === 'abono').reduce((sum, s) => sum + (s.price || 0), 0);

    const totalRealMoney = expectedSalesValue + abonosValue;
    const totalRealVES = totalRealMoney * rate;
    const liveTotalRealEl = document.getElementById('live-stat-total-real');
    if (liveTotalRealEl) {
        liveTotalRealEl.innerHTML = `
            <div style="font-size: 1.125rem; font-weight: 900; color: #34D399;">$${totalRealMoney.toFixed(2)}</div>
            <div style="font-size: 9px; font-weight: 700; color: #A7F3D0; margin-top: 1px;">Bs. ${totalRealVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        `;
    }

    // Calculate category breakdowns
    let qtyPastelitos = 0, usdPastelitos = 0;
    let qtyBebidas = 0, usdBebidas = 0;
    let qtyTortas = 0, usdTortas = 0;
    let qtyOtros = 0, usdOtros = 0;

    salesLog.forEach(s => {
        if (s.productId === 'abono') {
            usdOtros += s.price || 0;
            qtyOtros++;
            return;
        }

        const product = products.find(p => p.id === s.productId);
        const category = product ? product.category : '';

        if (category === 'pastelitos') {
            qtyPastelitos++;
            usdPastelitos += s.price || 0;
        } else if (category === 'bebidas') {
            qtyBebidas++;
            usdBebidas += s.price || 0;
        } else if (category === 'tortas') {
            qtyTortas++;
            usdTortas += s.price || 0;
        } else {
            qtyOtros++;
            usdOtros += s.price || 0;
        }
    });

    // Group sales by flavor/product for dropdown details
    const categoryFlavorSales = {
        'pastelitos': {},
        'bebidas': {},
        'tortas': {},
        'otros': {}
    };

    salesLog.forEach(s => {
        if (s.productId === 'abono') {
            if (!categoryFlavorSales['otros']['abono']) {
                categoryFlavorSales['otros']['abono'] = { name: 'Abonos a Cuenta', qty: 0, usd: 0 };
            }
            categoryFlavorSales['otros']['abono'].qty++;
            categoryFlavorSales['otros']['abono'].usd += s.price || 0;
            return;
        }

        const product = products.find(p => p.id === s.productId);
        if (product) {
            const cat = product.category || 'otros';
            if (!categoryFlavorSales[cat]) categoryFlavorSales[cat] = {};
            if (!categoryFlavorSales[cat][product.id]) {
                categoryFlavorSales[cat][product.id] = {
                    name: product.name,
                    qty: 0,
                    usd: 0
                };
            }
            categoryFlavorSales[cat][product.id].qty++;
            categoryFlavorSales[cat][product.id].usd += s.price || 0;
        }
    });

    const categoriesContainer = document.getElementById('live-stat-categories');
    if (categoriesContainer) {
        const rate = window.bcvRate || 1;
        
        const formatUSD = (val) => '$' + (val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formatVES = (val) => 'Bs. ' + (val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        categoriesContainer.innerHTML = `
            <!-- Pastelitos Wrapper -->
            <div class="category-stat-wrapper">
                <div class="category-stat-row" id="pastelitos-stat-row" style="cursor: pointer; user-select: none;">
                    <div class="category-label">
                        <i class="fa-solid fa-chevron-down" style="color: var(--color-text-muted);"></i>
                        <i class="fa-solid fa-cookie" style="color: #FFB085;"></i>
                        <span>Pastelitos</span>
                    </div>
                    <div class="category-values">
                        <span class="category-qty-badge pastelitos">${qtyPastelitos} piezas</span>
                        <span class="category-price-usd">${formatUSD(usdPastelitos)}</span>
                        <span class="category-price-ves">(${formatVES(usdPastelitos * rate)})</span>
                    </div>
                </div>
                <div class="category-stat-dropdown" id="pastelitos-stat-dropdown">
                    ${Object.values(categoryFlavorSales['pastelitos']).length > 0 
                        ? Object.values(categoryFlavorSales['pastelitos'])
                            .sort((a,b) => b.qty - a.qty)
                            .map(f => `
                                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #E2E8F0; padding: 0.35rem 0; border-bottom: 1px dashed rgba(255,255,255,0.03);">
                                    <span style="font-weight: 700; color: var(--color-white);">${f.name}</span>
                                    <div style="display: flex; gap: 0.75rem; align-items: center; font-family: monospace;">
                                        <span style="color: var(--color-gold); font-weight: 800;">${f.qty} piezas</span>
                                        <span style="color: var(--color-success); font-weight: 800;">${formatUSD(f.usd)}</span>
                                    </div>
                                </div>
                            `).join('')
                        : `<div style="text-align: center; color: var(--color-text-muted); font-size: 11px; padding: 0.5rem 0;">
                             No hay ventas de pastelitos registradas hoy.
                           </div>`
                    }
                </div>
            </div>

            <!-- Bebidas Wrapper -->
            <div class="category-stat-wrapper">
                <div class="category-stat-row" id="bebidas-stat-row" style="cursor: pointer; user-select: none;">
                    <div class="category-label">
                        <i class="fa-solid fa-chevron-down" style="color: var(--color-text-muted);"></i>
                        <i class="fa-solid fa-bottle-water" style="color: #8BE8CB;"></i>
                        <span>Bebidas</span>
                    </div>
                    <div class="category-values">
                        <span class="category-qty-badge bebidas">${qtyBebidas} unid.</span>
                        <span class="category-price-usd">${formatUSD(usdBebidas)}</span>
                        <span class="category-price-ves">(${formatVES(usdBebidas * rate)})</span>
                    </div>
                </div>
                <div class="category-stat-dropdown" id="bebidas-stat-dropdown">
                    ${Object.values(categoryFlavorSales['bebidas']).length > 0 
                        ? Object.values(categoryFlavorSales['bebidas'])
                            .sort((a,b) => b.qty - a.qty)
                            .map(f => `
                                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #E2E8F0; padding: 0.35rem 0; border-bottom: 1px dashed rgba(255,255,255,0.03);">
                                    <span style="font-weight: 700; color: var(--color-white);">${f.name}</span>
                                    <div style="display: flex; gap: 0.75rem; align-items: center; font-family: monospace;">
                                        <span style="color: var(--color-gold); font-weight: 800;">${f.qty} unid.</span>
                                        <span style="color: var(--color-success); font-weight: 800;">${formatUSD(f.usd)}</span>
                                    </div>
                                </div>
                            `).join('')
                        : `<div style="text-align: center; color: var(--color-text-muted); font-size: 11px; padding: 0.5rem 0;">
                             No hay ventas de bebidas registradas hoy.
                           </div>`
                    }
                </div>
            </div>

            <!-- Tortas Wrapper -->
            <div class="category-stat-wrapper">
                <div class="category-stat-row" id="tortas-stat-row" style="cursor: pointer; user-select: none;">
                    <div class="category-label">
                        <i class="fa-solid fa-chevron-down" style="color: var(--color-text-muted);"></i>
                        <i class="fa-solid fa-cake-slice" style="color: #FFAAA6;"></i>
                        <span>Tortas</span>
                    </div>
                    <div class="category-values">
                        <span class="category-qty-badge tortas">${qtyTortas} porc.</span>
                        <span class="category-price-usd">${formatUSD(usdTortas)}</span>
                        <span class="category-price-ves">(${formatVES(usdTortas * rate)})</span>
                    </div>
                </div>
                <div class="category-stat-dropdown" id="tortas-stat-dropdown">
                    ${Object.values(categoryFlavorSales['tortas']).length > 0 
                        ? Object.values(categoryFlavorSales['tortas'])
                            .sort((a,b) => b.qty - a.qty)
                            .map(f => `
                                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #E2E8F0; padding: 0.35rem 0; border-bottom: 1px dashed rgba(255,255,255,0.03);">
                                    <span style="font-weight: 700; color: var(--color-white);">${f.name}</span>
                                    <div style="display: flex; gap: 0.75rem; align-items: center; font-family: monospace;">
                                        <span style="color: var(--color-gold); font-weight: 800;">${f.qty} porc.</span>
                                        <span style="color: var(--color-success); font-weight: 800;">${formatUSD(f.usd)}</span>
                                    </div>
                                </div>
                            `).join('')
                        : `<div style="text-align: center; color: var(--color-text-muted); font-size: 11px; padding: 0.5rem 0;">
                             No hay ventas de tortas registradas hoy.
                           </div>`
                    }
                </div>
            </div>

            <!-- Otros Wrapper -->
            ${qtyOtros > 0 ? `
            <div class="category-stat-wrapper">
                <div class="category-stat-row" id="otros-stat-row" style="cursor: pointer; user-select: none;">
                    <div class="category-label">
                        <i class="fa-solid fa-chevron-down" style="color: var(--color-text-muted);"></i>
                        <i class="fa-solid fa-money-bill-wave" style="color: #D4A373;"></i>
                        <span>Abonos/Otros</span>
                    </div>
                    <div class="category-values">
                        <span class="category-qty-badge otros">${qtyOtros} op.</span>
                        <span class="category-price-usd">${formatUSD(usdOtros)}</span>
                        <span class="category-price-ves">(${formatVES(usdOtros * rate)})</span>
                    </div>
                </div>
                <div class="category-stat-dropdown" id="otros-stat-dropdown">
                    ${Object.values(categoryFlavorSales['otros'])
                        .map(f => `
                            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #E2E8F0; padding: 0.35rem 0; border-bottom: 1px dashed rgba(255,255,255,0.03);">
                                <span style="font-weight: 700; color: var(--color-white);">${f.name}</span>
                                <div style="display: flex; gap: 0.75rem; align-items: center; font-family: monospace;">
                                    <span style="color: var(--color-gold); font-weight: 800;">${f.qty} op.</span>
                                    <span style="color: var(--color-success); font-weight: 800;">${formatUSD(f.usd)}</span>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            </div>
            ` : ''}
        `;

        // Bind toggle click handlers
        ['pastelitos', 'bebidas', 'tortas', 'otros'].forEach(cat => {
            const row = document.getElementById(`${cat}-stat-row`);
            const dropdown = document.getElementById(`${cat}-stat-dropdown`);
            if (row && dropdown) {
                row.addEventListener('click', () => {
                    row.classList.toggle('open');
                    dropdown.classList.toggle('open');
                });
            }
        });

        // 1b. Render Inventory Reconciliation (Match)
        const matchSection = document.getElementById('inventory-match-section');
        if (matchSection) {
            const auditedProducts = [];
            products.forEach(p => {
                if (p.id === 'abono') return;
                const max = p.max || 0;
                if (max === 0) return; // Ignore products that have no loaded capacity today
                
                const stock = p.stock || 0;
                const expectedSales = Math.max(0, max - stock);
                const loggedSales = salesLog.filter(s => s.productId === p.id).length;
                const discrepancy = expectedSales - loggedSales;
                
                if (discrepancy !== 0) {
                    auditedProducts.push({
                        product: p,
                        max: max,
                        stock: stock,
                        expected: expectedSales,
                        logged: loggedSales,
                        discrepancy: discrepancy,
                        value: discrepancy * (p.price || 0)
                    });
                }
            });

            if (auditedProducts.length === 0) {
                matchSection.classList.add('hidden');
                matchSection.innerHTML = '';
            } else {
                matchSection.classList.remove('hidden');
                
                const totalMissingQty = auditedProducts.reduce((sum, p) => sum + (p.discrepancy > 0 ? p.discrepancy : 0), 0);
                const totalMissingVal = auditedProducts.reduce((sum, p) => sum + (p.discrepancy > 0 ? p.value : 0), 0);
                
                let matchHtml = `
                    <h4 style="font-size: 11px; font-weight: 900; color: var(--color-success); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <span><i class="fa-solid fa-scale-balanced"></i> Conciliación de Vitrina y Caja</span>
                        ${totalMissingQty > 0 ? `
                        <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(248, 113, 113, 0.15); color: #F87171; border: 1px solid rgba(248, 113, 113, 0.2); font-weight: 800;">
                            ${totalMissingQty} unids. sin registrar
                        </span>` : ''}
                    </h4>
                    <p style="font-size: 11px; color: var(--color-text-muted); margin-bottom: 0.75rem;">
                        Hay diferencias entre las piezas vendidas físicas y los registros del sistema.
                    </p>
                    
                    <div style="display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1rem;">
                `;
                
                auditedProducts.forEach(item => {
                    const color = item.discrepancy > 0 ? '#F87171' : '#60A5FA';
                    const label = item.discrepancy > 0 ? `Faltan ${item.discrepancy} por registrar` : `Sobran ${Math.abs(item.discrepancy)} registradas`;
                    const pricePrefix = item.discrepancy > 0 ? '+' : '';
                    
                    matchHtml += `
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); padding: 0.5rem 0.75rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                            <div>
                                <div style="font-weight: bold; color: var(--color-white);">${item.product.name}</div>
                                <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 2px;">
                                    Inicial: ${item.max} | Quedan: ${item.stock} | Registrado: ${item.logged}
                                </div>
                            </div>
                            <div style="text-align: right; font-family: monospace;">
                                <div style="color: ${color}; font-weight: 800; font-size: 10px;">${label}</div>
                                <div style="color: ${item.discrepancy > 0 ? 'var(--color-success)' : 'var(--color-danger)'}; font-weight: 800; font-size: 10px; margin-top: 1px;">
                                    ${pricePrefix}$${Math.abs(item.value).toFixed(2)}
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                matchHtml += `
                    </div>
                    
                    <div style="display: flex; gap: 0.5rem; align-items: center; justify-content: space-between; background: rgba(16, 185, 129, 0.04); border: 1px solid rgba(16, 185, 129, 0.1); padding: 0.625rem; border-radius: 6px;">
                        <div>
                            <div style="font-size: 9px; color: var(--color-text-muted); text-transform: uppercase;">Caja por registrar:</div>
                            <div style="font-size: 1rem; font-weight: 900; color: var(--color-success); font-family: monospace; margin-top: 2px;">
                                +$${totalMissingVal.toFixed(2)}
                            </div>
                        </div>
                        ${totalMissingQty > 0 ? `
                        <button id="btn-reconcile-inventory" class="btn-action-small" style="background-color: var(--color-success); border-color: var(--color-success-border); color: #000000; font-weight: 900; padding: 0.4rem 0.75rem; font-size: 10px; height: auto;">
                            <i class="fa-solid fa-bolt"></i> Autocorregir Caja
                        </button>` : `
                        <span style="font-size: 10px; font-weight: 700; color: var(--color-gold);">Exceso de registros</span>`}
                    </div>
                `;
                
                matchSection.innerHTML = matchHtml;
                
                const btnReconcile = document.getElementById('btn-reconcile-inventory');
                if (btnReconcile) {
                    btnReconcile.addEventListener('click', () => {
                        if (confirm(`¿Estás seguro de registrar las ${totalMissingQty} ventas faltantes en la caja de hoy ($${totalMissingVal.toFixed(2)})?`)) {
                            if (typeof window.handleAutocorrectSales === 'function') {
                                window.handleAutocorrectSales(auditedProducts);
                            }
                        }
                    });
                }
            }
        }
    }

    // 2. Render 6 Tables Grid
    const tablesContainer = document.getElementById('tables-grid-container');
    if (tablesContainer) {
        let tablesHtml = `
            <h4 style="font-size: 11px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.35rem;">
                <i class="fa-solid fa-table-cells-large"></i> Mesas en el Local
            </h4>
            <div class="tables-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;">
        `;

        for (let t = 1; t <= 6; t++) {
            const tableName = `Mesa ${t}`;
            
            // Find if this table has any active (unpaid) entries
            const tableSales = salesLog.filter(s => {
                const match = s.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
                if (match) {
                    const client = match[2];
                    const isPaid = !!match[3];
                    return client === tableName && !isPaid;
                }
                return false;
            });

            const isOccupied = tableSales.length > 0;
            const totalConsumed = tableSales.reduce((sum, s) => sum + (s.price || 0), 0);
            
            let statusText = 'Libre';
            let statusClass = 'status-free';
            let cardStyle = 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 6px; text-align: center; cursor: pointer; transition: all 0.2s;';
            
            if (isOccupied) {
                statusText = `Ocupada ($${totalConsumed.toFixed(2)})`;
                statusClass = 'status-occupied';
                cardStyle = 'background: rgba(212,175,55,0.05); border: 1px solid var(--color-gold); padding: 0.75rem; border-radius: 6px; text-align: center; cursor: pointer; transition: all 0.2s; box-shadow: 0 0 10px rgba(212,175,55,0.1);';
            }

            tablesHtml += `
                <div class="table-card" style="${cardStyle}" data-table="${tableName}">
                    <div style="font-size: 0.75rem; font-weight: 800; color: ${isOccupied ? 'var(--color-gold)' : 'var(--color-text-muted)'};">${tableName}</div>
                    <div style="font-size: 9px; margin-top: 0.25rem; font-weight: 700;" class="${statusClass}">${statusText}</div>
                </div>
            `;
        }

        tablesHtml += `</div>`;
        tablesContainer.innerHTML = tablesHtml;

        // Add event listeners to table cards to open options modal
        tablesContainer.querySelectorAll('.table-card').forEach(card => {
            card.addEventListener('click', () => {
                const tableName = card.getAttribute('data-table');
                showTableOptionsModal(tableName, salesLog, onUndo, onEdit, onPay, products);
            });
        });
    }

    // 3. Render Clients Lists (Active vs Closed)
    const activosContainer = document.getElementById('clientes-activos-container');
    const pagadosContainer = document.getElementById('clientes-pagados-container');
    if (!activosContainer || !pagadosContainer) return;

    activosContainer.innerHTML = '';
    pagadosContainer.innerHTML = '';




    // Group salesLog by timestamp
    const groups = {};
    salesLog.forEach(sale => {
        let productName = sale.name;
        let clientName = '';
        let isPaid = false;
        let paymentMethod = '';
        
        const match = sale.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
        if (match) {
            productName = match[1];
            clientName = match[2];
            isPaid = !!match[3];
            if (isPaid && match[3]) {
                const methodMatch = match[3].match(/\(Pagado\s*-\s*(.*?)\)/);
                paymentMethod = methodMatch ? methodMatch[1] : 'Efectivo';
            }
        } else {
            productName = sale.name;
            clientName = sale.productId === 'abono' ? 'Abono Deuda' : 'Cliente';
        }
        
        const key = sale.timestamp;
        if (!groups[key]) {
            groups[key] = {
                timestamp: sale.timestamp,
                clientName: clientName,
                isPaid: isPaid,
                paymentMethod: paymentMethod,
                items: [],
                total: 0
            };
        } else {
            if (isPaid) {
                groups[key].isPaid = true;
            }
            if (paymentMethod && !groups[key].paymentMethod) {
                groups[key].paymentMethod = paymentMethod;
            }
        }
        
        const existingItem = groups[key].items.find(item => item.name === productName);
        if (existingItem) {
            existingItem.quantity += 1;
            existingItem.totalPrice += sale.price;
        } else {
            groups[key].items.push({
                name: productName,
                price: sale.price,
                quantity: 1,
                totalPrice: sale.price
            });
        }
        groups[key].total += sale.price;
    });

    const groupedList = Object.values(groups).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    let activeCount = 0;
    let paidCount = 0;

    groupedList.forEach(group => {
        const card = document.createElement('div');
        card.className = 'history-item';
        card.setAttribute('data-client-timestamp', group.timestamp);
        card.style.flexDirection = 'column';
        card.style.alignItems = 'stretch';
        card.style.gap = '0.5rem';
        card.style.padding = '0.75rem';

        let timeStr = '';
        try {
            const date = new Date(group.timestamp);
            timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch(e) {
            timeStr = 'Ahora';
        }

        const itemsSummary = group.items.map(it => `${it.quantity}x ${it.name}`).join(', ');

        const statusBadge = group.isPaid 
            ? `<span class="client-status-badge paid">Pagado (${group.paymentMethod || 'Efectivo'})</span>` 
            : `<span class="client-status-badge active">Consumiendo</span>`;

        card.innerHTML = `
            <!-- Top Row: Name and Status Badge -->
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span style="font-weight: 800; color: var(--color-gold); font-size: 0.95rem;">${group.clientName}</span>
                ${statusBadge}
            </div>
            
            <!-- Subtitle: Time and Total -->
            <div style="font-size: 11px; color: var(--color-text-muted); margin-top: -0.15rem; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span>${timeStr}</span>
                <span style="font-weight: 700; color: var(--color-white);">Total: $${group.total.toFixed(2)} <span style="font-weight: 500; font-size: 10px; color: var(--color-text-muted);">(Bs. ${(group.total * (window.bcvRate || 1)).toFixed(2)})</span></span>
            </div>
            
            <!-- Items list -->
            <div style="font-size: 11px; color: var(--color-white); opacity: 0.85; padding-top: 0.35rem; border-top: 1px solid rgba(255,255,255,0.04); margin-bottom: 0.25rem;">
                <strong>Lleva:</strong> ${itemsSummary}
            </div>
            
            <!-- Action Buttons Row -->
            <div style="display: flex; gap: 0.5rem; width: 100%; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.5rem; justify-content: flex-end;">
                <button class="btn-action-small btn-share-client" title="Compartir Ticket" style="flex: 1; height: 36px; justify-content: center; font-size: 0.75rem;">
                    <i class="fa-brands fa-whatsapp"></i> Compartir
                </button>
                ${!group.isPaid ? `
                    <button class="btn-action-small btn-modify-client" style="flex: 2; height: 36px; justify-content: center; background-color: var(--color-gold); color: var(--color-bg-navy); font-size: 0.75rem;" title="Agregar más cosas">
                        <i class="fa-solid fa-pen-to-square"></i> Modificar
                    </button>
                    <button class="btn-action-small btn-pay-client" style="flex: 2; height: 36px; justify-content: center; background-color: var(--color-success); color: var(--color-bg-navy); font-size: 0.75rem;" title="Marcar como pagada y liberar mesa">
                        <i class="fa-solid fa-circle-check"></i> Pagar
                    </button>
                ` : ''}
                <button class="btn-action-small btn-undo-client" style="height: 36px; justify-content: center; width: 40px; background-color: var(--color-danger); color: var(--color-white);" title="Deshacer y devolver stock">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
            </div>
        `;

        // Bind event listeners
        card.querySelector('.btn-share-client').addEventListener('click', () => {
            let msg = `*CASA LUCCENZO* 🥖\n`;
            msg += `*Ticket de Consumo* 🧾\n`;
            msg += `--------------------------------------\n`;
            msg += `👤 *Cliente/Mesa:* ${group.clientName}\n`;
            msg += `📅 *Fecha/Hora:* ${new Date(group.timestamp).toLocaleString()}\n`;
            msg += `--------------------------------------\n`;
            group.items.forEach(it => {
                msg += `• ${it.quantity}x ${it.name} - $${(it.price * it.quantity).toFixed(2)}\n`;
            });
            msg += `--------------------------------------\n`;
            msg += `💵 *Total a Pagar:* *$${group.total.toFixed(2)} USD*\n`;
            msg += `💵 *Tasa BCV:* ${(window.bcvRate || 1).toFixed(2)} Bs.\n`;
            msg += `🇻🇪 *Total en Bolívares:* *Bs. ${(group.total * (window.bcvRate || 1)).toFixed(2)} VES*\n`;
            msg += `--------------------------------------\n`;
            msg += `¡Muchas gracias por su compra! 🌟`;

            const encoded = encodeURIComponent(msg);
            window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
        });

        if (!group.isPaid) {
            card.querySelector('.btn-modify-client').addEventListener('click', () => {
                if (onEdit) onEdit(group.timestamp);
            });
            card.querySelector('.btn-pay-client').addEventListener('click', () => {
                if (onPay) onPay(group.timestamp);
            });
        }

        card.querySelector('.btn-undo-client').addEventListener('click', () => {
            if (onUndo) onUndo(group.timestamp);
        });

        // Split into containers
        if (group.isPaid) {
            pagadosContainer.appendChild(card);
            paidCount++;
        } else {
            activosContainer.appendChild(card);
            activeCount++;
        }
    });

    // Handle empty messages for sub-sections
    if (activeCount === 0) {
        activosContainer.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.75rem; padding: 1rem 0;">
                No hay cuentas activas (todos los clientes han pagado).
            </div>
        `;
    }
    if (paidCount === 0) {
        pagadosContainer.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.75rem; padding: 1rem 0;">
                No se han registrado cierres de cuenta hoy.
            </div>
        `;
    }
}

/**
 * Shows a modal to select the payment method for closing a sale
 * @param {string} clientName Client/Table name
 * @param {number} totalAmount Total sales amount
 * @param {Function} onSelect Callback when a payment method is selected (string)
 */
function showPaymentMethodModal(clientName, totalAmount, onSelect) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.75)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '2000';
    overlay.style.padding = '1rem';
    overlay.style.boxSizing = 'border-box';

    const rate = window.bcvRate || 1;
    const totalVes = totalAmount * rate;

    const formatUSD = (val) => '$' + (val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatVES = (val) => 'Bs. ' + (val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const modalBody = document.createElement('div');
    modalBody.className = 'card-pantry';
    modalBody.style.width = '100%';
    modalBody.style.maxWidth = '360px';
    modalBody.style.padding = '1.5rem';
    modalBody.style.borderRadius = '12px';
    modalBody.style.boxSizing = 'border-box';
    modalBody.style.border = '1px solid var(--color-gold)';
    modalBody.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5), 0 0 20px rgba(212,175,55,0.15)';
    modalBody.style.animation = 'scaleIn 0.2s ease-out';

    modalBody.innerHTML = `
        <h3 style="font-family: var(--font-serif); font-weight: 900; color: var(--color-gold); font-size: 1.15rem; margin-bottom: 0.25rem; text-align: center; text-transform: uppercase; letter-spacing: 0.03em;">
            <i class="fa-solid fa-cash-register"></i> Registrar Pago
        </h3>
        <p style="font-size: 11px; color: var(--color-text-muted); text-align: center; margin-bottom: 1rem;">
            Selecciona el método de pago para la cuenta de <strong>${clientName}</strong>
        </p>

        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 8px; margin-bottom: 1.25rem; text-align: center;">
            <div style="font-size: 10px; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Total a Cobrar</div>
            <div style="font-size: 1.6rem; font-weight: 900; color: var(--color-success); margin-top: 0.25rem; font-family: monospace;">${formatUSD(totalAmount)}</div>
            <div style="font-size: 0.85rem; color: var(--color-gold); margin-top: 0.15rem; font-weight: 700; font-family: monospace;">${formatVES(totalVes)}</div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
            <button class="btn-paymethod" data-method="Pago Móvil" style="height: 44px; display: flex; align-items: center; justify-content: flex-start; gap: 0.75rem; font-size: 0.825rem; font-weight: 800; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s; background-color: rgba(255,255,255,0.02); color: var(--color-white); padding: 0 1rem;">
                <i class="fa-solid fa-mobile-screen-button" style="color: #8BE8CB; font-size: 1.1rem; width: 1.25rem;"></i> Pago Móvil
            </button>
            <button class="btn-paymethod" data-method="Punto de Venta" style="height: 44px; display: flex; align-items: center; justify-content: flex-start; gap: 0.75rem; font-size: 0.825rem; font-weight: 800; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s; background-color: rgba(255,255,255,0.02); color: var(--color-white); padding: 0 1rem;">
                <i class="fa-solid fa-credit-card" style="color: #FFB085; font-size: 1.1rem; width: 1.25rem;"></i> Punto de Venta
            </button>
            <button class="btn-paymethod" data-method="Efectivo Bs." style="height: 44px; display: flex; align-items: center; justify-content: flex-start; gap: 0.75rem; font-size: 0.825rem; font-weight: 800; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s; background-color: rgba(255,255,255,0.02); color: var(--color-white); padding: 0 1rem;">
                <i class="fa-solid fa-money-bill-1-wave" style="color: #FFAAA6; font-size: 1.1rem; width: 1.25rem;"></i> Efectivo Bolívares
            </button>
            <button class="btn-paymethod" data-method="Efectivo $" style="height: 44px; display: flex; align-items: center; justify-content: flex-start; gap: 0.75rem; font-size: 0.825rem; font-weight: 800; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s; background-color: rgba(255,255,255,0.02); color: var(--color-white); padding: 0 1rem;">
                <i class="fa-solid fa-dollar-sign" style="color: var(--color-gold); font-size: 1.1rem; width: 1.25rem; text-align: center;"></i> Efectivo Divisas
            </button>
        </div>

        <button class="btn-cancel-paymethod" style="height: 38px; display: flex; align-items: center; justify-content: center; gap: 0.35rem; font-size: 0.75rem; font-weight: 700; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: all 0.2s; background-color: transparent; color: var(--color-text-muted); width: 100%;">
            Cancelar
        </button>
    `;

    overlay.appendChild(modalBody);
    document.body.appendChild(overlay);

    const closeModal = () => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.25s ease-out';
        setTimeout(() => {
            overlay.remove();
        }, 250);
    };

    modalBody.querySelector('.btn-cancel-paymethod').addEventListener('click', closeModal);

    modalBody.querySelectorAll('.btn-paymethod').forEach(btn => {
        btn.addEventListener('click', () => {
            const method = btn.getAttribute('data-method');
            closeModal();
            if (onSelect) onSelect(method);
        });
    });
}

/**
 * Display a full screen blur overlay when a PWA/ServiceWorker update is found/downloading
 */
function showUpdateOverlay() {
    if (document.getElementById('pwa-update-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'pwa-update-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(10, 15, 30, 0.9)';
    overlay.style.backdropFilter = 'blur(12px)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999999';
    overlay.style.transition = 'opacity 0.3s ease-in-out';
    overlay.style.color = '#FFFFFF';
    overlay.style.textAlign = 'center';
    overlay.style.padding = '2rem';
    overlay.style.boxSizing = 'border-box';

    overlay.innerHTML = `
        <div style="background: rgba(255, 255, 255, 0.02); border: 1.5px solid var(--color-gold); box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 0 30px rgba(212,175,55,0.15); max-width: 380px; padding: 2.25rem; border-radius: 16px; display: flex; flex-direction: column; align-items: center; gap: 1.25rem; transform: scale(0.9); animation: scaleIn 0.3s forwards ease-out;">
            <div id="pwa-update-icon-container" style="position: relative; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; background: rgba(212, 175, 55, 0.1); border-radius: 100px; border: 1px solid rgba(212, 175, 55, 0.3);">
                <i class="fa-solid fa-arrows-rotate fa-spin" style="color: var(--color-gold); font-size: 1.75rem;"></i>
            </div>
            <div>
                <h3 id="pwa-update-title" style="font-family: var(--font-serif); font-size: 1.2rem; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; margin-top: 0;">Cargando Actualización</h3>
                <p id="pwa-update-desc" style="font-size: 0.8rem; color: #E2E8F0; line-height: 1.5; margin: 0;">
                    Estamos instalando la versión más reciente del sistema en producción. Espera un momento por favor...
                </p>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; position: relative;">
                <div style="height: 100%; background: var(--color-gold); border-radius: 3px; width: 35%; animation: loaderProgress 1.5s infinite linear; position: absolute; left: 0;"></div>
            </div>
        </div>
        
        <style>
            @keyframes loaderProgress {
                0% { left: -35%; width: 35%; }
                50% { left: 30%; width: 40%; }
                100% { left: 100%; width: 35%; }
            }
            @keyframes pulseSuccess {
                0% { transform: scale(0.7); opacity: 0; }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); opacity: 1; }
            }
        </style>
    `;

    document.body.appendChild(overlay);
}

/**
 * Update the overlay UI state to indicate that the update has successfully completed
 */
function updateOverlayStatusSuccess() {
    const iconContainer = document.getElementById('pwa-update-icon-container');
    const title = document.getElementById('pwa-update-title');
    const desc = document.getElementById('pwa-update-desc');

    if (iconContainer) {
        iconContainer.style.background = 'rgba(16, 185, 129, 0.15)';
        iconContainer.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        iconContainer.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--color-success); font-size: 1.85rem; animation: pulseSuccess 0.5s;"></i>`;
    }

    if (title) {
        title.style.color = 'var(--color-success)';
        title.innerText = '¡Sistema Actualizado!';
    }

    if (desc) {
        desc.innerText = 'Actualización completada con éxito. Reiniciando el sistema ahora...';
    }
}

// Expose to window namespace
window.UIManager = {
    switchView,
    renderSearchBar,
    renderCategoryFilterBar,
    renderPendingDispatches,
    renderLocal,
    spawnFloatingIndicator,
    updateKitchenBadge,
    renderCocina,
    renderCashRegister,
    renderSalesHistory,
    renderExpenses,
    renderDebts,
    renderDayCloseModal,
    renderSettingsProducts,
    toggleSettingsModal,
    showToast,
    initPinKeypad,
    updateConnectionStatus,
    renderIngredientsPantry,
    renderStats,
    renderQuickConversionTable,
    renderActiveCart,
    renderClientesView,
    showPaymentMethodModal,
    showUpdateOverlay,
    updateOverlayStatusSuccess
};

