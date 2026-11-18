// Resumen: KPIs, estadísticas, actividad reciente y conversión rápida.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Render weekly statistics inside the Admin panel
 * @param {Array} salesLog History of sales
 * @param {Array} expenses Daily expenses list
 */
// Días en español, fijos a propósito: `toLocaleDateString` depende del locale
// del navegador y este texto es visible ("vs. viernes pasado").
const KPI_WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * Suma un conjunto de filas para el MISMO día de la semana pasada, recortado
 * al mismo instante del día que ya transcurrió hoy.
 *
 * El recorte no es un detalle: comparar el día parcial de hoy (9am) contra el
 * viernes pasado COMPLETO daría un desplome falso cada mañana ("-85%") que se
 * iría corrigiendo solo con las horas. Recortando la ventana, la comparación
 * es real desde el primer minuto del día.
 *
 * @param {Array} rows Filas con `timestamp`
 * @param {string} amountKey Campo con el monto (`price` en ventas, `amount` en gastos)
 * @returns {number} Total del mismo tramo horario, hace 7 días
 */
function sumSameWeekdayLastWeek(rows, amountKey) {
    const now = new Date();

    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 7);
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date(windowStart);
    windowEnd.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());

    return (rows || []).reduce((sum, row) => {
        const d = parseUTCTimestamp(row.timestamp);
        if (d >= windowStart && d <= windowEnd) {
            return sum + (row[amountKey] || 0);
        }
        return sum;
    }, 0);
}

/**
 * Pinta el chip de variación dentro de una tarjeta KPI.
 *
 * @param {HTMLElement} el Contenedor del chip
 * @param {number} current Valor de hoy
 * @param {number} previous Valor del mismo día la semana pasada
 * @param {boolean} lowerIsBetter `true` en gastos: subir es malo, y pintarlo
 *        de verde como si fuera un logro sería justo al revés de la realidad.
 */
function renderKpiDelta(el, current, previous, lowerIsBetter) {
    if (!el) return;

    const dayName = KPI_WEEKDAYS_ES[new Date().getDay()];
    let cls = 'flat';
    let icon = 'fa-minus';
    let head;

    if (previous <= 0) {
        // Sin base no se inventa un porcentaje (dividir entre cero da Infinity
        // y "+∞%" no le dice nada a nadie).
        head = 'sin registro';
    } else {
        const pct = ((current - previous) / previous) * 100;
        const improved = lowerIsBetter ? pct < 0 : pct > 0;

        if (Math.abs(pct) < 0.05) {
            head = 'igual';
        } else {
            cls = improved ? 'up' : 'down';
            icon = pct > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
            head = `${Math.abs(pct).toFixed(1)}%`;
        }
    }

    el.className = `admin-kpi-delta ${cls}`;
    el.innerHTML = `<i class="fa-solid ${icon}"></i> ${head} <span class="admin-kpi-delta-ref">vs. ${dayName} pasado</span>`;
}

/**
 * Render historical sales charts and metrics inside admin stats panel
 * @param {Array} salesLog Sales history
 * @param {Array} expenses Expenses history
 * @param {Array} products Products list for favorites resolving
 * @param {Object} [opts] Opciones
 * @param {boolean} [opts.fullHistory=false] El dataset abarca los 7 días
 *        completos (lo que devuelve `fetchStatsData`). Solo entonces se
 *        calculan los deltas: la mayoría de las llamadas pasan el `salesLog`
 *        local, que se vacía en cada cierre de caja y solo tiene el turno
 *        actual -- comparar contra eso daría "-100%" todos los días.
 * @param {Array} [opts.deltaExpenses] Gastos de los 7 días, SOLO para el
 *        delta. Existe porque el handler de realtime pasa el `expenses` local
 *        (turno actual) como tercer argumento y cambiarlo alteraría los
 *        totales semanales que ya pinta esta función. Así el delta recibe el
 *        dataset correcto sin tocar nada de lo que ya funcionaba.
 */
