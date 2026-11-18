// Panel de administración: listeners, registro de actividad y asistente (agente).
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

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
    const tabAnalyticsBtn = document.getElementById('admin-tab-btn-analytics');
    const tabProductsBtn = document.getElementById('admin-tab-btn-products');
    const tabDevicesBtn = document.getElementById('admin-tab-btn-devices');
    const tabLogsBtn = document.getElementById('admin-tab-btn-logs');
    const tabCostsBtn = document.getElementById('admin-tab-btn-costs');
    const tabExpensesBtn = document.getElementById('admin-tab-btn-expenses');
    const tabPnlBtn = document.getElementById('admin-tab-btn-pnl');
    const tabRentBtn = document.getElementById('admin-tab-btn-rent');
    const tabAgentBtn = document.getElementById('admin-tab-btn-agent');
    const tabPreferencesBtn = document.getElementById('admin-tab-btn-preferences');

    const panelSummary = document.getElementById('admin-panel-summary');
    const panelAnalytics = document.getElementById('admin-panel-analytics');
    const panelProducts = document.getElementById('admin-panel-products');
    const panelDevices = document.getElementById('admin-panel-devices');
    const panelLogs = document.getElementById('admin-panel-logs');
    const panelCosts = document.getElementById('admin-panel-costs');
    const panelExpenses = document.getElementById('admin-panel-expenses');
    const panelPnl = document.getElementById('admin-panel-pnl');
    const panelRent = document.getElementById('admin-panel-rent');
    const panelAgent = document.getElementById('admin-panel-agent');
    const panelPreferences = document.getElementById('admin-panel-preferences');

    if (!tabSummaryBtn) return; // Not loaded yet

    const allTabBtns = [tabSummaryBtn, tabAnalyticsBtn, tabProductsBtn, tabDevicesBtn, tabLogsBtn, tabCostsBtn, tabExpensesBtn, tabPnlBtn, tabRentBtn, tabAgentBtn, tabPreferencesBtn].filter(Boolean);
    const allPanels = [panelSummary, panelAnalytics, panelProducts, panelDevices, panelLogs, panelCosts, panelExpenses, panelPnl, panelRent, panelAgent, panelPreferences].filter(Boolean);

    // Mobile-only off-canvas drawer for the sidebar (desktop/tablet keep it
    // permanently visible -- these elements are simply display:none there).
    const adminSidebar = document.getElementById('admin-sidebar');
    const adminSidebarToggle = document.getElementById('btn-admin-sidebar-toggle');
    const adminSidebarBackdrop = document.getElementById('admin-sidebar-backdrop');

    function closeAdminSidebarDrawer() {
        if (adminSidebar) adminSidebar.classList.remove('open');
        if (adminSidebarBackdrop) adminSidebarBackdrop.classList.remove('open');
        if (adminSidebarToggle) adminSidebarToggle.setAttribute('aria-expanded', 'false');
    }

    if (adminSidebarToggle && adminSidebar && adminSidebarBackdrop) {
        adminSidebarToggle.addEventListener('click', () => {
            triggerHaptic(10);
            const isOpen = adminSidebar.classList.toggle('open');
            adminSidebarBackdrop.classList.toggle('open', isOpen);
            adminSidebarToggle.setAttribute('aria-expanded', String(isOpen));
        });
        adminSidebarBackdrop.addEventListener('click', closeAdminSidebarDrawer);
    }

    function activateTab(btn, panel) {
        triggerHaptic(10);
        allTabBtns.forEach(b => b.classList.remove('active'));
        allPanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        panel.classList.add('active');
        closeAdminSidebarDrawer();
    }

    tabSummaryBtn.addEventListener('click', () => {
        activateTab(tabSummaryBtn, panelSummary);
        loadAndRenderAdminStats();
    });

    if (tabAnalyticsBtn && panelAnalytics) {
        tabAnalyticsBtn.addEventListener('click', () => {
            activateTab(tabAnalyticsBtn, panelAnalytics);
            loadAndRenderAnalytics();
        });
    }

    const btnRefreshAnalytics = document.getElementById('btn-refresh-analytics');
    if (btnRefreshAnalytics) {
        btnRefreshAnalytics.addEventListener('click', () => {
            triggerHaptic(10);
            loadAndRenderAnalytics(true);
        });
    }

    const btnAnalyticsPdf = document.getElementById('btn-analytics-pdf');
    if (btnAnalyticsPdf) {
        btnAnalyticsPdf.addEventListener('click', async () => {
            triggerHaptic(10);
            await loadAndRenderAnalytics();
            const salesHistory = analyticsSalesCache[analyticsRangeDays] || [];
            const rangeLabels = { 30: 'Últimos 30 días', 60: 'Últimos 60 días', 90: 'Últimos 90 días', 0: 'Todo el historial' };
            window.UIManager.exportSalesAnalyticsToPDF(salesHistory, products, rangeLabels[analyticsRangeDays] || '');
        });
    }

    const analyticsRangeBtns = {
        30: document.getElementById('btn-analytics-range-30'),
        60: document.getElementById('btn-analytics-range-60'),
        90: document.getElementById('btn-analytics-range-90'),
        0: document.getElementById('btn-analytics-range-all') // 0 = sin recorte de fecha (todo el historial)
    };
    Object.entries(analyticsRangeBtns).forEach(([days, btn]) => {
        if (!btn) return;
        btn.addEventListener('click', () => {
            triggerHaptic(10);
            analyticsRangeDays = Number(days);
            Object.values(analyticsRangeBtns).forEach(b => {
                if (!b) return;
                b.classList.toggle('active', b === btn);
            });
            loadAndRenderAnalytics();
        });
    });

    const btnPrepToday = document.getElementById('btn-analytics-prep-today');
    const btnPrepTomorrow = document.getElementById('btn-analytics-prep-tomorrow');
    if (btnPrepToday && btnPrepTomorrow) {
        const updatePrepToggleUI = (mode) => {
            const todayActive = mode === 'today';
            btnPrepToday.classList.toggle('active', todayActive);
            btnPrepTomorrow.classList.toggle('active', !todayActive);
        };
        btnPrepToday.addEventListener('click', () => {
            triggerHaptic(10);
            analyticsPrepMode = 'today';
            updatePrepToggleUI('today');
            loadAndRenderAnalytics();
        });
        btnPrepTomorrow.addEventListener('click', () => {
            triggerHaptic(10);
            analyticsPrepMode = 'tomorrow';
            updatePrepToggleUI('tomorrow');
            loadAndRenderAnalytics();
        });
    }

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

    const btnRecentActivityVerTodo = document.getElementById('btn-recent-activity-ver-todo');
    if (btnRecentActivityVerTodo) {
        // Reusa el mismo botón de pestaña -- no duplica la lógica de
        // activar tab + cargar logs, solo la dispara desde otro lugar.
        btnRecentActivityVerTodo.addEventListener('click', () => tabLogsBtn.click());
    }

    const btnDashboardPdf = document.getElementById('btn-dashboard-pdf');
    if (btnDashboardPdf) {
        btnDashboardPdf.addEventListener('click', () => window.UIManager.exportDashboardSummaryToPDF());
    }

    if (tabCostsBtn && panelCosts) {
        tabCostsBtn.addEventListener('click', () => {
            activateTab(tabCostsBtn, panelCosts);
            window.UIManager.renderCostCalculator(products, costInsumos, handleDeleteCostInsumo);
        });
    }

    if (tabExpensesBtn && panelExpenses) {
        tabExpensesBtn.addEventListener('click', () => {
            activateTab(tabExpensesBtn, panelExpenses);
            setAdminExpenseDateDefault();
            const mi = document.getElementById('admin-expense-filter-month');
            if (mi && !mi.value) mi.value = new Date().toISOString().slice(0, 7);
            loadAndRenderExpensesTab();
        });
    }
    const admExpForm = document.getElementById('add-admin-expense-form');
    if (admExpForm) admExpForm.addEventListener('submit', addAdminExpense);

    document.querySelectorAll('#admin-expense-currency-toggle .segmented-btn').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('#admin-expense-currency-toggle .segmented-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
        });
    });
    document.querySelectorAll('#admin-expense-filter-category .segmented-btn').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('#admin-expense-filter-category .segmented-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            expensesTabFilter.category = b.dataset.cat || '';
            loadAndRenderExpensesTab();
        });
    });
    const admExpMonth = document.getElementById('admin-expense-filter-month');
    if (admExpMonth) admExpMonth.addEventListener('change', () => loadAndRenderExpensesTab(true));

    if (tabRentBtn && panelRent) {
        tabRentBtn.addEventListener('click', () => {
            activateTab(tabRentBtn, panelRent);
            loadRentabilidad();
        });
        initRentabilidadListeners();
    }

    if (tabPnlBtn && panelPnl) {
        tabPnlBtn.addEventListener('click', () => {
            activateTab(tabPnlBtn, panelPnl);
            pnlAnchor = new Date();
            loadPnl();
        });
    }
    document.querySelectorAll('#pnl-mode-toggle .segmented-btn').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('#pnl-mode-toggle .segmented-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            pnlMode = b.dataset.mode;
            pnlAnchor = new Date();
            loadPnl();
        });
    });
    const pnlPrev = document.getElementById('btn-pnl-prev');
    const pnlNext = document.getElementById('btn-pnl-next');
    if (pnlPrev) pnlPrev.addEventListener('click', () => {
        // normalize to the current period start first so setMonth can't overflow
        // a 29-31 day-of-month, then step and re-normalize.
        pnlAnchor = pnlRange(pnlMode, pnlAnchor).start;
        if (pnlMode === 'month') pnlAnchor.setMonth(pnlAnchor.getMonth() - 1);
        else pnlAnchor.setDate(pnlAnchor.getDate() - 7);
        pnlAnchor = pnlRange(pnlMode, pnlAnchor).start;
        loadPnl();
    });
    if (pnlNext) pnlNext.addEventListener('click', () => {
        if (!pnlCanGoNext()) return;
        pnlAnchor = pnlRange(pnlMode, pnlAnchor).start;
        if (pnlMode === 'month') pnlAnchor.setMonth(pnlAnchor.getMonth() + 1);
        else pnlAnchor.setDate(pnlAnchor.getDate() + 7);
        pnlAnchor = pnlRange(pnlMode, pnlAnchor).start;
        loadPnl();
    });
    const pnlRefresh = document.getElementById('btn-pnl-refresh');
    if (pnlRefresh) pnlRefresh.addEventListener('click', () => loadPnl(true));
    const pnlPdf = document.getElementById('btn-pnl-pdf');
    if (pnlPdf) pnlPdf.addEventListener('click', () => {
        if (pnlLast) window.UIManager.exportPnlToPDF(pnlLast, { mode: pnlMode, bcvRate: window.bcvRate || 1 });
    });

    if (tabAgentBtn && panelAgent) {
        tabAgentBtn.addEventListener('click', () => {
            activateTab(tabAgentBtn, panelAgent);
        });
    }

    tabPreferencesBtn.addEventListener('click', () => {
        activateTab(tabPreferencesBtn, panelPreferences);
        // "Asignar PIN" only gets populated as a side effect of
        // loadAndRenderAdminStats(), which otherwise only runs from the
        // Dashboard tab's click handler. Landing here directly (e.g. via the
        // gear-icon shortcut, which defaults admins to Productos, not
        // Dashboard) used to leave the select on the static HTML's
        // "Cargando usuarios..." placeholder forever.
        loadAndRenderUsersManagement();
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

    // Bitácora search -- filters the already-fetched logs client-side, no
    // need to hit Supabase again per keystroke.
    const logsSearchInput = document.getElementById('admin-logs-search');
    if (logsSearchInput) {
        logsSearchInput.addEventListener('input', () => applyActivityLogsFilter());
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
    const editPriceBsFixedInput = document.getElementById('edit-prod-price-bs-fixed');
    if (editPriceBsFixedInput) {
        editPriceBsFixedInput.addEventListener('input', updateEditPriceBsPreview);
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
    bindEditStepper('btn-edit-max-minus', 'btn-edit-max-plus', 'edit-prod-max', 0);
    bindEditStepper('btn-edit-min-minus', 'btn-edit-min-plus', 'edit-prod-min', 0);

    // Admin Quick PIN configuration listener (Admin Authority Only)
    const adminPinForm = document.getElementById('admin-pin-config-form');
    if (adminPinForm) {
        adminPinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            triggerHaptic(15);

            if (currentRole !== 'admin') {
                if (window.UIManager) window.UIManager.showToast("⛔ Solo el perfil Administrador tiene la potestad de asignar PINs.", "fa-solid fa-lock");
                return;
            }

            const targetSelect = document.getElementById('select-admin-target-user');
            const targetUserId = targetSelect ? targetSelect.value : '';
            const targetUserName = targetSelect && targetSelect.options[targetSelect.selectedIndex] ? targetSelect.options[targetSelect.selectedIndex].text : 'Usuario';
            
            const pinInput = document.getElementById('input-admin-quick-pin');
            const pinVal = (pinInput ? pinInput.value : '').trim();

            if (!targetUserId) {
                if (window.UIManager) window.UIManager.showToast("⚠️ Selecciona un usuario válido.", "fa-solid fa-user-xmark");
                return;
            }

            if (!pinVal || pinVal.length !== 4 || !/^\d{4}$/.test(pinVal)) {
                if (window.UIManager) window.UIManager.showToast("⚠️ El PIN debe ser exactamente de 4 números.", "fa-solid fa-circle-exclamation");
                return;
            }

            if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
                const { success, error } = await window.SupabaseManager.setUserPinByAdmin(targetUserId, pinVal);
                if (success) {
                    if (pinInput) pinInput.value = '';
                    if (window.UIManager) window.UIManager.showToast(`🔑 ¡PIN asignado exitosamente a ${targetUserName}!`, "fa-solid fa-shield-check");
                    logActivity("Configuración PIN", `Admin asignó nuevo PIN a ${targetUserName}`);
                } else {
                    if (window.UIManager) window.UIManager.showToast(`❌ Error al guardar PIN: ${error ? error.message : 'falló la conexión'}`, "fa-solid fa-circle-xmark");
                }
            } else {
                if (window.UIManager) window.UIManager.showToast("⚠️ Conexión con Supabase no disponible para guardar PIN.", "fa-solid fa-wifi");
            }
        });
    }

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
            const newCost = parseFloat(document.getElementById('edit-prod-cost').value) || 0;
            const newPriceBs = Math.round((parseFloat(document.getElementById('edit-prod-price-bs-fixed').value) || 0) * 100) / 100;
            const newCategory = document.getElementById('edit-prod-category').value;
            const stockVal = parseInt(document.getElementById('edit-prod-stock').value) || 0;
            const maxValRaw = parseInt(document.getElementById('edit-prod-max').value);
            const maxVal = isNaN(maxValRaw) ? 0 : Math.max(0, maxValRaw);
            const minVal = parseInt(document.getElementById('edit-prod-min').value) || 0;

            if (!newName) {
                alert("El nombre no puede estar vacío.");
                return;
            }

            const oldMax = product.max || 0;
            const beforeCount = product.stock || 0;

            product.name = newName;
            product.price = newPrice;
            // Si el costo estaba en dólares (Rentabilidad) y aquí cambiaron el
            // monto en Bs, manda el de Bs: se borra el de dólares.
            if (product.cost_usd > 0 && Math.abs(newCost - (parseFloat(product.cost) || 0)) > 0.005) product.cost_usd = null;
            product.cost = newCost;
            product.price_bs = newPriceBs > 0 ? newPriceBs : null;
            product.category = newCategory;
            product.min = minVal;

            // Typing a higher stock here is how the day's batch gets loaded, so
            // it has to move the baseline exactly like any other load -- this
            // was the path that left `initial_stock` at 0 all day.
            // Only a retyped count moves stock: editing just the price of a
            // product sitting at -3 must not silently clamp it back to 0.
            if (stockVal !== beforeCount) applyStockCount(product, stockVal);
            const countDelta = product.stock - beforeCount;

            // An explicitly retyped max wins; otherwise capacity just follows
            // the shelf (it used to be incremented on every edit and grew
            // without bound across days).
            product.max = (maxVal !== oldMax) ? Math.max(maxVal, product.stock) : resolveVitrinaCapacity(product);

            window.StorageManager.saveProducts(products);

            if (window.SupabaseManager.isConfigured()) {
                window.SupabaseManager.upsertProduct(product);
            }

            // Postgres recalcula products.stock desde stock_movements en cada
            // movimiento nuevo (migración 033). Sin esta fila, el stock escrito
            // arriba se borraba con la siguiente venta y volvía al negativo.
            recordStockMovement(product, countDelta, countDelta > 0 ? 'load' : 'count_down');

            // Close modal
            document.getElementById('edit-product-modal').classList.add('hidden');

            window.UIManager.renderSettingsProducts(products, editProductPrompt, deleteProduct);
            window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
            window.UIManager.showToast("✏️ Producto editado correctamente.", "fa-solid fa-pen-to-square");
            logActivity("Producto Editado", `Editado: ${product.name} (Stock: ${stockVal}, Max: ${maxVal}, Precio: $${newPrice.toFixed(2)}${product.price_bs ? `, Precio fijo: Bs.${product.price_bs.toFixed(2)}` : ''}, Costo: Bs.${newCost.toFixed(2)}, Cat: ${newCategory})`);
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
        currentActivityLogs = await window.SupabaseManager.fetchActivityLogs();
    } else {
        const localLogs = JSON.parse(localStorage.getItem('casa_lucenzo_local_activity_logs') || '[]');
        currentActivityLogs = [...localLogs].reverse();
    }
    applyActivityLogsFilter();
}

