// Estadísticas por hora, stock crítico, pagos/categorías y analítica de ventas.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Render hourly sales distribution histogram
 * @param {Array} salesLog Sales array
 * @param {string} mode 'today' or 'weekly'
 */
function renderHourlyStats(salesLog, mode = 'today') {
    const container = document.getElementById('hourly-chart-content');
    if (!container) return;

    // Active business operational hours (6 AM to 3 PM)
    const targetHours = [6, 7, 8, 9, 10, 11, 12, 13, 14];

    // Filter salesLog based on active mode
    let filteredSales;
    if (mode === 'today') {
        const startOfToday = new Date();
        startOfToday.setHours(0,0,0,0);
        filteredSales = salesLog.filter(s => {
            const d = parseUTCTimestamp(s.timestamp);
            return d >= startOfToday;
        });
    } else {
        filteredSales = salesLog; // salesLog represents the weekly sales
    }

    // Group sales into hourly buckets
    const hourlyData = {};
    let outsideCount = 0;
    let outsideRevenue = 0;

    targetHours.forEach(h => {
        hourlyData[h] = { count: 0, revenue: 0 };
    });

    filteredSales.forEach(s => {
        const d = parseUTCTimestamp(s.timestamp);
        const hr = d.getHours();
        if (hr >= 6 && hr <= 14) {
            hourlyData[hr].count++;
            hourlyData[hr].revenue += s.price || 0;
        } else {
            outsideCount++;
            outsideRevenue += s.price || 0;
        }
    });

    // Find the peak hour (highest revenue)
    let peakHour = -1;
    let maxRevenue = 0;
    targetHours.forEach(h => {
        if (hourlyData[h].revenue > maxRevenue) {
            maxRevenue = hourlyData[h].revenue;
            peakHour = h;
        }
    });

    const scaleMax = Math.max(...targetHours.map(h => hourlyData[h].revenue), outsideRevenue, 1.0);

    let colsHtml = '';
    targetHours.forEach(h => {
        const data = hourlyData[h];
        const isPeak = h === peakHour && data.revenue > 0;
        const pct = (data.revenue / scaleMax) * 100;
        
        // Format AM/PM labels
        const labelStr = h >= 12 ? (h === 12 ? '12 PM' : `${h - 12} PM`) : `${h} AM`;
        const peakClass = isPeak ? ' peak-hour' : '';

        colsHtml += `
            <div class="hourly-column${peakClass}">
                <div class="hourly-val">$${data.revenue.toFixed(1)}</div>
                <div class="hourly-bar-track">
                    <div class="hourly-bar-fill" style="height: ${pct}%"></div>
                </div>
                <div class="hourly-label" style="font-size: 8px;">${labelStr}</div>
            </div>
        `;
    });

    if (outsideCount > 0) {
        const outsidePct = (outsideRevenue / scaleMax) * 100;
        colsHtml += `
            <div class="hourly-column" style="border-left: 1px dashed rgba(255,255,255,0.15); padding-left: 4px;">
                <div class="hourly-val" style="color: var(--color-danger); font-weight: 800;">$${outsideRevenue.toFixed(1)}</div>
                <div class="hourly-bar-track" style="border-color: rgba(239, 68, 68, 0.2);">
                    <div class="hourly-bar-fill" style="height: ${outsidePct}%; background: linear-gradient(180deg, var(--color-danger), #991b1b);"></div>
                </div>
                <div class="hourly-label" style="color: var(--color-danger); font-size: 8px; font-weight: 800;">Fuera H.</div>
            </div>
        `;
    }

    let summaryText;
    if (peakHour !== -1 && hourlyData[peakHour].revenue > 0) {
        const peakLabel = peakHour >= 12 ? (peakHour === 12 ? '12:00 PM' : `${peakHour - 12}:00 PM`) : `${peakHour}:00 AM`;
        const totalVolume = hourlyData[peakHour].count;
        let outsideText = outsideCount > 0 ? ` | Fuera de Horario: <span style="color: var(--color-danger); font-weight: 800;">$${outsideRevenue.toFixed(2)}</span> (${outsideCount} ventas)` : '';
        summaryText = `
            <div style="font-size: 11px; color: var(--color-text-muted); margin-bottom: 0.5rem; font-weight: 700; display: flex; align-items: center; gap: 0.35rem; justify-content: space-between; flex-wrap: wrap;">
                <div>
                    <span style="color: var(--color-gold);"><i class="fa-solid fa-crown"></i> Hora Pico (6am-3pm):</span> 
                    <span style="color: var(--color-white); font-weight: 800;">${peakLabel}</span> con <strong style="color: var(--color-success); font-weight: 800;">$${hourlyData[peakHour].revenue.toFixed(2)}</strong> (${totalVolume} ventas)${outsideText}
                </div>
                <div style="font-size: 9px; color: var(--color-text-muted); font-style: italic;">
                    Mostrando ventas por hour (${mode === 'today' ? 'Hoy' : 'Semana'})
                </div>
            </div>
        `;
    } else {
        let outsideText = outsideCount > 0 ? ` (Ventas Fuera Horario: <span style="color: var(--color-danger); font-weight: 800;">$${outsideRevenue.toFixed(2)}</span> por ${outsideCount} ventas)` : '';
        summaryText = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--color-text-muted); margin-bottom: 0.5rem;">
                <span>No hay ventas en horario de reporte (6 AM - 3 PM)${outsideText}.</span>
                <span style="font-size: 9px; font-style: italic;">Mostrando ventas por hour (${mode === 'today' ? 'Hoy' : 'Semana'})</span>
            </div>
        `;
    }

    container.innerHTML = `
        ${summaryText}
        <div class="hourly-chart-wrapper">
            ${colsHtml}
        </div>
    `;
}


/**
 * Renders the "Stock Crítico" banner on the Admin Dashboard: every product at
 * or below its minimum, plus a quick "Reponer" action per item and a link to
 * the full Productos tab. Uses the same stock<=min criteria as the header
 * badge (InventoryManager.getLowStockItems) so the two never disagree.
 * @param {Array} products Full product list
 * @param {Function} requestReplenishmentCallback (productId, productName, unit) => void
 */
function renderCriticalStockAlerts(products = [], requestReplenishmentCallback) {
    const container = document.getElementById('admin-critical-stock-container');
    if (!container) return;

    const lowStock = (window.InventoryManager && window.InventoryManager.getLowStockItems)
        ? window.InventoryManager.getLowStockItems(forSale(products))
        : [];
    // getLowStockItems() usa stock<=min, y trata un mínimo sin configurar (0)
    // como si "0" fuera el umbral real -- así que cualquier producto agotado
    // que nunca tuvo mínimo asignado se cuela como "crítico" sin serlo. Ese
    // ruido queda para el header/cocina (no lo tocamos, otros consumidores
    // dependen de él); acá exigimos un mínimo real configurado.
    const critical = lowStock.filter(p => (parseInt(p.min || p.stock_min) || 0) > 0);

    if (critical.length === 0) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="admin-critical-stock-banner">
            <div class="admin-critical-stock-items">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span class="admin-critical-stock-label">Stock Crítico</span>
                ${critical.map(p => `
                    <span class="admin-critical-stock-chip">
                        ${escapeHtml(p.name)} · <b>${p.stock}</b>
                        <button type="button" class="admin-critical-stock-replenish" data-id="${p.id}" title="Solicitar reposición">
                            <i class="fa-solid fa-truck-fast"></i>
                        </button>
                    </span>
                `).join('')}
            </div>
            <button type="button" id="btn-critical-stock-goto-inventory" class="btn-action-small">Ir a Inventario</button>
        </div>
    `;

    if (typeof requestReplenishmentCallback === 'function') {
        container.querySelectorAll('.admin-critical-stock-replenish').forEach(btn => {
            const product = critical.find(p => String(p.id) === btn.dataset.id);
            if (!product) return;
            btn.addEventListener('click', () => {
                requestReplenishmentCallback(product.id, product.name, product.unit || 'unid.');
            });
        });
    }

    const gotoBtn = document.getElementById('btn-critical-stock-goto-inventory');
    if (gotoBtn) {
        gotoBtn.addEventListener('click', () => {
            const productsTab = document.getElementById('admin-tab-btn-products');
            if (productsTab) productsTab.click();
        });
    }
}

