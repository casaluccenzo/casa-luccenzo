// Caja registradora, historial de ventas, gastos, P&L y rentabilidad.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Render the daily cash total card (calculates Net Cash: Sales - Expenses)
 * @param {Array} salesLog History of sales
 * @param {Array} expenses Daily expenses
 */
function renderCashRegister(salesLog, expenses = []) {
    const valueEl = document.getElementById('cash-value');
    const headerCashValEl = document.getElementById('header-cash-val');
    if (!valueEl && !headerCashValEl) return;

    // Filter sales and expenses to ONLY include today's records (or since last close)
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    let filterTime = startOfToday;

    if (window.StorageManager) {
        const lastCloseStr = window.StorageManager.loadLastCloseTime();
        if (lastCloseStr) {
            const lcDate = parseUTCTimestamp(lastCloseStr);
            if (lcDate > startOfToday) {
                filterTime = lcDate;
            }
        }
    }

    const isSalePaid = (sale) => {
        if (!sale || !sale.name) return true;
        const match = sale.name.match(/^(.*)\s+\[(.*)\](\s*\(Pagado(?: - .*?)?\))?$/);
        if (match) {
            return !!match[3];
        }
        if (/\[.*?\]/.test(sale.name) && !/\(Pagado/i.test(sale.name)) {
            return false;
        }
        return true;
    };

    const todaySales = salesLog.filter(s => {
        if (!s || !s.timestamp) return false;
        try {
            const d = parseUTCTimestamp(s.timestamp);
            return d >= filterTime && isSalePaid(s);
        } catch (e) {
            return false;
        }
    });

    const todayExpenses = expenses.filter(e => {
        if (!e || !e.timestamp) return false;
        try {
            const d = parseUTCTimestamp(e.timestamp);
            return d >= filterTime;
        } catch (err) {
            return false;
        }
    });

    const totalSales = todaySales.reduce((sum, sale) => sum + (sale.price || 0), 0);
    const totalExpenses = todayExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const netCash = totalSales - totalExpenses;

    const vesCash = netCash * (window.bcvRate || 1);
    if (valueEl) {
        valueEl.innerHTML = `$${netCash.toFixed(2)} <span style="font-size: 0.875rem; font-weight: normal; opacity: 0.8; margin-left: 0.5rem;">(Bs. ${vesCash.toFixed(2)})</span>`;
    }

    // Update header cash register badge
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

    // Filter salesLog for today (since 00:00:00 or since last close time, whichever is more recent)
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    let filterTime = startOfToday;

    if (window.StorageManager) {
        const lastCloseStr = window.StorageManager.loadLastCloseTime();
        if (lastCloseStr) {
            const lcDate = parseUTCTimestamp(lastCloseStr);
            if (lcDate > startOfToday) {
                filterTime = lcDate;
            }
        }
    }

    const todaySalesLog = salesLog.filter(s => {
        if (!s || !s.timestamp) return true;
        try {
            return parseUTCTimestamp(s.timestamp) >= filterTime;
        } catch (e) {
            return true;
        }
    });

    if (todaySalesLog.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; color: var(--color-text-muted); font-size: 0.75rem; padding: 1.25rem 0;">
                No hay ventas registradas hoy.
            </div>
        `;
        return;
    }

    // Group todaySalesLog by timestamp
    const groups = {};
    todaySalesLog.forEach(sale => {
        let productName = sale.name;
        let clientName;
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
                productId: sale.productId,
                name: productName,
                price: sale.price,
                quantity: 1,
                totalPrice: sale.price
            });
        }
        groups[key].total += sale.price;
    });

    const groupedList = Object.values(groups).sort((a, b) => parseUTCTimestamp(b.timestamp) - parseUTCTimestamp(a.timestamp));

    groupedList.forEach(group => {
        const item = document.createElement('div');
        item.className = 'history-item';

        let timeStr;
        try {
            const date = parseUTCTimestamp(group.timestamp);
            timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch(e) {
            timeStr = 'Ahora';
        }

        const itemsSummary = group.items.map(it => `${it.quantity}x ${it.name}`).join(', ');

        const activeEdit = onEdit || window.handleEditSale;

        item.innerHTML = `
            <div class="history-item-desc" style="flex: 1; min-width: 0;">
                <span class="history-item-title" style="font-weight: 800; color: var(--color-gold);">
                    ${escapeHtml(group.clientName)} <span style="font-weight: normal; color: var(--color-white); font-size: 0.75rem;">(${escapeHtml(itemsSummary)})</span>
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

    // Borrar un gasto: el admin directo; la vendedora ve un candado y se le pide la clave de supervisor.
    const canDeleteExpense = sessionStorage.getItem('casa_lucenzo_active_role') === 'admin';
    expenses.forEach(exp => {
        const row = document.createElement('div');
        row.className = 'expense-item';
        row.innerHTML = `
            <span class="expense-desc">${escapeHtml(exp.description)}</span>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="expense-amount">-$${exp.amount.toFixed(2)} <span style="font-size: 0.625rem; opacity: 0.75; margin-left: 0.125rem;">(Bs. ${(exp.amount * (window.bcvRate || 1)).toFixed(2)})</span></span>
                <button class="btn-undo" style="padding: 0.125rem 0.25rem; font-size: 8px;" data-action="remove-expense" title="${canDeleteExpense ? 'Borrar gasto' : 'Borrar gasto (pide clave de supervisor)'}">${canDeleteExpense ? '&times;' : '<i class="fa-solid fa-lock" style="font-size: 7px;"></i> &times;'}</button>
            </div>
        `;

        row.querySelector('[data-action="remove-expense"]')?.addEventListener('click', () => {
            onRemove(exp.uuid);
        });

        listContainer.appendChild(row);
    });
}

/**
 * Lista de gastos del panel admin, filtrada por mes y categoría.
 * @param {Array} expenses Filas de expenses (con category, currency, bcv_rate)
 * @param {{month:string, category:string, bcvRate:number}} filter
 *   month: 'YYYY-MM' | '' (todos). category: '' (todas) | clave.
 * @param {Function} onDelete uuid => void
 */
function renderAdminExpenses(expenses = [], filter = {}, onDelete) {
    const container = document.getElementById('admin-expenses-container');
    if (!container) return;
    const { month = '', category = '', bcvRate = (window.bcvRate || 1) } = filter;

    const CAT_LABEL = { arriendo: 'Arriendo', sueldos: 'Sueldos', servicios: 'Servicios', otros: 'Otros' };
    const toUsd = (e) => {
        const amt = parseFloat(e.amount) || 0;
        if ((e.currency || 'USD').toUpperCase() === 'VES') {
            const r = parseFloat(e.bcv_rate) > 0 ? parseFloat(e.bcv_rate) : (bcvRate || 1);
            return amt / r;
        }
        return amt;
    };
    const catKey = (e) => (CAT_LABEL[(e.category || '').toLowerCase()] ? e.category.toLowerCase() : 'otros');

    // Local-day derivation (matches aggregatePnl's dateKey convention) so the
    // month filter / row date stay consistent with the server range fetch and
    // the P&L — a raw UTC .slice() would misbucket late-night rows.
    const localDay = (ts) => {
        const d = window.AnalyticsManager.parseTimestamp(ts);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const localMonth = (ts) => localDay(ts).slice(0, 7);

    let rows = (expenses || []).filter(e => {
        if (month) { if (localMonth(e.timestamp) !== month) return false; }
        if (category && catKey(e) !== category) return false;
        return true;
    }).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    if (rows.length === 0) {
        container.innerHTML = `<div style="font-size:0.85rem; color:var(--color-text-muted); text-align:center; padding:1.5rem 0;">Sin gastos para este filtro.</div>`;
        return;
    }

    const fmtUsd = v => '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtVes = v => 'Bs. ' + (v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 });
    const total = rows.reduce((s, e) => s + toUsd(e), 0);

    container.innerHTML = rows.map(e => {
        const original = (e.currency || 'USD').toUpperCase() === 'VES' ? fmtVes(e.amount) : fmtUsd(e.amount);
        return `
        <div class="expense-row" style="display:flex; align-items:center; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid rgba(255,255,255,0.06); font-size:0.8rem;">
            <span style="flex:0 0 78px; color:var(--color-text-muted);">${localDay(e.timestamp)}</span>
            <span style="flex:0 0 80px; font-weight:700;">${CAT_LABEL[catKey(e)]}</span>
            <span style="flex:1 1 auto;">${escapeHtml(e.description)}</span>
            <span style="flex:0 0 auto;">${original}</span>
            <span style="flex:0 0 70px; text-align:right; color:var(--color-text-muted);">${fmtUsd(toUsd(e))}</span>
            <button class="btn-delete-expense" data-uuid="${escapeHtml(e.uuid)}" style="flex:0 0 auto; background:none; border:none; color:var(--color-danger); cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
        </div>`;
    }).join('') + `
        <div style="display:flex; justify-content:space-between; font-weight:800; padding-top:0.6rem; font-size:0.85rem;">
            <span>Total del filtro</span><span>${fmtUsd(total)}</span>
        </div>`;

    container.querySelectorAll('.btn-delete-expense').forEach(btn => {
        btn.addEventListener('click', () => onDelete && onDelete(btn.dataset.uuid));
    });
}

/**
 * Pinta el resumen de Ganancias (cascada + gráfico diario + categorías + abonos).
 * @param {Object} pnl  Salida de AnalyticsManager.aggregatePnl
 * @param {{mode:string}} opts
 */
function renderPnl(pnl, opts = {}) {
    const c = document.getElementById('admin-pnl-container');
    if (!c || !pnl) return;
    const rate = (window.bcvRate || 1);
    const usd = v => '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const ves = v => 'Bs. ' + ((v || 0) * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const t = pnl.totals;

    if (t.ventasUsd === 0 && pnl.gastos.totalUsd === 0) {
        c.innerHTML = `<div style="font-size:0.9rem; color:var(--color-text-muted); text-align:center; padding:2rem 0;">Sin ventas ni gastos en este período.</div>`;
        return;
    }

    const estBanner = t.costoTerceros.estimatedDays > 0
        ? `<div style="background:rgba(245,158,11,0.12); border:1px solid #f59e0b; border-radius:8px; padding:0.5rem 0.75rem; font-size:0.75rem; margin-bottom:0.75rem;">
             Incluye ${t.costoTerceros.estimatedDays} día(s) con costo de producción estimado — antes del 22 ago no se registraba el costo real.
           </div>` : '';

    const neg = v => v < 0 ? ' style="color:var(--color-danger);"' : '';
    const cascade = `
        <table style="width:100%; font-size:0.85rem; border-collapse:collapse;">
          <tr><td style="padding:0.35rem 0;">Ventas de mercadería</td><td style="text-align:right;">${usd(t.ventasUsd)}</td><td style="text-align:right; color:var(--color-text-muted);">${ves(t.ventasUsd)}</td></tr>
          <tr><td style="padding:0.35rem 0;">− Costo de producción (terceros)${t.costoTerceros.isEstimated ? ' <em style="color:#f59e0b;">(est.)</em>' : ''}</td><td style="text-align:right;">−${usd(t.costoTerceros.usd)}</td><td style="text-align:right; color:var(--color-text-muted);">−${ves(t.costoTerceros.usd)}</td></tr>
          <tr id="pnl-gastos-row" style="cursor:pointer;"><td style="padding:0.35rem 0;">− Gastos del local <i class="fa-solid fa-chevron-down" style="font-size:0.7em;"></i></td><td style="text-align:right;">−${usd(t.gastosUsd)}</td><td style="text-align:right; color:var(--color-text-muted);">−${ves(t.gastosUsd)}</td></tr>
          ${pnl.gastos.porCategoria.map(g => `<tr class="pnl-gasto-detail" style="display:none;"><td style="padding:0.2rem 0 0.2rem 1rem; color:var(--color-text-muted);">· ${g.label}</td><td style="text-align:right; color:var(--color-text-muted);">−${usd(g.montoUsd)}</td><td></td></tr>`).join('')}
          <tr style="border-top:2px solid rgba(255,255,255,0.15); font-weight:800;"><td style="padding:0.5rem 0;">= Ganancia neta</td><td style="text-align:right;"${neg(t.gananciaNetaUsd)}>${usd(t.gananciaNetaUsd)}</td><td style="text-align:right;"${neg(t.gananciaNetaUsd)}>${ves(t.gananciaNetaUsd)}</td></tr>
        </table>`;

    const maxDay = Math.max(...pnl.dias.map(d => d.ventasUsd), 1);
    const chart = pnl.dias.map(d => {
        const pct = (d.ventasUsd / maxDay) * 100;
        return `<div class="chart-bar-row">
            <span class="chart-bar-label">${d.fecha.slice(5)}</span>
            <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
            <span class="chart-bar-val">${usd(d.ventasUsd)}</span>
        </div>`;
    }).join('');

    const cats = pnl.categorias.map((cat, i) => `
        <div class="category-stat-wrapper">
          <div class="category-stat-row pnl-cat-row" data-idx="${i}" style="cursor:pointer;">
            <div class="category-label">${cat.label}</div>
            <div class="category-values">
              <span class="category-qty-badge">${cat.unidades} u</span>
              <span class="category-price-usd">${usd(cat.ventasUsd)}</span>
              <span class="category-price-ves">margen ${usd(cat.margenUsd)}</span>
            </div>
          </div>
          <div class="category-stat-dropdown pnl-cat-dd" data-idx="${i}" style="display:none;">
            ${cat.productos.map(p => `<div style="display:flex; justify-content:space-between; font-size:0.75rem; padding:0.15rem 0.5rem;"><span>${escapeHtml(p.name)} ×${p.unidades}</span><span>${usd(p.ventasUsd)}</span></div>`).join('')}
          </div>
        </div>`).join('');

    const abonos = pnl.abonos.count > 0
        ? `<div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:0.75rem; padding-top:0.5rem; border-top:1px dashed rgba(255,255,255,0.1);">
             Abonos cobrados en el período: ${pnl.abonos.count} operación(es) · ${usd(pnl.abonos.montoUsd)} (fuera del cálculo de ganancia)
           </div>` : '';
    const delivery = pnl.delivery && pnl.delivery.count > 0
        ? `<div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:0.5rem;">
             🛵 Delivery cobrado en el período: ${pnl.delivery.count} envío(s) · ${usd(pnl.delivery.montoUsd)} (es del motorizado: fuera de ventas y ganancia)
           </div>` : '';

    c.innerHTML = estBanner + cascade
        + `<div style="margin:1rem 0 0.5rem; font-weight:700; font-size:0.8rem;">Ventas por día</div>` + chart
        + `<div style="margin:1rem 0 0.5rem; font-weight:700; font-size:0.8rem;">Por categoría</div>` + cats
        + abonos + delivery;

    const gastosRow = document.getElementById('pnl-gastos-row');
    if (gastosRow) gastosRow.addEventListener('click', () => {
        c.querySelectorAll('.pnl-gasto-detail').forEach(r => {
            r.style.display = r.style.display === 'none' ? 'table-row' : 'none';
        });
    });
    c.querySelectorAll('.pnl-cat-row').forEach(row => row.addEventListener('click', () => {
        const dd = c.querySelector(`.pnl-cat-dd[data-idx="${row.dataset.idx}"]`);
        if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    }));
}

// ================= RENTABILIDAD (admin) =================
const rentBs = v => 'Bs ' + (Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const rentUsd = v => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Pinta la rentabilidad del período: tarjetas, tabla por categoría (con
 * productos al tocar) y ganancia por día.
 * @param {Object} r Salida de AnalyticsManager.aggregateRentabilidad
 */
function renderRentabilidad(r) {
    const c = document.getElementById('admin-rent-container');
    if (!c || !r) return;
    const t = r.totals;
    if (t.unidades === 0) {
        c.innerHTML = `<div style="font-size:0.9rem; color:var(--color-text-muted); text-align:center; padding:2rem 0;">Sin ventas en este período.</div>`;
        return;
    }
    const cls = v => v < 0 ? 'neg' : 'pos';

    const warn = [];
    const excl = r.excluidas || { unidades: 0, ventasBs: 0, productos: [] };
    const exclBox = excl.unidades > 0 ? `
      <div class="rent-excl">
        <div>Solo cuenta <strong>pasteles</strong> y productos con costo cargado. Quedan fuera ${excl.unidades} venta(s) por ${rentBs(excl.ventasBs)} de productos sin costo
          <span style="color:var(--color-text-muted);">(${excl.productos.slice(0, 4).map(p => `${escapeHtml(p.name)} ×${p.unidades}`).join(', ')}${excl.productos.length > 4 ? '…' : ''})</span>.</div>
        <button class="btn-action-small rent-open-costs"><i class="fa-solid fa-plus"></i> Cargar costos de bebidas y otros</button>
      </div>` : '';
    if (r.sinCosto.unidades > 0) {
        warn.push(`⚠️ ${r.sinCosto.unidades} venta(s) por ${rentBs(r.sinCosto.ventasBs)} son de productos <strong>sin costo registrado</strong> (bebidas, etc.). Se cuentan como ganancia completa hasta que cargues su costo abajo en <strong>Costo por producto</strong>.`);
    }
    if (r.estimadas > 0) {
        warn.push(`ℹ️ ${r.estimadas} venta(s) no guardaron el costo al venderse; se usó el costo actual del producto.`);
    }

    const kpis = `
      <div class="rent-kpis">
        <div class="rent-kpi"><div class="rent-kpi-label">Ventas</div><div class="rent-kpi-value">${rentBs(t.ventasBs)}</div><div class="rent-kpi-sub">${rentUsd(t.ventasUsd)} · ${t.unidades} u</div></div>
        <div class="rent-kpi cost"><div class="rent-kpi-label">Costo proveedores</div><div class="rent-kpi-value">${rentBs(t.costoBs)}</div><div class="rent-kpi-sub">${rentUsd(t.costoUsd)}</div></div>
        <div class="rent-kpi ${t.gananciaBs < 0 ? 'bad' : 'ok'}"><div class="rent-kpi-label">Ganancia</div><div class="rent-kpi-value">${rentBs(t.gananciaBs)}</div><div class="rent-kpi-sub">${rentUsd(t.gananciaUsd)}</div></div>
        <div class="rent-kpi"><div class="rent-kpi-label">Margen</div><div class="rent-kpi-value">${t.margenPct.toLocaleString('es-VE', { maximumFractionDigits: 1 })}%</div><div class="rent-kpi-sub">de cada Bs 100 vendidos</div></div>
      </div>`;

    const rows = r.categorias.map((cat, i) => `
        <tr class="rent-cat-row" data-idx="${i}">
          <td>${cat.label} <i class="fa-solid fa-chevron-down" style="font-size:0.65em; opacity:0.6;"></i></td>
          <td class="hide-sm">${cat.unidades}</td>
          <td>${rentBs(cat.ventasBs)}</td>
          <td>${cat.costoBs > 0 ? '−' + rentBs(cat.costoBs) : (cat.sinCosto.unidades ? '<span style="color:#f59e0b;">sin costo</span>' : rentBs(0))}</td>
          <td class="${cls(cat.gananciaBs)}">${rentBs(cat.gananciaBs)}</td>
          <td class="hide-sm">${cat.margenPct.toLocaleString('es-VE', { maximumFractionDigits: 1 })}%</td>
        </tr>
        ${cat.productos.map(p => `
        <tr class="rent-prod-row" data-parent="${i}" style="display:none;">
          <td>${escapeHtml(p.name)} ×${p.unidades}</td>
          <td class="hide-sm"></td>
          <td>${rentBs(p.ventasBs)}</td>
          <td>${p.costoBs > 0 ? '−' + rentBs(p.costoBs) : (p.sinCosto ? '<span style="color:#f59e0b;">sin costo</span>' : rentBs(0))}</td>
          <td>${rentBs(p.gananciaBs)}</td>
          <td class="hide-sm"></td>
        </tr>`).join('')}`).join('');

    const table = `
      <div class="rent-section-title">Por categoría <span style="font-weight:600; color:var(--color-text-muted); font-size:0.72rem;">(toca una para ver los productos)</span></div>
      <table class="rent-table">
        <thead><tr><th>Categoría</th><th class="hide-sm">Unid.</th><th>Ventas</th><th>Costo</th><th>Ganancia</th><th class="hide-sm">Margen</th></tr></thead>
        <tbody>${rows}
          <tr class="rent-total"><td>Total</td><td class="hide-sm">${t.unidades}</td><td>${rentBs(t.ventasBs)}</td><td>−${rentBs(t.costoBs)}</td><td class="${cls(t.gananciaBs)}">${rentBs(t.gananciaBs)}</td><td class="hide-sm">${t.margenPct.toLocaleString('es-VE', { maximumFractionDigits: 1 })}%</td></tr>
        </tbody>
      </table>`;

    const gastos = t.gastosBs > 0 ? `
      <table class="rent-table" style="margin-top:0.5rem;">
        <tr><td>Ganancia</td><td>${rentBs(t.gananciaBs)}</td></tr>
        <tr><td>− Gastos del local (pestaña Gastos)</td><td>−${rentBs(t.gastosBs)}</td></tr>
        <tr class="rent-total"><td>= Base neta para el reparto</td><td class="${cls(t.baseNetaBs)}">${rentBs(t.baseNetaBs)}</td></tr>
      </table>` : '';

    const dias = r.dias.length > 1 ? `
      <div class="rent-section-title">Por día</div>
      <table class="rent-table">
        <thead><tr><th>Día</th><th>Ventas</th><th>Costo</th><th>Ganancia</th></tr></thead>
        <tbody>${r.dias.map(d => {
            const dt = new Date(d.fecha + 'T12:00:00');
            const lbl = dt.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short' });
            return `<tr><td>${lbl}</td><td>${rentBs(d.ventasBs)}</td><td>−${rentBs(d.costoBs)}</td><td class="${cls(d.gananciaBs)}">${rentBs(d.gananciaBs)}</td></tr>`;
        }).join('')}</tbody>
      </table>` : '';

    const notes = [];
    if (r.delivery.count > 0) notes.push(`🛵 Delivery cobrado: ${r.delivery.count} envío(s) · ${rentBs(r.delivery.bs)} (es del motorizado, fuera de ventas y ganancia).`);
    if (r.abonos.count > 0) notes.push(`Abonos de fiado: ${r.abonos.count} · ${rentBs(r.abonos.bs)} (fuera del cálculo).`);
    if (r.extrasSinCosto && r.extrasSinCosto.count > 0) notes.push(`🛍️ Productos extra sin costo puesto: ${r.extrasSinCosto.count} · ${rentBs(r.extrasSinCosto.bs)} (fuera de ventas y ganancia; al agregarlos ponga "lo que me costó" para que cuenten).`);
    notes.push('Montos en Bs con la tasa de cada venta. Precios con IVA incluido (el 16% del Seniat va en el reparto). Ventas anuladas no cuentan.');

    c.innerHTML = (warn.length ? `<div class="rent-warn">${warn.join('<br>')}</div>` : '')
        + exclBox + kpis + table + gastos + dias
        + `<div class="rent-note">${notes.join('<br>')}</div>`;

    c.querySelectorAll('.rent-open-costs').forEach(b => b.addEventListener('click', () => openRentCosts()));

    c.querySelectorAll('.rent-cat-row').forEach(row => row.addEventListener('click', () => {
        c.querySelectorAll(`.rent-prod-row[data-parent="${row.dataset.idx}"]`).forEach(pr => {
            pr.style.display = pr.style.display === 'none' ? 'table-row' : 'none';
        });
    }));
}

/**
 * Dos repartos con las MISMAS personas: uno sobre la ganancia de los pastelitos
 * y otro, más abajo, sobre la ganancia de todo lo demás. Cada persona tiene su
 * porcentaje en cada bloque (`pct` y `pctOtros`); el nombre es el mismo en los
 * dos, así que cambiarlo, agregar o quitar una persona afecta a ambos.
 * @param {Array<{field,titulo,baseBs,gananciaBs,gastosBs}>} blocks
 * @param {Array<{nombre,pct,pctOtros}>} shares
 * @param {{onChange:Function, onReset:Function}} handlers onChange(newShares)
 */
function renderRentReparto(blocks, shares, handlers = {}) {
    const c = document.getElementById('admin-rent-reparto');
    if (!c) return;
    const list = (shares || []).map(x => ({ ...x }));

    const blockHtml = (b, bi) => {
        const rep = window.AnalyticsManager.computeReparto(b.baseBs, list.map(x => ({ nombre: x.nombre, pct: x[b.field] })));
        const over = rep.asignadoPct > 100;
        const resta = [];
        if (b.gastosBs > 0) resta.push(` − gastos del local ${rentBs(b.gastosBs)}`);
        if (b.fijosBs > 0) resta.push(` − gastos fijos ${rentBs(b.fijosBs)}`);
        const baseTxt = resta.length
            ? `Ganancia ${rentBs(b.gananciaBs)}${resta.join('')} = <strong>${rentBs(b.baseBs)}</strong>.`
            : `Ganancia de este período: <strong>${rentBs(b.baseBs)}</strong>.`;
        return `
      <div class="rent-reparto-block"${bi > 0 ? ' style="margin-top:1.25rem; padding-top:1rem; border-top:1px dashed rgba(255,255,255,0.15);"' : ''}>
      <div class="rent-section-title">${bi === 0 ? '🥟 ' : '🥤 '}${escapeHtml(b.titulo)}</div>
      <div class="rent-note" style="margin:0 0 0.5rem;">${baseTxt}</div>
      ${rep.filas.map((f, i) => `
        <div class="rent-reparto-row">
          <input type="text" class="form-input rent-rep-name" data-i="${i}" value="${escapeHtml(list[i].nombre || '')}" aria-label="Nombre">
          <input type="number" inputmode="decimal" min="0" max="100" step="0.5" class="form-input pct rent-rep-pct" data-i="${i}" data-field="${b.field}" value="${f.pct}" aria-label="Porcentaje">
          <span class="monto">${rentBs(f.bs)}</span>
          <button class="rent-icon-btn rent-rep-del" data-i="${i}" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')}
      <div class="rent-reparto-row queda">
        <span>Queda (sin asignar)</span>
        <span style="text-align:right;${over ? ' color:var(--color-danger);' : ''}">${rep.quedaPct.toLocaleString('es-VE')}%</span>
        <span class="monto${rep.quedaBs < 0 ? ' neg' : ''}" style="${rep.quedaBs < 0 ? 'color:var(--color-danger);' : 'color:#10B981;'}">${rentBs(rep.quedaBs)}</span>
        <span></span>
      </div>
      ${over ? `<div class="rent-warn" style="margin-top:0.5rem;">Los porcentajes suman ${rep.asignadoPct}%: pasan del 100%.</div>` : ''}
      </div>`;
    };

    c.innerHTML = (blocks || []).map(blockHtml).join('') + `
      <div class="rent-note" style="margin:0.6rem 0 0;">Las personas son las mismas en los dos repartos; cada uno tiene sus propios porcentajes. Se guardan en este teléfono.</div>
      <div class="rent-btn-row">
        <button id="btn-rent-rep-add" class="btn-action-small"><i class="fa-solid fa-plus"></i> Agregar persona</button>
        <button id="btn-rent-rep-reset" class="btn-action-small"><i class="fa-solid fa-rotate-left"></i> Volver a los de siempre</button>
      </div>`;

    const emit = l => handlers.onChange && handlers.onChange(l);
    c.querySelectorAll('.rent-rep-name').forEach(inp => inp.addEventListener('change', () => {
        list[Number(inp.dataset.i)].nombre = inp.value; emit(list);
    }));
    c.querySelectorAll('.rent-rep-pct').forEach(inp => inp.addEventListener('change', () => {
        list[Number(inp.dataset.i)][inp.dataset.field] = parseFloat(inp.value) || 0; emit(list);
    }));
    c.querySelectorAll('.rent-rep-del').forEach(b => b.addEventListener('click', () => {
        list.splice(Number(b.dataset.i), 1); emit(list);
    }));
    const add = document.getElementById('btn-rent-rep-add');
    if (add) add.addEventListener('click', () => emit([...list, { nombre: 'Nuevo', pct: 0, pctOtros: 0 }]));
    const reset = document.getElementById('btn-rent-rep-reset');
    if (reset) reset.addEventListener('click', () => handlers.onReset && handlers.onReset());
}

/**
 * Lista de costos por producto para que el admin cargue lo que le cuesta
 * cada bebida, en dólares o en Bs (selector arriba). En dólares se guarda
 * cost_usd y cada venta lo pasa a Bs con la tasa de su momento.
 * Solo escribe products.cost / cost_usd, nunca el precio.
 * @param {Array} products
 * @param {Function} onSave (productId, monto, moneda 'usd'|'bs') => Promise
 */
let rentCostsOpen = false;
const RENT_COST_CUR_KEY = 'casa_lucenzo_costo_moneda';
function rentCostCurrency() {
    try { return localStorage.getItem(RENT_COST_CUR_KEY) === 'bs' ? 'bs' : 'usd'; } catch (e) { return 'usd'; }
}

/** Abre la lista de costos y la lleva a la vista. */
function openRentCosts() {
    rentCostsOpen = true;
    const c = document.getElementById('admin-rent-costs');
    if (!c) return;
    c.querySelectorAll('.rent-costs-body').forEach(b => b.classList.remove('hidden'));
    const t = c.querySelector('.rent-costs-toggle');
    if (t) t.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Ocultar costos';
    c.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderRentCosts(products, onSave) {
    const c = document.getElementById('admin-rent-costs');
    if (!c) return;
    const rate = window.bcvRate || 0;
    const hidden = p => window.Combos && window.Combos.isHiddenFromSale && window.Combos.isHiddenFromSale(p);
    const groups = [
        { label: '🥤 Bebidas', items: products.filter(p => p.category === 'bebidas' && !hidden(p)) },
        { label: '📦 Otros', items: products.filter(p => !['bebidas', 'pastelitos'].includes(p.category) && !hidden(p)) },
        { label: '🥐 Pastelitos', items: products.filter(p => p.category === 'pastelitos' && !hidden(p)) }
    ].filter(g => g.items.length);
    const tieneCosto = p => parseFloat(p.cost) > 0 || parseFloat(p.cost_usd) > 0;
    const sinCostoTotal = products.filter(p => p.category !== 'pastelitos' && !hidden(p) && !tieneCosto(p)).length;
    const sinCosto = products.filter(p => p.category === 'bebidas' && !hidden(p) && !tieneCosto(p)).length;
    const cur = rentCostCurrency();
    const fmtBs = v => 'Bs ' + (Number(v) || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });

    c.innerHTML = `
      <div class="rent-costs-head">
        <div>
          <div class="rent-section-title" style="margin:0.6rem 0 0.15rem;">Costo por producto</div>
          <div class="rent-note" style="margin:0;">${sinCostoTotal ? `<strong style="color:#f59e0b;">${sinCostoTotal} producto(s) sin costo</strong> (${sinCosto} bebida(s)). No entran en la ganancia hasta que cargues su costo.` : 'Todos los productos tienen costo cargado.'}</div>
        </div>
        <button class="btn-action-small rent-costs-toggle">${rentCostsOpen ? '<i class="fa-solid fa-chevron-up"></i> Ocultar costos' : '<i class="fa-solid fa-plus"></i> Cargar costos de bebidas y otros'}</button>
      </div>
      <div class="rent-costs-body${rentCostsOpen ? '' : ' hidden'}">
      <div class="rent-cost-cur">
        <span>Escribir costos en:</span>
        <button type="button" class="rent-cost-cur-btn${cur === 'usd' ? ' active' : ''}" data-cur="usd">$ Dólares</button>
        <button type="button" class="rent-cost-cur-btn${cur === 'bs' ? ' active' : ''}" data-cur="bs">Bs</button>
      </div>
      <div class="rent-note" style="margin:0.5rem 0;">${cur === 'usd'
          ? `Escribe lo que te cuesta <strong>cada unidad en dólares</strong> (lo que pagas al proveedor) y toca Guardar. El sistema lo pasa a bolívares con la tasa de cada venta${rate > 0 ? ` (hoy ${rate.toLocaleString('es-VE')} Bs/$)` : ''}, así el costo en Bs sube solo cuando sube la tasa. No cambia el precio de venta.`
          : 'Escribe lo que te cuesta <strong>cada unidad en Bs</strong> (lo que pagas al proveedor) y toca Guardar. Ese monto queda fijo en Bs aunque cambie la tasa. No cambia el precio de venta.'}</div>
      ${groups.map(g => `
        <div style="font-weight:800; font-size:0.78rem; margin:0.6rem 0 0.2rem;">${g.label}</div>
        ${g.items.map(p => {
            const cost = parseFloat(p.cost) || 0;
            const usd = parseFloat(p.cost_usd) || 0;
            let label;
            if (usd > 0) label = `Costo ${rentUsd(usd)}${rate > 0 ? ` · hoy ${fmtBs(usd * rate)}` : ''}`;
            else if (cost > 0) label = `Costo ${fmtBs(cost)} fijo${rate > 0 ? ` ≈ ${rentUsd(cost / rate)}` : ''}`;
            else label = '<span style="color:#f59e0b;">Sin costo</span>';
            const val = cur === 'usd' ? (usd > 0 ? usd : '') : (usd > 0 ? '' : (cost > 0 ? cost : ''));
            return `<div class="rent-edit-row">
              <div class="rent-edit-name">${escapeHtml(p.name)}<small>${label}</small></div>
              <input type="number" inputmode="decimal" min="0" step="0.01" class="form-input rent-cost-input" data-id="${escapeHtml(p.id)}" value="${val}" placeholder="${cur === 'usd' ? '$' : 'Bs'}">
              <button class="btn-action-small rent-cost-save" data-id="${escapeHtml(p.id)}">Guardar</button>
            </div>`;
        }).join('')}`).join('')}
      </div>`;

    c.querySelectorAll('.rent-cost-cur-btn').forEach(b => b.addEventListener('click', () => {
        try { localStorage.setItem(RENT_COST_CUR_KEY, b.dataset.cur); } catch (e) { /* ignore */ }
        renderRentCosts(products, onSave);
    }));

    const toggle = c.querySelector('.rent-costs-toggle');
    if (toggle) toggle.addEventListener('click', () => {
        if (rentCostsOpen) {
            rentCostsOpen = false;
            c.querySelectorAll('.rent-costs-body').forEach(b => b.classList.add('hidden'));
            toggle.innerHTML = '<i class="fa-solid fa-plus"></i> Cargar costos de bebidas y otros';
        } else openRentCosts();
    });

    c.querySelectorAll('.rent-cost-save').forEach(b => b.addEventListener('click', async () => {
        const inp = Array.from(c.querySelectorAll(".rent-cost-input")).find(i => i.dataset.id === b.dataset.id);
        if (!inp || String(inp.value).trim() === "") { inp && inp.focus(); return; } // vacío: no borra el costo
        const v = Math.round((parseFloat(inp.value) || 0) * 100) / 100;
        if (v < 0) return;
        b.disabled = true;
        try { if (onSave) await onSave(b.dataset.id, v, cur); } finally { b.disabled = false; }
    }));
}

/**
 * Gastos fijos del MES (alquiler, relleno sanitario, internet...). Gustavo
 * escoge el nombre y pone el monto en $ o Bs. Arriba de cada uno dice cuánto
 * toca en el período que se está viendo (día = 1/30, semana = 7/30, mes entero).
 * El total del período se resta del reparto de los pastelitos.
 * @param {Object} f Salida de AnalyticsManager.prorateFixedExpenses
 * @param {string} estado 'idle'|'loading'|'ok'|'sin-tabla'|'error'
 * @param {{onSave:Function, onRemove:Function, onRetry:Function}} handlers
 */
let rentFijoNuevo = false;
function renderRentFijos(f, estado, handlers = {}) {
    const c = document.getElementById('admin-rent-fijos');
    if (!c) return;
    const items = (f && f.items) || [];
    const periodoTxt = f && f.dias
        ? (f.dias === 1 ? '1 día' : `${f.dias} días`) + (f.fraccionMes >= 0.999 && f.fraccionMes <= 1.001 ? ' (el mes completo)' : '')
        : '';
    const montoTxt = x => (x.moneda === 'usd' ? rentUsd(x.monto) : rentBs(x.monto));

    let aviso = '';
    if (estado === 'sin-tabla') aviso = `<div class="rent-warn">Falta activar los gastos fijos en la base: hay que correr una vez el SQL que te mandé. Mientras tanto no se pueden guardar.</div>`;
    else if (estado === 'error') aviso = `<div class="rent-warn">No se pudieron leer los gastos fijos (¿sin conexión?)${items.length ? '; se muestran los últimos guardados en este teléfono' : ''}. <button class="btn-action-small rent-fijo-retry" style="margin-left:0.3rem;"><i class="fa-solid fa-rotate"></i> Reintentar</button></div>`;

    const filas = items.map(x => `
      <div class="rent-fijo" data-id="${escapeHtml(x.id || '')}">
        <div class="rent-fijo-row">
          <input type="text" maxlength="60" class="form-input rent-fijo-name" value="${escapeHtml(x.nombre)}" aria-label="Nombre del gasto">
          <input type="number" inputmode="decimal" min="0" step="0.01" class="form-input rent-fijo-monto" value="${x.monto}" aria-label="Monto al mes">
          <select class="form-input rent-fijo-moneda" aria-label="Moneda">
            <option value="usd"${x.moneda === 'usd' ? ' selected' : ''}>$</option>
            <option value="bs"${x.moneda === 'bs' ? ' selected' : ''}>Bs</option>
          </select>
          <button class="rent-icon-btn rent-fijo-del" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="rent-fijo-sub">${montoTxt(x)} al mes${x.moneda === 'usd' ? ` (hoy ${rentBs(x.mensualBs)})` : ''} · en este período <strong>${rentBs(x.periodoBs)}</strong></div>
      </div>`).join('');

    const nuevo = rentFijoNuevo ? `
      <div class="rent-fijo nuevo">
        <div class="rent-fijo-row">
          <input type="text" maxlength="60" class="form-input rent-fijo-name" placeholder="Ej. Alquiler del local" aria-label="Nombre del gasto">
          <input type="number" inputmode="decimal" min="0" step="0.01" class="form-input rent-fijo-monto" placeholder="Monto" aria-label="Monto al mes">
          <select class="form-input rent-fijo-moneda" aria-label="Moneda"><option value="usd" selected>$</option><option value="bs">Bs</option></select>
          <button class="rent-icon-btn rent-fijo-cancel" aria-label="Cancelar"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <button class="btn-action-small rent-fijo-save-new" style="margin-top:0.35rem;"><i class="fa-solid fa-check"></i> Guardar gasto fijo</button>
      </div>` : '';

    const total = items.length ? `
      <div class="rent-reparto-row queda rent-fijo-total">
        <span>Total en este período${periodoTxt ? ` <small style="font-weight:600; color:var(--color-text-muted);">(${periodoTxt})</small>` : ''}</span>
        <span class="monto" style="color:var(--color-danger);">−${rentBs(f.totalBs)}</span>
      </div>` : '';

    c.innerHTML = `
      <div class="rent-section-title">📌 Gastos fijos del mes</div>
      <div class="rent-note" style="margin:0 0 0.5rem;">Lo que pagas cada mes (local, relleno sanitario, internet…). Pon el monto del mes en $ o Bs; aquí se cuenta solo la parte de los días que estás viendo y se resta del <strong>reparto de los pastelitos</strong>. Se guardan en el sistema y se ven igual en todos los equipos.</div>
      ${aviso}
      ${items.length || rentFijoNuevo ? '' : '<div class="rent-note" style="margin:0.2rem 0;">Todavía no hay gastos fijos.</div>'}
      ${filas}${nuevo}${total}
      ${rentFijoNuevo ? '' : '<div class="rent-btn-row"><button class="btn-action-small rent-fijo-add"><i class="fa-solid fa-plus"></i> Agregar gasto fijo</button></div>'}`;

    const rerender = () => renderRentFijos(f, estado, handlers);
    const read = box => ({
        id: box.dataset.id || null,
        nombre: box.querySelector('.rent-fijo-name').value,
        monto: parseFloat(box.querySelector('.rent-fijo-monto').value) || 0,
        moneda: box.querySelector('.rent-fijo-moneda').value
    });

    c.querySelectorAll('.rent-fijo:not(.nuevo)').forEach(box => {
        const orig = items.find(x => String(x.id) === box.dataset.id);
        const save = () => {
            const d = read(box);
            if (!orig || (d.nombre.trim() === orig.nombre && d.monto === orig.monto && d.moneda === orig.moneda)) return;
            if (!d.nombre.trim()) { box.querySelector('.rent-fijo-name').value = orig.nombre; return; }
            handlers.onSave && handlers.onSave(d);
        };
        box.querySelectorAll('input, select').forEach(el => el.addEventListener('change', save));
        box.querySelector('.rent-fijo-del').addEventListener('click', () => {
            const del = box.querySelector('.rent-fijo-del');
            if (del.dataset.confirm !== '1') {
                // Segundo toque confirma (sin ventanas del navegador).
                del.dataset.confirm = '1';
                del.innerHTML = '<span style="font-size:0.7rem; font-weight:800; color:var(--color-danger);">¿Quitar?</span>';
                setTimeout(() => { if (del.isConnected) { del.dataset.confirm = ''; del.innerHTML = '<i class="fa-solid fa-xmark"></i>'; } }, 3000);
                return;
            }
            handlers.onRemove && handlers.onRemove(box.dataset.id);
        });
    });

    const add = c.querySelector('.rent-fijo-add');
    if (add) add.addEventListener('click', () => {
        rentFijoNuevo = true; rerender();
        const n = c.querySelector('.rent-fijo.nuevo .rent-fijo-name'); if (n) n.focus();
    });
    const cancel = c.querySelector('.rent-fijo-cancel');
    if (cancel) cancel.addEventListener('click', () => { rentFijoNuevo = false; rerender(); });
    const saveNew = c.querySelector('.rent-fijo-save-new');
    if (saveNew) saveNew.addEventListener('click', async () => {
        const box = c.querySelector('.rent-fijo.nuevo');
        const d = read(box);
        if (!d.nombre.trim()) { box.querySelector('.rent-fijo-name').focus(); return; }
        if (!(d.monto > 0)) { box.querySelector('.rent-fijo-monto').focus(); return; }
        saveNew.disabled = true;
        let ok;
        try { ok = handlers.onSave ? await handlers.onSave(d) : false; } finally { saveNew.disabled = false; }
        if (ok) { rentFijoNuevo = false; rerender(); }
    });
    const retry = c.querySelector('.rent-fijo-retry');
    if (retry) retry.addEventListener('click', () => handlers.onRetry && handlers.onRetry());
}
