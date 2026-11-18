// Modal de cierre de jornada.
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Renders financial breakdown inside the Day Close Modal
 * @param {Array} salesLog History of sales
 * @param {Array} expenses Daily expenses
 */
function renderDayCloseModal(salesLog, expenses, products = [], customDateLabel = '', customRate = null, opts = {}) {
    const modalBody = document.getElementById('day-close-modal-body');
    if (!modalBody) return;

    const rate = (customRate && !isNaN(parseFloat(customRate)) && parseFloat(customRate) > 0) 
        ? parseFloat(customRate) 
        : (window.bcvRate || 1);

    const reportDateText = customDateLabel || new Date().toLocaleDateString();

    const totalSales = salesLog.reduce((sum, sale) => sum + (sale.price || 0), 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const netCash = totalSales - totalExpenses;

    const categoryMap = {};

    salesLog.forEach(sale => {
        let cleanName = sale.name;
        if (sale.productId !== 'abono') {
            cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
        }

        let catKey = 'otros';
        let catLabel = '📦 Otros / Varios';
        let sortOrder = 99;

        if (sale.productId !== 'abono') {
            const product = products.find(p => p.id === sale.productId);
            const rawCat = product ? product.category : 'otros';

            if (window.Combos && window.Combos.isDeliverySale(sale)) {
                catKey = 'delivery';
                catLabel = '🛵 Delivery (fuera de IVA)';
                sortOrder = 85;
            } else if (window.Combos && window.Combos.isExtraSale(sale)) {
                catKey = 'extra';
                catLabel = '🛍️ Productos extra (comprados afuera)';
                sortOrder = 75;
            } else if (window.Combos && window.Combos.isStaffSale(sale)) {
                catKey = 'personal';
                catLabel = '👥 Consumo del personal (al costo)';
                sortOrder = 80;
            } else if (rawCat === 'pastelitos') {
                const unitPrice = sale.price || (product ? product.price : 0);
                catKey = `pastelitos_${unitPrice.toFixed(2)}`;
                catLabel = `🥐 Pastelitos ($${unitPrice.toFixed(2)})`;
                sortOrder = 10 + unitPrice;
            } else if (rawCat === 'empanadas') {
                catKey = 'empanadas';
                catLabel = '🥟 Empanadas';
                sortOrder = 40;
            } else if (rawCat === 'minis') {
                catKey = 'minis';
                catLabel = '🥐 Pastelitos mini';
                sortOrder = 45;
            } else if (rawCat === 'bebidas') {
                catKey = 'bebidas';
                catLabel = '🥤 Bebidas';
                sortOrder = 50;
            } else if (rawCat === 'dulces') {
                catKey = 'dulces';
                catLabel = '🍬 Dulces';
                sortOrder = 60;
            } else {
                catKey = 'otros';
                catLabel = '📦 Otros / Varios';
                sortOrder = 90;
            }
        }

        if (!categoryMap[catKey]) {
            categoryMap[catKey] = { label: catLabel, sortOrder: sortOrder, sales: {} };
        }

        const catGroup = categoryMap[catKey].sales;
        if (!catGroup[cleanName]) {
            catGroup[cleanName] = { count: 0, price: sale.price || 0, total: 0 };
        }
        catGroup[cleanName].count++;
        catGroup[cleanName].total += sale.price || 0;
    });

    let salesHtml = '';
    const sortedCategories = Object.values(categoryMap).sort((a, b) => a.sortOrder - b.sortOrder);

    for (const catData of sortedCategories) {
        const items = Object.entries(catData.sales);
        if (items.length > 0) {
            salesHtml += `
                <div style="margin-top: 0.85rem; margin-bottom: 0.35rem; padding: 0.15rem 0.25rem; background: rgba(201, 162, 74, 0.07); border-left: 3.5px solid var(--color-gold); font-size: 10px; font-weight: 800; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between;">
                    <span>${catData.label}</span>
                    <span style="opacity: 0.8; font-size: 9px;">$${items.reduce((sum, [, d]) => sum + d.total, 0).toFixed(2)}</span>
                </div>
            `;
            for (const [name, data] of items) {
                salesHtml += `
                    <div class="summary-row" style="font-size: 0.8125rem; display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                        <div>
                            <span style="font-weight: 700; color: var(--color-gold); margin-right: 0.25rem;">${data.count}x</span>
                            <span style="color: var(--color-white);">${name}</span>
                            <span style="font-size: 10px; color: var(--color-text-muted); margin-left: 0.35rem;">($${data.price.toFixed(2)} c/u)</span>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-weight: 700; color: var(--color-white); font-family: monospace;">$${data.total.toFixed(2)}</span>
                            <div style="font-size: 9px; color: var(--color-text-muted); font-family: monospace;">Bs. ${(data.total * rate).toFixed(2)}</div>
                        </div>
                    </div>
                `;
            }
        }
    }

    // Build expenses detail HTML
    let expensesHtml = '';
    expenses.forEach(exp => {
        expensesHtml += `
            <div class="summary-row" style="font-size: 0.8125rem; display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                <span style="color: var(--color-white);">${exp.description}</span>
                <div style="text-align: right;">
                    <span style="font-weight: 700; color: var(--color-danger); font-family: monospace;">-$${exp.amount.toFixed(2)}</span>
                    <div style="font-size: 9px; color: var(--color-text-muted); font-family: monospace;">Bs. ${(exp.amount * rate).toFixed(2)}</div>
                </div>
            </div>
        `;
    });

    // Total items sold count
    const isDeliverySale = (s) => !!(window.Combos && window.Combos.isDeliverySale(s));
    const totalItemsSold = salesLog.filter(s => s.productId !== 'abono' && !isDeliverySale(s)).length;
    const deliveryCount = salesLog.filter(isDeliverySale).length;
    const totalDelivery = salesLog.filter(isDeliverySale).reduce((sum, s) => sum + (s.price || 0), 0);

    // Cierre del día: lo vendido en cada turno (mañana / tarde) y el total.
    // En el corte de turno (opts.shift) ya se muestra un solo turno.
    let shiftsHtml = '';
    if (!opts.shift && typeof window.shiftOfTimestamp === 'function' && salesLog.some(s => s.timestamp)) {
        const rows = [['manana', '☀️ Turno mañana'], ['tarde', '🌙 Turno tarde']].map(([key, label]) => {
            const t = salesLog.filter(s => window.shiftOfTimestamp(s.timestamp) === key).reduce((sum, s) => sum + (s.price || 0), 0);
            return `
            <div class="summary-row">
                <span>${label}:</span>
                <span style="font-weight: 700;">$${t.toFixed(2)} <span style="font-size: 0.75rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(t * rate).toFixed(2)})</span></span>
            </div>`;
        }).join('');
        shiftsHtml = `
        <div style="margin-bottom: 1.25rem;">
            <h4 style="font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 0.5rem; font-weight: 900; letter-spacing: 0.05em;">Ventas por Turno</h4>
            ${rows}
            <div class="summary-row" style="font-weight: 800;">
                <span>Total del día (los dos turnos):</span>
                <span style="color: var(--color-gold);">$${totalSales.toFixed(2)} <span style="font-size: 0.75rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(totalSales * rate).toFixed(2)})</span></span>
            </div>
        </div>`;
    }

    // Closed client accounts for this day, so an admin can pull up any
    // client's line items and reprint/share their invoice days after
    // checkout -- not just for today (see groupSalesByClientAccounts).
    const clientAccounts = groupSalesByClientAccounts(salesLog).filter(g => g.isPaid);
    let clientsHtml = '';
    clientAccounts.forEach((group, idx) => {
        let timeStr = '';
        try {
            timeStr = parseUTCTimestamp(group.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {}
        const itemsSummary = group.items.map(it => `${it.quantity}x ${escapeHtml(it.name)}`).join(', ');
        clientsHtml += `
            <div class="summary-row" style="flex-direction: column; align-items: stretch; gap: 0.35rem; padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.8125rem; font-weight: 800; color: var(--color-gold);">
                        <i class="fa-solid fa-user-tag" style="font-size: 11px; opacity: 0.8; margin-right: 0.25rem;"></i>${escapeHtml(group.clientName)}${group.clientRif ? ` <span style="color: var(--color-text-muted); font-weight: 700; font-size: 10px;">(${escapeHtml(group.clientRif)})</span>` : ''}
                    </span>
                    <span style="font-size: 10px; color: var(--color-text-muted);">${timeStr}</span>
                </div>
                <div style="font-size: 11px; color: var(--color-white); opacity: 0.85;"><strong>Lleva:</strong> ${itemsSummary}</div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.8125rem; font-weight: 700; color: var(--color-white); font-family: monospace;">$${group.total.toFixed(2)} <span style="font-size: 9px; font-weight: 500; color: var(--color-text-muted);">(Bs. ${(group.total * rate).toFixed(2)})</span></span>
                    <div style="display: flex; gap: 0.35rem;">
                        <button class="btn-day-client-invoice" data-idx="${idx}" title="Ver / Imprimir Factura POS SENIAT" style="height: 30px; padding: 0 0.6rem; font-size: 0.7rem; background-color: rgba(212,175,55,0.18); color: var(--color-gold); border: 1px solid rgba(212,175,55,0.4); font-weight: 800; border-radius: 6px; cursor: pointer;">
                            <i class="fa-solid fa-receipt"></i> Factura
                        </button>
                        <button class="btn-day-client-whatsapp" data-idx="${idx}" title="Compartir Ticket" style="height: 30px; width: 32px; font-size: 0.75rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: var(--color-success); cursor: pointer;">
                            <i class="fa-brands fa-whatsapp"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    modalBody.innerHTML = `
        <div style="background: rgba(201, 162, 74, 0.08); border: 1px solid rgba(201, 162, 74, 0.25); border-radius: var(--radius-md); padding: 0.6rem 0.85rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
                <span style="color: var(--color-white); font-weight: 700;"><i class="fa-solid fa-calendar-day" style="color: var(--color-gold); margin-right: 0.35rem;"></i> ${opts.shift ? 'Corte de turno:' : 'Fecha del Cierre:'}</span>
                <span style="color: var(--color-gold); font-weight: 900; font-family: monospace; margin-left: 0.25rem;">${reportDateText}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem;">
                <span style="color: var(--color-text-muted); font-weight: 700;">💱 Tasa BCV:</span>
                <input type="number" id="modal-report-bcv-input" step="0.01" value="${rate.toFixed(2)}" class="form-input" style="width: 85px; height: 26px; font-size: 0.75rem; padding: 0 0.4rem; text-align: center; font-weight: 800; color: var(--color-gold); background: var(--v-0-0-0-4, rgba(0, 0, 0, 0.4)); border: 1px solid var(--color-gold);">
                <span style="color: var(--color-text-muted); font-size: 0.7rem;">Bs.</span>
            </div>
        </div>

        <div style="margin-bottom: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <h4 style="font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; font-weight: 900; letter-spacing: 0.05em; margin: 0;">Ventas por Producto</h4>
                <span style="font-size: 10px; color: var(--color-gold); font-weight: 700;">${totalItemsSold} unid. vendidas</span>
            </div>
            ${salesHtml || `<div style="font-size: 0.75rem; color: var(--color-text-muted); text-align: center; padding: 0.5rem 0;">${opts.shift ? 'No hubo ventas en este turno.' : 'No hubo ventas hoy.'}</div>`}
        </div>

        <div style="margin-bottom: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <h4 style="font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; font-weight: 900; letter-spacing: 0.05em; margin: 0;">Ventas por Cliente</h4>
                <span style="font-size: 10px; color: var(--color-gold); font-weight: 700;">${clientAccounts.length} cuenta${clientAccounts.length === 1 ? '' : 's'} cerrada${clientAccounts.length === 1 ? '' : 's'}</span>
            </div>
            ${clientsHtml || '<div style="font-size: 0.75rem; color: var(--color-text-muted); text-align: center; padding: 0.5rem 0;">No hay cuentas de clientes cerradas ese día.</div>'}
        </div>

        <div style="margin-bottom: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <h4 style="font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; font-weight: 900; letter-spacing: 0.05em; margin: 0;">Gastos del Local</h4>
                <span style="font-size: 10px; color: var(--color-danger); font-weight: 700;">${expenses.length} gastos</span>
            </div>
            ${expensesHtml || '<div style="font-size: 0.75rem; color: var(--color-text-muted); text-align: center; padding: 0.5rem 0;">Sin gastos registrados.</div>'}
        </div>

        ${shiftsHtml}

        <div style="border-top: 2px solid rgba(255,255,255,0.1); padding-top: 0.75rem;">
            <h4 style="font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 0.5rem; font-weight: 900; letter-spacing: 0.05em;">${opts.shift ? 'Resultados del Turno' : 'Resultados Financieros'}</h4>
            <div class="summary-row">
                <span>Ingreso por Ventas:</span>
                <span style="color: var(--color-success); font-weight: 700;">+$${totalSales.toFixed(2)} <span style="font-size: 0.75rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(totalSales * rate).toFixed(2)})</span></span>
            </div>
            ${totalDelivery > 0 ? `
            <div class="summary-row" style="font-size: 0.75rem; color: var(--color-text-muted);">
                <span>&nbsp;&nbsp;de eso, 🛵 delivery (${deliveryCount}, fuera de IVA):</span>
                <span>$${totalDelivery.toFixed(2)} (Bs. ${(totalDelivery * rate).toFixed(2)})</span>
            </div>` : ''}
            <div class="summary-row">
                <span>Total Gastos:</span>
                <span style="color: var(--color-danger); font-weight: 700;">-$${totalExpenses.toFixed(2)} <span style="font-size: 0.75rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(totalExpenses * rate).toFixed(2)})</span></span>
            </div>
            <div class="summary-row total">
                <span>Total en Caja:</span>
                <span>$${netCash.toFixed(2)} <span style="font-size: 0.825rem; font-weight: normal; opacity: 0.8; margin-left: 0.25rem;">(Bs. ${(netCash * rate).toFixed(2)})</span></span>
            </div>
        </div>
    `;

    // Bind real-time BCV rate input inside modal
    const rateInput = document.getElementById('modal-report-bcv-input');
    if (rateInput) {
        rateInput.addEventListener('change', (e) => {
            const newRate = parseFloat(e.target.value);
            if (!isNaN(newRate) && newRate > 0) {
                if (window.currentReportData) {
                    window.currentReportData.rate = newRate;
                }
                renderDayCloseModal(salesLog, expenses, products, customDateLabel, newRate, opts);
            }
        });
    }

    // Bind per-client "Factura POS" / WhatsApp share buttons. These reuse
    // the same read-only receipt modal and message builder as the live
    // Clientes historial (see renderClientesView's btn-pos-ticket-client),
    // so a closed account from any past day prints/shares identically to
    // one closed today.
    modalBody.querySelectorAll('.btn-day-client-invoice').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const group = clientAccounts[parseInt(e.currentTarget.dataset.idx, 10)];
            if (!group) return;
            showPosReceiptModal({
                cart: group.items,
                clientName: group.clientName,
                clientRif: group.clientRif,
                timestamp: group.timestamp,
                facNo: (group.timestamp.replace(/\D/g, '') + '0000').substring(0, 16),
                isAlreadyPaid: true,
                payMethod: group.paymentMethod || 'Efectivo',
                rate: group.bcvRate || rate
            });
        });
    });

    modalBody.querySelectorAll('.btn-day-client-whatsapp').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const group = clientAccounts[parseInt(e.currentTarget.dataset.idx, 10)];
            if (!group) return;
            let msg = `*CASA LUCCENZO* 🥖\n`;
            msg += `*Ticket de Consumo* 🧾\n`;
            msg += group.clientRif ? `👤 *Cliente:* ${group.clientName} (${group.clientRif})\n` : `👤 *Cliente:* ${group.clientName}\n`;
            msg += `--------------------------------------\n`;
            group.items.forEach(it => {
                msg += `• ${it.quantity}x ${it.name} - $${(it.price * it.quantity).toFixed(2)}\n`;
            });
            msg += `--------------------------------------\n`;
            msg += `💵 *Total a Pagar:* *$${group.total.toFixed(2)} USD*\n`;
            msg += `💵 *Tasa BCV:* ${rate.toFixed(2)} Bs.\n`;
            msg += `🇻🇪 *Total en Bolívares:* *Bs. ${(group.total * rate).toFixed(2)} VES*\n`;
            msg += `--------------------------------------\n`;
            msg += `¡Muchas gracias por su compra! 🌟`;
            window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
        });
    });
}