/**
 * Render payment methods & category performance widgets
 * @param {Array} salesLog 
 * @param {Array} products 
 */
/**
 * Render Payment Methods and Category Sales stats with independent Day / Week time filters
 * @param {Array} salesLog Sales array
 * @param {Array} products Products array
 * @param {string} paymentFilter 'day' or 'week'
 * @param {string} categoryFilter 'day' or 'week'
 */
function renderPaymentAndCategoryStats(salesLog = [], products = [], paymentFilter = 'day', categoryFilter = 'day') {
    const paymentContainer = document.getElementById('payment-methods-content');
    const categoryContainer = document.getElementById('category-performance-content');
    if (!paymentContainer || !categoryContainer) return;

    // Update toggle button styles
    const updateToggleBtnUI = (dayBtnId, weekBtnId, activeFilter) => {
        const dayBtn = document.getElementById(dayBtnId);
        const weekBtn = document.getElementById(weekBtnId);
        if (dayBtn && weekBtn) {
            dayBtn.classList.toggle('active', activeFilter !== 'week');
            weekBtn.classList.toggle('active', activeFilter === 'week');
        }
    };

    updateToggleBtnUI('btn-stats-payment-day', 'btn-stats-payment-week', paymentFilter);
    updateToggleBtnUI('btn-stats-cat-day', 'btn-stats-cat-week', categoryFilter);

    // Calculate dates for filtering
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Start of week (Monday at 00:00:00)
    const dayOfWeek = now.getDay();
    const diffToMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - diffToMonday);

    // Filter salesLog for Payment Methods
    const paymentSales = salesLog.filter(s => {
        if (!s.timestamp) return true;
        const d = window.parseUTCTimestamp ? window.parseUTCTimestamp(s.timestamp) : new Date(s.timestamp);
        return paymentFilter === 'week' ? (d >= startOfWeek) : (d >= startOfDay);
    });

    // Filter salesLog for Category Sales
    const categorySales = salesLog.filter(s => {
        if (!s.timestamp) return true;
        const d = window.parseUTCTimestamp ? window.parseUTCTimestamp(s.timestamp) : new Date(s.timestamp);
        return categoryFilter === 'week' ? (d >= startOfWeek) : (d >= startOfDay);
    });

    // 1. Process payment methods
    const methods = {
        'Efectivo $': { label: '💵 Efectivo Divisas ($)', count: 0, amount: 0, class: 'fill-usd' },
        'Pago Móvil': { label: '📱 Pago Móvil (Bs.)', count: 0, amount: 0, class: 'fill-pm' },
        'Punto de Venta': { label: '💳 Punto de Venta (Bs.)', count: 0, amount: 0, class: 'fill-card' },
        'Efectivo Bs.': { label: '💵 Efectivo Bolívares (Bs.)', count: 0, amount: 0, class: 'fill-ves' },
        'Deuda / Crédito': { label: '🤝 Cuentas por Cobrar', count: 0, amount: 0, class: 'fill-card' }
    };

    let totalSalesVal = 0;
    paymentSales.forEach(s => {
        let method = 'Efectivo $';
        const match = s.name ? s.name.match(/\(Pagado - (.*?)\)/) : null;
        if (match) {
            const parsed = match[1];
            if (methods[parsed]) method = parsed;
        } else if (s.name && s.name.includes('(Pendiente)')) {
            method = 'Deuda / Crédito';
        }
        
        if (methods[method]) {
            methods[method].count++;
            methods[method].amount += s.price || 0;
            totalSalesVal += s.price || 0;
        }
    });

    let paymentHtml = '';
    if (totalSalesVal > 0) {
        Object.entries(methods).forEach(([key, m]) => {
            const pct = totalSalesVal > 0 ? (m.amount / totalSalesVal) * 100 : 0;
            paymentHtml += `
                <div>
                    <div class="progress-widget-row">
                        <span class="progress-widget-label">${m.label}</span>
                        <span class="progress-widget-value">$${m.amount.toFixed(2)} (${pct.toFixed(0)}%)</span>
                    </div>
                    <div class="progress-widget-bar-bg">
                        <div class="progress-widget-bar-fill ${m.class}" style="width: ${pct}%;"></div>
                    </div>
                </div>
            `;
        });
    } else {
        const noSalesPeriodText = paymentFilter === 'week' ? 'esta semana' : 'hoy';
        paymentHtml = `<div style="font-size: 11px; color: var(--color-text-muted); text-align: center; padding: 1rem 0;">Sin ventas registradas ${noSalesPeriodText}.</div>`;
    }
    paymentContainer.innerHTML = paymentHtml;

    // 2. Process Categories
    const categories = {
        'pastelitos': { label: '🥐 Pastelitos', count: 0, amount: 0, class: 'fill-category-1' },
        'empanadas': { label: '🥟 Empanadas', count: 0, amount: 0, class: 'fill-category-1' },
        'minis': { label: '🥐 Pastelitos mini', count: 0, amount: 0, class: 'fill-category-1' },
        'bebidas': { label: '🥤 Bebidas & Jugos', count: 0, amount: 0, class: 'fill-category-2' },
        'dulces': { label: '🍬 Dulces', count: 0, amount: 0, class: 'fill-category-5' },
        'otros': { label: '📦 Otros / Varios', count: 0, amount: 0, class: 'fill-category-2' },
        'extra': { label: '🛍️ Productos extra', count: 0, amount: 0, class: 'fill-category-2' },
        'delivery': { label: '🛵 Delivery (fuera de IVA)', count: 0, amount: 0, class: 'fill-category-5' }
    };

    let totalCatVal = 0;
    categorySales.forEach(s => {
        if (s.productId === 'abono') return;
        const product = products.find(p => p.id === s.productId);
        let cat = 'otros';
        if (window.Combos && window.Combos.isDeliverySale(s)) {
            cat = 'delivery';
        } else if (window.Combos && window.Combos.isExtraSale(s)) {
            cat = 'extra';
        } else if (product && categories[product.category]) {
            cat = product.category;
        }
        categories[cat].count++;
        categories[cat].amount += s.price || 0;
        totalCatVal += s.price || 0;
    });

    let catHtml = '';
    if (totalCatVal > 0) {
        Object.entries(categories).forEach(([key, c]) => {
            const pct = totalCatVal > 0 ? (c.amount / totalCatVal) * 100 : 0;
            catHtml += `
                <div>
                    <div class="progress-widget-row">
                        <span class="progress-widget-label">${c.label} (${c.count} uds)</span>
                        <span class="progress-widget-value">$${c.amount.toFixed(2)} (${pct.toFixed(0)}%)</span>
                    </div>
                    <div class="progress-widget-bar-bg">
                        <div class="progress-widget-bar-fill ${c.class}" style="width: ${pct}%;"></div>
                    </div>
                </div>
            `;
        });
    } else {
        const noCatPeriodText = categoryFilter === 'week' ? 'esta semana' : 'hoy';
        catHtml = `<div style="font-size: 11px; color: var(--color-text-muted); text-align: center; padding: 1rem 0;">Sin ventas de productos ${noCatPeriodText}.</div>`;
    }
    categoryContainer.innerHTML = catHtml;
}