/**
 * Re-render the Bitácora table from currentActivityLogs, filtered by
 * whatever's currently typed in #admin-logs-search (action, details, actor).
 */
function applyActivityLogsFilter() {
    const searchInput = document.getElementById('admin-logs-search');
    const term = (searchInput?.value || '').trim().toLowerCase();

    if (!term) {
        window.UIManager.renderActivityLogs(currentActivityLogs);
        return;
    }

    const filtered = currentActivityLogs.filter(log => {
        return (log.action || '').toLowerCase().includes(term)
            || (log.details || '').toLowerCase().includes(term)
            || (log.actor_name || '').toLowerCase().includes(term)
            || (log.role || '').toLowerCase().includes(term);
    });
    window.UIManager.renderActivityLogs(filtered, true);
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
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        handleUserLogin,
        calculateTotals: (sales, expenses) => (typeof window !== 'undefined' && window.SalesManager ? window.SalesManager.calculateTotals(sales, expenses) : require('./sales.js').calculateTotals(sales, expenses)),
        validateStockAdjustment: (stock, delta) => (typeof window !== 'undefined' && window.InventoryManager ? window.InventoryManager.validateStockAdjustment(stock, delta) : require('./inventory.js').validateStockAdjustment(stock, delta)),
        checkRolePermission: (role, action) => (typeof window !== 'undefined' && window.AuthManager ? window.AuthManager.checkRolePermission(role, action) : require('./auth.js').checkRolePermission(role, action)),
        applyStockLoad,
        invoiceDataForAccount,
        applyStockCount,
        resolveVitrinaCapacity,
        bcvRateChangedEnough,
        saleUsdPrice,
        cartKeyOf
    };
}