function renderStats(salesLog, expenses = [], products = [], opts = {}) {
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

    // Fin de cada día calculado una sola vez (antes se creaba una fecha nueva
    // por cada venta x cada día: ~5.000 fechas por dibujo con una semana normal).
    last7Days.forEach(day => {
        const dayEnd = new Date(day.date);
        dayEnd.setHours(23,59,59,999);
        day.end = dayEnd;
    });
    salesLog.forEach(sale => {
        const saleDate = parseUTCTimestamp(sale.timestamp);
        last7Days.forEach(day => {
            if (saleDate >= day.date && saleDate <= day.end) {
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

    const totalIncome = salesLog.reduce((sum, s) => sum + (s.price || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalIncome - totalExpenses;
    // cost_at_sale queda congelado en Bs al momento de cada venta; se pasa a $
    // con la tasa actual solo para mostrarlo junto al resto de esta card (no
    // se recalcula históricamente, solo se convierte para la vista).
    const totalProductionCostBs = salesLog.reduce((sum, s) => sum + (s.cost_at_sale || 0), 0);
    const totalProductionCostUsd = totalProductionCostBs / (window.bcvRate || 1);
    const netMarginReal = netProfit - totalProductionCostUsd;

    container.innerHTML = `
        <div style="margin-bottom: 0.75rem;">
            ${barsHtml}
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 700; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.5rem; margin-top: 0.5rem;">
            <span>Total Ventas (Semana):</span>
            <span style="color: var(--color-success);">+$${totalIncome.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 700; margin-top: 0.25rem;">
            <span>Gastos (Semana):</span>
            <span style="color: var(--color-danger);">-$${totalExpenses.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 700; margin-top: 0.25rem;">
            <span>Costo Producción (Semana):</span>
            <span style="color: var(--color-danger);">-$${totalProductionCostUsd.toFixed(2)} <span style="opacity:0.7;">(Bs. ${totalProductionCostBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })})</span></span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 800; color: var(--color-gold); margin-top: 0.25rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.25rem;">
            <span>Margen Real (Semana):</span>
            <span>$${netMarginReal.toFixed(2)}</span>
        </div>
    `;

    // 2. Render KPIs for TODAY (Hoy)
    const today = new Date();
    today.setHours(0,0,0,0);

    const todaySales = salesLog.filter(s => {
        const d = parseUTCTimestamp(s.timestamp);
        return d >= today;
    });
    const todaySalesTotal = todaySales.reduce((sum, s) => sum + (s.price || 0), 0);

    const todayExpenses = expenses.filter(e => {
        const d = parseUTCTimestamp(e.timestamp);
        return d >= today;
    });
    const todayExpensesTotal = todayExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    const todayCaja = todaySalesTotal - todayExpensesTotal;

    const cajaKpiEl = document.getElementById('admin-kpi-caja');
    const ventasKpiEl = document.getElementById('admin-kpi-ventas');
    const gastosKpiEl = document.getElementById('admin-kpi-gastos');

    if (cajaKpiEl) cajaKpiEl.textContent = `$${todayCaja.toFixed(2)}`;
    if (ventasKpiEl) ventasKpiEl.textContent = `$${todaySalesTotal.toFixed(2)}`;
    if (gastosKpiEl) gastosKpiEl.textContent = `$${todayExpensesTotal.toFixed(2)}`;

    const ticketCardEl = document.getElementById('admin-kpi-card-ticket');
    const ticketKpiEl = document.getElementById('admin-kpi-ticket');
    const ticketCountEl = document.getElementById('admin-kpi-ticket-count');
    // Cada línea de `todaySales` es una unidad vendida, no una transacción --
    // varias líneas comparten el mismo timestamp cuando salen del mismo
    // checkout (ver js/app/, newSales). Contamos timestamps distintos.
    const ticketCount = new Set(todaySales.map(s => s.timestamp)).size;
    // Sin operaciones hoy, la tarjeta entera se oculta en vez de mostrar un
    // "—" vacío -- un placeholder sin dato real es ruido visual, no info.
    if (ticketCardEl) ticketCardEl.classList.toggle('hidden', ticketCount === 0);
    if (ticketKpiEl && ticketCount > 0) {
        ticketKpiEl.textContent = `$${(todaySalesTotal / ticketCount).toFixed(2)}`;
    }
    if (ticketCountEl && ticketCount > 0) {
        ticketCountEl.textContent = `${ticketCount} operación${ticketCount === 1 ? '' : 'es'} hoy`;
    }

    // --- Segunda moneda (Bs) -------------------------------------------------
    // Segura en cualquier llamada: es una conversión del valor que ya se acaba
    // de pintar arriba, no un cálculo nuevo sobre el historial.
    const rate = window.bcvRate || 1;
    const bsTargets = [
        ['admin-kpi-caja-bs', todayCaja],
        ['admin-kpi-ventas-bs', todaySalesTotal],
        ['admin-kpi-gastos-bs', todayExpensesTotal]
    ];
    bsTargets.forEach(([id, usd]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = `Bs. ${(usd * rate).toFixed(2)}`;
        el.classList.remove('hidden');
    });

    // --- Variación vs. el mismo día la semana pasada -------------------------
    // Solo con historial completo. Ver el jsdoc de `opts.fullHistory`.
    const ventasDeltaEl = document.getElementById('admin-kpi-ventas-delta');
    const gastosDeltaEl = document.getElementById('admin-kpi-gastos-delta');

    if (opts.fullHistory) {
        const expensesForDelta = Array.isArray(opts.deltaExpenses) ? opts.deltaExpenses : expenses;
        renderKpiDelta(ventasDeltaEl, todaySalesTotal, sumSameWeekdayLastWeek(salesLog, 'price'), false);
        renderKpiDelta(gastosDeltaEl, todayExpensesTotal, sumSameWeekdayLastWeek(expensesForDelta, 'amount'), true);
        if (ventasDeltaEl) ventasDeltaEl.classList.remove('hidden');
        if (gastosDeltaEl) gastosDeltaEl.classList.remove('hidden');
    } else {
        // Ocultar explícitamente: si una llamada con historial completo dejó un
        // delta pintado y luego entra una parcial (p. ej. el refresco tras una
        // venta), quedaría un dato viejo sin forma de saber que lo es.
        if (ventasDeltaEl) ventasDeltaEl.classList.add('hidden');
        if (gastosDeltaEl) gastosDeltaEl.classList.add('hidden');
    }

    // Update active summary time display
    const timeDisplayEl = document.getElementById('admin-summary-time-display');
    if (timeDisplayEl) {
        timeDisplayEl.innerHTML = `<i class="fa-solid fa-clock"></i> Actualizado: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // 3. Render Favorites (Daily & Weekly)
    // Daily Favorites
    const dailyCounts = {};
    todaySales.forEach(sale => {
        if (sale.productId !== 'abono') {
            dailyCounts[sale.productId] = (dailyCounts[sale.productId] || 0) + 1;
        }
    });

    const topDaily = Object.entries(dailyCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    const dailyContainer = document.getElementById('admin-favorites-daily');
    if (dailyContainer) {
        if (topDaily.length === 0) {
            dailyContainer.innerHTML = `<div style="font-size: 10px; color: var(--color-text-muted); text-align: center; padding: 0.5rem 0;">No hay ventas hoy aún.</div>`;
        } else {
            const maxDailyCount = topDaily[0][1];
            dailyContainer.innerHTML = topDaily.map(([pId, count], index) => {
                const prod = products.find(p => p.id === pId);
                const prodName = prod ? prod.name : pId;
                const pct = (count / maxDailyCount) * 100;
                return `
                    <div class="admin-favorite-item">
                        <div class="admin-favorite-header">
                            <span class="admin-favorite-name">${index + 1}. ${prodName}</span>
                            <span class="admin-favorite-qty">${count} unid.</span>
                        </div>
                        <div class="admin-favorite-bar-bg">
                            <div class="admin-favorite-bar-fill" style="width: ${pct}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // Weekly Favorites
    const weeklyCounts = {};
    salesLog.forEach(sale => {
        if (sale.productId !== 'abono') {
            weeklyCounts[sale.productId] = (weeklyCounts[sale.productId] || 0) + 1;
        }
    });

    const topWeekly = Object.entries(weeklyCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    const weeklyContainer = document.getElementById('admin-favorites-weekly');
    if (weeklyContainer) {
        if (topWeekly.length === 0) {
            weeklyContainer.innerHTML = `<div style="font-size: 10px; color: var(--color-text-muted); text-align: center; padding: 0.5rem 0;">Sin ventas esta semana.</div>`;
        } else {
            const maxWeeklyCount = topWeekly[0][1];
            weeklyContainer.innerHTML = topWeekly.map(([pId, count], index) => {
                const prod = products.find(p => p.id === pId);
                const prodName = prod ? prod.name : pId;
                const pct = (count / maxWeeklyCount) * 100;
                return `
                    <div class="admin-favorite-item">
                        <div class="admin-favorite-header">
                            <span class="admin-favorite-name">${index + 1}. ${prodName}</span>
                            <span class="admin-favorite-qty">${count} unid.</span>
                        </div>
                        <div class="admin-favorite-bar-bg">
                            <div class="admin-favorite-bar-fill weekly" style="width: ${pct}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

/**
 * Render recent audit activity logs in the admin panel
 * @param {Array} logs Activity logs list
 * @param {boolean} isFiltered Whether `logs` is a search result (changes the empty-state copy)
 */
function renderActivityLogs(logs, isFiltered = false) {
    const tbody = document.getElementById('admin-logs-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--color-text-muted); padding: 1.5rem 0;">
                    ${isFiltered ? 'Ningún registro coincide con la búsqueda.' : 'No hay registros de actividad en la bitácora.'}
                </td>
            </tr>
        `;
        return;
    }

    logs.forEach(log => {
        const tr = document.createElement('tr');
        
        let badgeClass = 'role-badge ';
        let badgeLabel = 'Venta';
        if (log.role === 'cocina') {
            badgeClass += 'cocina';
            badgeLabel = 'Cocina';
        } else if (log.role === 'admin') {
            badgeClass += 'admin';
            badgeLabel = 'Admin';
        } else {
            badgeClass += 'local';
        }

        const date = new Date(log.timestamp);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });

        tr.innerHTML = `
            <td><span class="${badgeClass}">${badgeLabel}</span></td>
            <td style="font-weight: 700; color: var(--color-white);">${escapeHtml(log.action)}${log.actor_name ? ' · ' + escapeHtml(log.actor_name) : ''}</td>
            <td style="color: var(--color-text-muted); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(log.details || '')}">${escapeHtml(log.details || '')}</td>
            <td style="text-align: right; color: var(--color-text-muted); font-size: 10px;">${timeStr}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Categoriza una entrada de activity_logs por su texto de `action` para
// elegir ícono y color en el riel compacto de Resumen. Es puramente
// cosmético: una acción que no matchea ningún patrón cae en el ícono
// genérico, nunca se oculta ni rompe el render.
const RECENT_ACTIVITY_ICON_RULES = [
    { test: /anulaci[oó]n|reversi[oó]n|descarte|eliminad|rechazad/i, icon: 'fa-ban', cls: 'danger' },
    { test: /alerta|fallido/i, icon: 'fa-triangle-exclamation', cls: 'danger' },
    { test: /venta|abono|pedido/i, icon: 'fa-receipt', cls: 'success' },
    { test: /sesi[oó]n|pin/i, icon: 'fa-key', cls: 'info' },
    { test: /producto|reposici[oó]n|despacho|recepci[oó]n|stock|insumo/i, icon: 'fa-boxes-stacked', cls: 'warning' },
    { test: /gasto|costo|precio/i, icon: 'fa-wallet', cls: 'danger' }
];

function getRecentActivityIcon(action) {
    const rule = RECENT_ACTIVITY_ICON_RULES.find(r => r.test.test(action || ''));
    return rule || { icon: 'fa-circle-info', cls: 'info' };
}

// "Hace 4 minutos" / "Hoy 6:02am" / "Ayer 9:14pm" / fecha corta si es más
// vieja. Deliberadamente simple: esto es un vistazo rápido en Resumen, la
// hora exacta con segundos ya vive en la tabla completa de "Registros".
function formatRecentActivityTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Justo ahora';
    if (diffMin < 60) return `Hace ${diffMin} minuto${diffMin === 1 ? '' : 's'}`;

    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (date >= startOfToday) return `Hoy ${timeStr}`;
    if (date >= startOfYesterday) return `Ayer ${timeStr}`;
    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + timeStr;
}

/**
 * Render a compact preview (last 5) of activity_logs directly in the Resumen
 * tab, so the admin doesn't have to open "Registros" to see what just
 * happened. Same data source as renderActivityLogs (fetchActivityLogs),
 * just fewer rows and a denser layout.
 * @param {Array} logs Activity logs, most recent first (as returned by
 *        SupabaseManager.fetchActivityLogs)
 */
function renderRecentActivity(logs) {
    const container = document.getElementById('admin-recent-activity-content');
    if (!container) return;

    if (!logs || logs.length === 0) {
        container.innerHTML = `<div style="font-size: 10px; color: var(--color-text-muted); text-align: center; padding: 0.75rem 0;">Sin actividad registrada todavía.</div>`;
        return;
    }

    const recent = logs.slice(0, 5);

    container.innerHTML = recent.map(log => {
        const { icon, cls } = getRecentActivityIcon(log.action);
        const date = parseUTCTimestamp(log.timestamp);
        return `
            <div class="admin-activity-item">
                <div class="admin-activity-icon ${cls}"><i class="fa-solid ${icon}"></i></div>
                <div class="admin-activity-text">
                    <span class="admin-activity-action">${escapeHtml(log.action)}${log.actor_name ? ` · ${escapeHtml(log.actor_name)}` : ''}</span>
                    ${log.details ? `<span class="admin-activity-details" title="${escapeHtml(log.details)}">${escapeHtml(log.details)}</span>` : ''}
                    <span class="admin-activity-time">${formatRecentActivityTime(date)}</span>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Opens a new window with a printable one-page KPI snapshot of the admin
 * Dashboard and triggers the browser print dialog. Reads values already
 * rendered by renderStats() rather than recomputing them -- this is a
 * snapshot of what's on screen, not a fresh report.
 */
function exportDashboardSummaryToPDF() {
    const get = (id) => {
        const el = document.getElementById(id);
        return el ? el.textContent.trim() : '—';
    };

    const caja = get('admin-kpi-caja');
    const ventas = get('admin-kpi-ventas');
    const gastos = get('admin-kpi-gastos');
    const ticket = get('admin-kpi-ticket');
    const ticketCount = get('admin-kpi-ticket-count');
    const fecha = new Date().toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Por favor, permite las ventanas emergentes para poder generar el PDF.");
        return;
    }

    const css = `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800;900&family=Playfair+Display:wght@700;900&display=swap');
        body {
            font-family: 'Outfit', sans-serif;
            color: #0f172a;
            padding: 2.5rem;
            margin: 0;
            background-color: #ffffff;
            line-height: 1.5;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 1.5rem;
            margin-bottom: 2rem;
        }
        .logo-area { display: flex; align-items: center; gap: 1rem; }
        .logo-circle {
            width: 60px; height: 60px; border-radius: 50%;
            background-image: url('/img/logo-192.png');
            background-size: 108% 108%; background-position: center; background-repeat: no-repeat;
            border: 2px solid #C9A24A;
        }
        .logo-text h1 { font-family: 'Playfair Display', serif; font-size: 1.8rem; margin: 0; color: #0b1329; font-weight: 900; }
        .logo-text p { font-size: 0.85rem; margin: 0; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; }
        .date { font-size: 0.9rem; color: #64748b; text-transform: capitalize; }
        .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
        .kpi-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem; }
        .kpi-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 700; }
        .kpi-value { font-size: 1.4rem; font-weight: 900; color: #0b1329; margin-top: 0.25rem; }
        .kpi-sub { font-size: 0.75rem; color: #94a3b8; margin-top: 0.15rem; }
        .footer { margin-top: 2rem; font-size: 0.75rem; color: #94a3b8; text-align: center; }
    `;

    printWindow.document.write(`
        <html>
        <head>
            <title>Reporte Dashboard - Casa Lucenzo</title>
            <style>${css}</style>
        </head>
        <body>
            <div class="header">
                <div class="logo-area">
                    <div class="logo-circle"></div>
                    <div class="logo-text">
                        <h1>Casa Lucenzo</h1>
                        <p>Reporte de Dashboard Administrativo</p>
                    </div>
                </div>
                <div class="date">${fecha}</div>
            </div>
            <div class="kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-label">Caja (Estimado)</div>
                    <div class="kpi-value">${caja}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Ventas Hoy</div>
                    <div class="kpi-value">${ventas}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Gastos Hoy</div>
                    <div class="kpi-value">${gastos}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Ticket Promedio</div>
                    <div class="kpi-value">${ticket}</div>
                    <div class="kpi-sub">${ticketCount}</div>
                </div>
            </div>
            <div class="footer">Generado por el Sistema Casa Lucenzo el ${new Date().toLocaleString('es-VE')}</div>
            <script>
                window.onload = function() {
                    setTimeout(function() { window.print(); }, 400);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
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