const ANALYTICS_CATEGORY_FILL = {
    pastelitos: 'fill-category-1',
    empanadas: 'fill-category-1',
    minis: 'fill-category-1',
    bebidas: 'fill-category-2',
    dulces: 'fill-category-5'
};
const ANALYTICS_CATEGORY_LABELS = {
    pastelitos: '🥐 Pastelitos',
    empanadas: '🥟 Empanadas',
    minis: '🥐 Pastelitos mini',
    bebidas: '🥤 Bebidas',
    dulces: '🍬 Dulces',
    otros: '📦 Otros'
};

/**
 * Render the "Análisis" admin tab: day-over-day comparison, recent-days
 * bar list, weekday sales pattern, flavor ranking, and the daily prep
 * recommendation. All calculations come from window.AnalyticsManager
 * (js/analytics.js); this function only turns that data into HTML using
 * the same .progress-widget-bar-bg/fill pattern as renderPaymentAndCategoryStats.
 * @param {Array} salesHistory Sales rows for the selected lookback range
 * @param {Array} products Product catalog (for names/categories/max stock)
 * @param {number} targetWeekday Day (0=Domingo..6=Sábado) to build the prep recommendation for
 * @param {string} targetLabel Human label for that day, e.g. "Hoy" or "Mañana"
 */
function renderSalesAnalytics(salesHistory = [], products = [], targetWeekday = new Date().getDay(), targetLabel = 'Hoy') {
    const container = document.getElementById('admin-analytics-container');
    if (!container) return;

    const AM = window.AnalyticsManager;
    if (!AM) {
        container.innerHTML = `<div style="font-size: 0.85rem; color: var(--color-text-muted); text-align: center; padding: 1rem 0;">No se pudo cargar el módulo de análisis.</div>`;
        return;
    }

    const dailyTotals = AM.aggregateSalesByDay(salesHistory);
    if (dailyTotals.length === 0) {
        container.innerHTML = `<div style="font-size: 0.85rem; color: var(--color-text-muted); text-align: center; padding: 1.5rem 0;">Todavía no hay suficiente historial de ventas para analizar. Volvé a mirar esta pestaña en unos días.</div>`;
        return;
    }

    const weekdayPattern = AM.getWeekdayPattern(salesHistory);
    const flavorRanking = AM.getFlavorRanking(salesHistory, products, { limit: 10 });
    const recommendation = AM.getDailyPrepRecommendation(salesHistory, products, targetWeekday);

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayEntry = dailyTotals.find(d => d.dateStr === todayKey);
    const todayTotal = todayEntry ? todayEntry.total : 0;
    const comparison = AM.compareVsWeekdayAverage(todayTotal, weekdayPattern, now.getDay());
    const comparisonColor = comparison.pctChange === null ? 'var(--color-text-muted)' : (comparison.pctChange >= 0 ? '#34D399' : '#F87171');

    // Últimos días (más recientes primero)
    const recentDays = dailyTotals.slice(-14).reverse();
    const maxDayTotal = Math.max(...recentDays.map(d => d.total), 0.01);
    const dayListHtml = recentDays.map(d => {
        const pct = (d.total / maxDayTotal) * 100;
        const label = new Date(d.dateStr + 'T00:00:00').toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short' });
        return `
            <div>
                <div class="progress-widget-row">
                    <span class="progress-widget-label">${escapeHtml(label)}</span>
                    <span class="progress-widget-value">$${d.total.toFixed(2)} (${d.count} vtas)</span>
                </div>
                <div class="progress-widget-bar-bg">
                    <div class="progress-widget-bar-fill fill-usd" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join('');

    // Patrón semanal, ordenado Lunes..Domingo
    const orderedWeekdays = [1, 2, 3, 4, 5, 6, 0].map(w => weekdayPattern[w]);
    const maxWeekdayAvg = Math.max(...orderedWeekdays.map(w => w.avgTotal), 0.01);
    const weekdayHtml = orderedWeekdays.map(w => {
        const pct = (w.avgTotal / maxWeekdayAvg) * 100;
        return `
            <div>
                <div class="progress-widget-row">
                    <span class="progress-widget-label">${w.label}</span>
                    <span class="progress-widget-value">$${w.avgTotal.toFixed(2)} prom. (${w.sampleSize} sem.)</span>
                </div>
                <div class="progress-widget-bar-bg">
                    <div class="progress-widget-bar-fill fill-pm" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join('');

    // Ranking de sabores
    const maxQty = Math.max(...flavorRanking.map(f => f.quantity), 1);
    const rankingHtml = flavorRanking.length > 0 ? flavorRanking.map((f, i) => {
        const pct = (f.quantity / maxQty) * 100;
        const fillClass = ANALYTICS_CATEGORY_FILL[f.category] || 'fill-usd';
        return `
            <div>
                <div class="progress-widget-row">
                    <span class="progress-widget-label">#${i + 1} ${escapeHtml(f.name)}</span>
                    <span class="progress-widget-value">${f.quantity} uds &bull; $${f.amount.toFixed(2)}</span>
                </div>
                <div class="progress-widget-bar-bg">
                    <div class="progress-widget-bar-fill ${fillClass}" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join('') : `<div style="font-size: 11px; color: var(--color-text-muted); text-align: center; padding: 1rem 0;">Sin ventas registradas en este rango.</div>`;

    // Recomendación de preparación, agrupada por categoría
    const groupedRec = {};
    recommendation.forEach(r => {
        if (!groupedRec[r.category]) groupedRec[r.category] = [];
        groupedRec[r.category].push(r);
    });
    const recHtml = Object.keys(groupedRec).length > 0 ? Object.entries(groupedRec).map(([cat, items]) => `
        <div style="margin-bottom: 0.75rem;">
            <div style="font-size: 10px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">
                ${ANALYTICS_CATEGORY_LABELS[cat] || cat}
            </div>
            ${items.map(r => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.6rem; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 0.3rem;">
                    <span style="font-size: 0.8rem; color: var(--color-white); font-weight: 700;">
                        ${escapeHtml(r.name)}${r.lowConfidence ? ' <span style="color: #FBBF24; font-size: 9px; font-weight: 800;">(dato preliminar)</span>' : ''}
                    </span>
                    <span style="font-family: monospace; font-weight: 900; color: var(--color-gold); font-size: 0.95rem;">${r.suggested} unid.</span>
                </div>
            `).join('')}
        </div>
    `).join('') : `<div style="font-size: 11px; color: var(--color-text-muted); text-align: center; padding: 1rem 0;">Sin historial suficiente para ese día todavía.</div>`;

    container.innerHTML = `
        <div style="background: rgba(10, 20, 38, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1rem; margin-bottom: 0.75rem;">
            <div style="font-size: 10px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em;">HOY VS. PROMEDIO HISTÓRICO</div>
            <div style="font-size: 1.6rem; font-weight: 900; color: #FFFFFF; font-family: monospace; margin-top: 0.25rem;">$${todayTotal.toFixed(2)}</div>
            <div style="font-size: 0.8rem; color: ${comparisonColor}; font-weight: 700; margin-top: 0.15rem;">${comparison.label}</div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem;">
            <div style="background: rgba(10, 20, 38, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1rem;">
                <div style="font-size: 10px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">📅 Últimos días</div>
                ${dayListHtml}
            </div>
            <div style="background: rgba(10, 20, 38, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1rem;">
                <div style="font-size: 10px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">📈 Patrón semanal (promedio)</div>
                ${weekdayHtml}
            </div>
            <div style="background: rgba(10, 20, 38, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1rem;">
                <div style="font-size: 10px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">🏆 Sabores más vendidos</div>
                ${rankingHtml}
            </div>
            <div style="background: rgba(10, 20, 38, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1rem;">
                <div style="font-size: 10px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">👨‍🍳 Preparar para ${escapeHtml(targetLabel)}</div>
                ${recHtml}
            </div>
        </div>
    `;
}
