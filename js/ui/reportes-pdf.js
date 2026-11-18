// Exportación de reportes a PDF (cierre, por hora, analítica, P&L).
//
// Antes formaba parte de js/ui.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

/**
 * Export daily box close report to PDF
 * @param {Array} salesLog 
 * @param {Array} expenses 
 * @param {Array} products 
 */
function exportDayCloseToPDF(salesLog = [], expenses = [], products = [], customDateLabel = null, customRate = null) {
    const activeRole = sessionStorage.getItem('casa_lucenzo_active_role');
    if (activeRole !== 'admin') return;

    const totalSales = salesLog.reduce((sum, sale) => sum + (sale.price || 0), 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const netCash = totalSales - totalExpenses;
    const rate = (customRate && !isNaN(parseFloat(customRate)) && parseFloat(customRate) > 0) ? parseFloat(customRate) : (window.bcvRate || 1);
    // Costo de producción (tercero). Congelado en cost_at_sale por venta;
    // para días viejos sin ese dato se estima con el costo actual por
    // unidad -- misma lógica compartida con el resumen de Ganancias.
    const prodCost = window.AnalyticsManager.estimateProductionCost(salesLog, products, rate);
    const isEstimatedCost = prodCost.isEstimated;
    const productionCostBsForDisplay = prodCost.bs;
    const netMarginBs = (totalSales * rate) - productionCostBsForDisplay;

    // Group sales by category and product
    const categorySales = {
        'pasteles': { label: '🥐 Pasteles y Repostería', items: {} },
        'bebidas': { label: '🥤 Bebidas', items: {} },
        'dulces': { label: '🍬 Dulces', items: {} },
        'extra': { label: '🛍️ Productos extra (comprados afuera)', items: {} },
        'personal': { label: '👥 Consumo del personal (al costo)', items: {} },
        'delivery': { label: '🛵 Delivery (fuera de IVA)', items: {} }
    };

    salesLog.forEach(sale => {
        if (sale.productId === 'abono') return;

        // Find product category
        const prod = products.find(p => p.id === sale.productId);
        let category = 'pasteles'; // fallback default
        if (window.Combos && window.Combos.isDeliverySale(sale)) {
            category = 'delivery';
        } else if (window.Combos && window.Combos.isExtraSale(sale)) {
            category = 'extra';
        } else if (window.Combos && window.Combos.isStaffSale(sale)) {
            category = 'personal';
        } else if (prod && prod.category === 'bebidas') {
            category = 'bebidas';
        } else if (prod && prod.category === 'dulces') {
            category = 'dulces';
        } else if (prod && (prod.category === 'pastelitos' || prod.category === 'empanadas' || prod.category === 'minis')) {
            category = 'pasteles';
        } else {
            // Check if name suggests beverage
            const nameLower = sale.name.toLowerCase();
            if (nameLower.includes('malta') || nameLower.includes('refresco') || nameLower.includes('agua') || nameLower.includes('jugo')) {
                category = 'bebidas';
            }
        }
        
        let cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
        if (!categorySales[category].items[cleanName]) {
            categorySales[category].items[cleanName] = { count: 0, price: sale.price || 0, total: 0 };
        }
        categorySales[category].items[cleanName].count++;
        categorySales[category].items[cleanName].total += sale.price || 0;
    });

    // Group payment methods
    const methods = {
        'Efectivo $': { label: 'Efectivo Divisas ($)', count: 0, amount: 0 },
        'Pago Móvil': { label: 'Pago Móvil (Bs.)', count: 0, amount: 0 },
        'Punto de Venta': { label: 'Punto de Venta (Bs.)', count: 0, amount: 0 },
        'Efectivo Bs.': { label: 'Efectivo Bolívares (Bs.)', count: 0, amount: 0 },
        'Deuda / Crédito': { label: 'Cuentas por Cobrar (Créditos)', count: 0, amount: 0 }
    };

    salesLog.forEach(s => {
        let method = 'Efectivo $';
        const match = s.name.match(/\(Pagado - (.*?)\)/);
        if (match) {
            const parsed = match[1];
            if (methods[parsed]) method = parsed;
        } else if (s.name.includes('(Pendiente)')) {
            method = 'Deuda / Crédito';
        }
        
        if (methods[method]) {
            methods[method].count++;
            methods[method].amount += s.price || 0;
        }
    });

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
        .logo-area {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        .logo-circle {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background-image: url('img/logo-192.png');
            background-size: 108% 108%;
            background-position: center;
            background-repeat: no-repeat;
            border: 2px solid #C9A24A;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .logo-text h1 {
            font-family: 'Playfair Display', serif;
            font-size: 1.8rem;
            margin: 0;
            color: #0b1329;
            font-weight: 900;
            letter-spacing: -0.02em;
        }
        .logo-text p {
            font-size: 0.85rem;
            margin: 0;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            font-weight: 800;
        }
        .report-meta {
            text-align: right;
        }
        .report-meta h2 {
            font-size: 1.25rem;
            margin: 0;
            color: #d97706;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-weight: 900;
        }
        .report-meta p {
            font-size: 0.85rem;
            margin: 0.25rem 0 0;
            color: #475569;
        }
        .kpi-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.25rem;
            margin-bottom: 2rem;
        }
        .kpi-card {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 1.25rem;
            text-align: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .kpi-label {
            font-size: 0.8rem;
            color: #64748b;
            text-transform: uppercase;
            font-weight: 800;
            letter-spacing: 0.05em;
        }
        .kpi-val {
            font-size: 1.85rem;
            font-weight: 900;
            color: #0b1329;
            margin-top: 0.35rem;
        }
        .kpi-subval {
            font-size: 0.95rem;
            color: #475569;
            font-weight: 600;
            margin-top: 0.2rem;
        }
        .section-title {
            font-size: 1rem;
            text-transform: uppercase;
            font-weight: 900;
            color: #0b1329;
            margin-top: 2rem;
            margin-bottom: 1rem;
            letter-spacing: 0.08em;
            border-bottom: 2px solid #f1f5f9;
            padding-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.35rem;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 0.5rem;
        }
        th {
            background-color: #f8fafc;
            color: #475569;
            font-size: 0.9rem;
            text-transform: uppercase;
            font-weight: 800;
            text-align: left;
            padding: 0.95rem;
            border-bottom: 2px solid #cbd5e1;
            letter-spacing: 0.02em;
        }
        td {
            padding: 0.95rem;
            font-size: 0.9rem;
            border-bottom: 1px solid #f1f5f9;
            color: #334155;
        }
        tr:nth-child(even) {
            background-color: #fcfdfe;
        }
        .footer {
            margin-top: 3.5rem;
            border-top: 1px solid #e2e8f0;
            padding-top: 1.25rem;
            text-align: center;
            font-size: 0.7rem;
            color: #94a3b8;
        }
        .signature-row {
            display: flex;
            justify-content: space-around;
            margin-top: 4rem;
            margin-bottom: 2rem;
        }
        .signature-box {
            border-top: 1px solid #475569;
            width: 200px;
            text-align: center;
            padding-top: 0.5rem;
            font-size: 0.8rem;
            color: #475569;
            font-weight: bold;
        }
        .btn-print-action {
            background-color: #0b1329;
            color: #ffffff;
            border: 1px solid #C9A24A;
            padding: 0.6rem 1.75rem;
            font-size: 0.8rem;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            box-shadow: 0 4px 6px rgba(0,0,0,0.15);
            transition: all 0.2s;
        }
        .btn-print-action:hover {
            background-color: #172242;
            color: #C9A24A;
        }
        @media print {
            body {
                padding: 0;
            }
            .no-print {
                display: none !important;
            }
            * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
        }
    `;

    let productRowsHtml = '';
    
    // Render Pasteles
    const pastelesItems = Object.entries(categorySales['pasteles'].items);
    if (pastelesItems.length > 0) {
        productRowsHtml += `
            <tr style="background-color: var(--v-11-19-41-04, rgba(11, 19, 41, 0.04)); font-weight: 800;">
                <td colspan="4" style="color: #0b1329; border-bottom: 2px solid #0b1329; padding-top: 1.5rem; text-align: left;">🥐 PASTELES Y COMIDA</td>
            </tr>
        `;
        pastelesItems.forEach(([name, data]) => {
            productRowsHtml += `
                <tr>
                    <td style="padding-left: 1.5rem;">${name}</td>
                    <td>${data.count} uds.</td>
                    <td style="font-weight: 600;">$${data.total.toFixed(2)}</td>
                    <td style="color: #64748b;">Bs. ${(data.total * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                </tr>
            `;
        });
    }
    
    // Render Bebidas
    const bebidasItems = Object.entries(categorySales['bebidas'].items);
    if (bebidasItems.length > 0) {
        productRowsHtml += `
            <tr style="background-color: var(--v-11-19-41-04, rgba(11, 19, 41, 0.04)); font-weight: 800;">
                <td colspan="4" style="color: #0b1329; border-bottom: 2px solid #0b1329; padding-top: 1.5rem; text-align: left;">🥤 BEBIDAS</td>
            </tr>
        `;
        bebidasItems.forEach(([name, data]) => {
            productRowsHtml += `
                <tr>
                    <td style="padding-left: 1.5rem;">${name}</td>
                    <td>${data.count} uds.</td>
                    <td style="font-weight: 600;">$${data.total.toFixed(2)}</td>
                    <td style="color: #64748b;">Bs. ${(data.total * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                </tr>
            `;
        });
    }

    // Render Dulces
    const dulcesItems = Object.entries(categorySales['dulces'].items);
    if (dulcesItems.length > 0) {
        productRowsHtml += `
            <tr style="background-color: var(--v-11-19-41-04, rgba(11, 19, 41, 0.04)); font-weight: 800;">
                <td colspan="4" style="color: #0b1329; border-bottom: 2px solid #0b1329; padding-top: 1.5rem; text-align: left;">🍬 DULCES</td>
            </tr>
        `;
        dulcesItems.forEach(([name, data]) => {
            productRowsHtml += `
                <tr>
                    <td style="padding-left: 1.5rem;">${name}</td>
                    <td>${data.count} uds.</td>
                    <td style="font-weight: 600;">$${data.total.toFixed(2)}</td>
                    <td style="color: #64748b;">Bs. ${(data.total * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                </tr>
            `;
        });
    }

    // Consumo del personal, aparte: entra a caja pero no es venta al público
    const personalItems = Object.entries(categorySales['personal'].items);
    if (personalItems.length > 0) {
        productRowsHtml += `
            <tr style="background-color: var(--v-11-19-41-04, rgba(11, 19, 41, 0.04)); font-weight: 800;">
                <td colspan="4" style="color: #0b1329; border-bottom: 2px solid #0b1329; padding-top: 1.5rem; text-align: left;">👥 CONSUMO DEL PERSONAL (AL COSTO)</td>
            </tr>
        `;
        personalItems.forEach(([name, data]) => {
            productRowsHtml += `
                <tr>
                    <td style="padding-left: 1.5rem;">${name}</td>
                    <td>${data.count} uds.</td>
                    <td style="font-weight: 600;">$${data.total.toFixed(2)}</td>
                    <td style="color: #64748b;">Bs. ${(data.total * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                </tr>
            `;
        });
    }

    if (pastelesItems.length === 0 && bebidasItems.length === 0 && dulcesItems.length === 0 && personalItems.length === 0) {
        productRowsHtml = '<tr><td colspan="4" style="text-align: center; color: #64748b;">No hubo ventas registradas hoy.</td></tr>';
    }

    let methodRowsHtml = '';
    Object.entries(methods).forEach(([key, m]) => {
        if (m.count > 0) {
            methodRowsHtml += `
                <tr>
                    <td>${m.label}</td>
                    <td>${m.count} trans.</td>
                    <td style="font-weight: 600;">$${m.amount.toFixed(2)}</td>
                    <td style="color: #64748b;">Bs. ${(m.amount * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                </tr>
            `;
        }
    });
    if (methodRowsHtml === '') {
        methodRowsHtml = '<tr><td colspan="4" style="text-align: center; color: #64748b;">Sin transacciones.</td></tr>';
    }

    let expenseRowsHtml = '';
    expenses.forEach(exp => {
        expenseRowsHtml += `
            <tr>
                <td>${exp.description}</td>
                <td style="color: #ef4444; font-weight: 600;">-$${exp.amount.toFixed(2)}</td>
                <td style="color: #64748b;">Bs. ${(exp.amount * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
            </tr>
        `;
    });
    if (expenseRowsHtml === '') {
        expenseRowsHtml = '<tr><td colspan="3" style="text-align: center; color: #64748b;">Sin gastos registrados hoy.</td></tr>';
    }

    const dateLabel = customDateLabel || new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Reporte de Cierre de Caja - Casa Lucenzo</title>
            <style>${css}</style>
        </head>
        <body>
            <div class="header">
                <div class="logo-area">
                    <div class="logo-circle"></div>
                    <div class="logo-text">
                        <h1>CASA LUCENZO</h1>
                        <p>Pastelería & Bebidas</p>
                    </div>
                </div>
                <div class="report-meta">
                    <h2>Cierre de Jornada Diaria</h2>
                    <p><strong>Fecha de Cierre:</strong> ${dateLabel}</p>
                    <p><strong>Tasa BCV del Día:</strong> ${rate.toFixed(2)} Bs.</p>
                </div>
            </div>

            <div class="kpi-row">
                <div class="kpi-card" style="border-color: #10b981; background-color: rgba(16,185,129,0.01);">
                    <div class="kpi-label" style="color: #059669;">Total Facturado (Ingresos)</div>
                    <div class="kpi-val" style="color: #059669;">$${totalSales.toFixed(2)}</div>
                    <div class="kpi-subval" style="color: #059669;">Bs. ${(totalSales * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
                </div>
                <div class="kpi-card" style="border-color: #ef4444; background-color: rgba(239,68,68,0.01);">
                    <div class="kpi-label" style="color: #dc2626;">Total Gastos (Egresos)</div>
                    <div class="kpi-val" style="color: #dc2626;">-$${totalExpenses.toFixed(2)}</div>
                    <div class="kpi-subval" style="color: #dc2626;">Bs. ${(totalExpenses * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
                </div>
                <div class="kpi-card" style="border-color: #C9A24A; background-color: rgba(243,198,63,0.02);">
                    <div class="kpi-label" style="color: #b45309;">Balance Neto (Caja Estimado)</div>
                    <div class="kpi-val" style="color: #b45309;">$${netCash.toFixed(2)}</div>
                    <div class="kpi-subval" style="color: #b45309;">Bs. ${(netCash * rate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
                </div>
            </div>

            <div class="kpi-row">
                <div class="kpi-card" style="border-color: #ef4444; background-color: rgba(239,68,68,0.01);">
                    <div class="kpi-label" style="color: #dc2626;">Costo de Producción (Terceros)${isEstimatedCost ? ' (Estimado)' : ''}</div>
                    <div class="kpi-val" style="color: #dc2626;">-Bs. ${productionCostBsForDisplay.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
                    ${isEstimatedCost ? '<div style="font-size: 0.65rem; color: #94a3b8; margin-top: 0.2rem; font-style: italic;">Estimado con el costo actual por unidad -- no es el dato exacto de ese día</div>' : ''}
                    ${productionCostBsForDisplay === 0 && totalSales > 0 ? '<div style="font-size: 0.65rem; color: #94a3b8; margin-top: 0.2rem; font-style: italic;">Sin dato de costo para este día -- no es que haya costado $0</div>' : ''}
                </div>
                <div class="kpi-card" style="border-color: #10b981; background-color: rgba(16,185,129,0.01);">
                    <div class="kpi-label" style="color: #059669;">Margen Real (Ventas - Producción)</div>
                    <div class="kpi-val" style="color: #059669;">Bs. ${netMarginBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
                    ${isEstimatedCost ? '<div style="font-size: 0.65rem; color: #94a3b8; margin-top: 0.2rem; font-style: italic;">Calculado con costo de producción estimado</div>' : ''}
                    ${productionCostBsForDisplay === 0 && totalSales > 0 ? '<div style="font-size: 0.65rem; color: #94a3b8; margin-top: 0.2rem; font-style: italic;">Estimado sin descontar producción (dato no disponible)</div>' : ''}
                </div>
            </div>

            <div class="section-title">
                <span>💰 Desglose por Métodos de Pago</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Método de Pago</th>
                        <th>Transacciones</th>
                        <th>Monto ($ USD)</th>
                        <th>Monto (Bs. VES)</th>
                    </tr>
                </thead>
                <tbody>
                    ${methodRowsHtml}
                </tbody>
            </table>

            <div class="section-title">
                <span>🥐 Detalle de Artículos Vendidos</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Producto</th>
                        <th>Cantidad Vendida</th>
                        <th>Subtotal ($ USD)</th>
                        <th>Subtotal (Bs. VES)</th>
                    </tr>
                </thead>
                <tbody>
                    ${productRowsHtml}
                </tbody>
            </table>

            <div class="section-title">
                <span>💸 Gastos del Día</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Descripción del Gasto</th>
                        <th>Monto ($ USD)</th>
                        <th>Monto (Bs. VES)</th>
                    </tr>
                </thead>
                <tbody>
                    ${expenseRowsHtml}
                </tbody>
            </table>

            <div class="signature-row">
                <div class="signature-box">Firma del Cajero / Local</div>
                <div class="signature-box">Firma del Administrador</div>
            </div>

            <div class="footer">
                <p>Cierre de caja oficial del día - Generado por el Sistema Casa Lucenzo.</p>
                <p class="no-print" style="margin-top: 1.75rem;">
                    <button class="btn-print-action" onclick="window.print()">
                        📥 Imprimir / Guardar PDF
                    </button>
                </p>
            </div>
            
            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 400);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/**
 * Export hourly sales stats report to PDF using the print window method
 * @param {Array} salesLog Sales array
 * @param {string} mode 'today' or 'weekly'
 */
function exportHourlyStatsToPDF(salesLog, mode = 'today') {
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
        filteredSales = salesLog;
    }

    const hourlyData = {};
    let totalSalesVal = 0;
    let totalSalesQty = 0;
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
            totalSalesVal += s.price || 0;
            totalSalesQty++;
        } else {
            outsideCount++;
            outsideRevenue += s.price || 0;
            totalSalesVal += s.price || 0;
            totalSalesQty++;
        }
    });

    let peakHour = -1;
    let maxRevenue = 0;
    targetHours.forEach(h => {
        if (hourlyData[h].revenue > maxRevenue) {
            maxRevenue = hourlyData[h].revenue;
            peakHour = h;
        }
    });

    const scaleMax = Math.max(...targetHours.map(h => hourlyData[h].revenue), outsideRevenue, 1.0);
    const rate = window.bcvRate || 1;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Por favor, permite las ventanas emergentes para poder descargar el PDF.");
        return;
    }

    function getConsultantInsights(hourlyData, peakHour, totalSalesVal, outsideRevenue) {
        let mainInsight;
        let points;

        if (totalSalesVal === 0) {
            return `
                <div class="consultant-box">
                    <div class="consultant-title">
                        <span class="consultant-badge">ASESORÍA COMERCIAL</span>
                        <span>Análisis de Rendimiento Operativo</span>
                    </div>
                    <p class="consultant-text">
                        No se registran datos suficientes en este ciclo para formular un diagnóstico de ventas. Es indispensable iniciar el registro de transacciones para evaluar el comportamiento del consumidor y diseñar estrategias de menú eficientes.
                    </p>
                </div>
            `;
        }

        // Determine the peak window type
        if (peakHour >= 6 && peakHour <= 9) {
            mainInsight = "Su pico de facturación se concentra en las primeras horas de la mañana (Desayuno Temprano). Esto evidencia un perfil de cliente dinámico y de paso, compuesto por trabajadores, estudiantes y personas en tránsito hacia sus labores diarias.";
            points = [
                "<strong>Aseguramiento de Stock Crítico a Primera Hora:</strong> Toda la vitrina de pasteles debe estar al 100% de capacidad a las 6:30 AM. Los retrasos en reposición a esta hora significan ventas perdidas que no se recuperan durante el día.",
                "<strong>Estrategia de Ticket Promedio (Up-selling):</strong> Capacite al personal de caja para ofrecer de forma activa adiciones de bebidas calientes (café) o frías (malta/jugo) con frases sugestivas como: <em>¿Le provoca acompañarlo con una bebida fría por solo $1 adicional?</em>",
                "<strong>Combos de Desayuno Veloz:</strong> Cree empaques pre-armados de Pastel + Bebida para reducir el tiempo de espera en caja a menos de 45 segundos, maximizando la rotación en horas de alto tráfico."
            ];
        } else if (peakHour >= 10 && peakHour <= 12) {
            mainInsight = "Su volumen principal de ventas se registra en la media mañana. Este comportamiento indica una fuerte demanda de meriendas y desayunos tardíos, típicamente impulsados por clientes corporativos o visitas de descanso intermedio.";
            points = [
                "<strong>Ingeniería de Menú de Media Mañana:</strong> Introduzca variedades de pasteles especiales (como Primavera o 4 Estaciones) en su máxima disponibilidad durante este bloque, ya que el cliente de media mañana está más dispuesto a gastar un ticket más elevado por productos premium.",
                "<strong>Rotación Planificada de Vitrina:</strong> Realice una reposición de pasteles frescos exactamente a las 9:30 AM para mantener el atractivo visual de la vitrina justo antes del incremento de flujo.",
                "<strong>Promoción Cruzada Digital:</strong> Utilice estados de WhatsApp a las 9:00 AM mostrando pasteles recién horneados para motivar la compra de oficinas cercanas."
            ];
        } else if (peakHour >= 13 && peakHour <= 15) {
            mainInsight = "Su hora pico coincide con el rango de almuerzo y tarde temprana. Esto refleja que sus productos están siendo consumidos como opciones de almuerzo práctico o meriendas de mediodía.";
            points = [
                "<strong>Introducción de Combos de Almuerzo Express:</strong> Diseñe combos atractivos de 2 pasteles tradicionales + bebida refrescante con un precio psicológico cerrado (ej. Combos de $3 o $4) para capturar el mercado de almuerzos rápidos de oficinas locales.",
                "<strong>Monitoreo de Quiebres de Stock:</strong> La producción de cocina debe asegurar un último lote caliente a las 12:00 PM para responder con frescura durante todo el bloque del mediodía.",
                "<strong>Foco en Bebidas Frías:</strong> En las horas de mayor calor, el margen de ganancia de bebidas frías es crucial. Mantenga los exhibidores de bebidas a temperatura óptima y bien visibles."
            ];
        } else {
            mainInsight = "Se observa una distribución de ventas estable a lo largo del día. Esto representa un flujo continuo, ideal para sostener la frescura del producto sin saturar la capacidad de servicio.";
            points = [
                "<strong>Planificación de Hornada en Lotes Pequeños:</strong> En lugar de hornear todo al inicio, hornee lotes pequeños cada 2 horas para garantizar que el cliente siempre reciba un producto con textura y calor óptimos.",
                "<strong>Fidelización de Clientes Recurrentes:</strong> Implemente una tarjeta de cliente frecuente simple (ej. el décimo pastel es gratis) para asegurar que el flujo constante se mantenga leal a su marca.",
                "<strong>Optimización de Surtido:</strong> Mantenga un control de cuáles sabores rotan menos para reducir su producción y aumentar el espacio de exhibición para los sabores estrella (Carne Mechada y Pollo)."
            ];
        }

        // Add advice regarding outside hours if any
        if (outsideRevenue > 0) {
            const outsidePct = ((outsideRevenue / totalSalesVal) * 100).toFixed(1);
            points.push(
                `<strong>Análisis de Demanda Fuera de Horario (Representa el ${outsidePct}% de ventas):</strong> Ha facturado $${outsideRevenue.toFixed(2)} USD fuera del rango operativo de 6 AM a 3 PM. Esto demuestra un mercado desatendido por las tardes. Considere realizar ofertas tipo "Hora Feliz" a partir de las 2:30 PM para liquidar inventario remanente o evalúe la viabilidad de extender la jornada de venta 1 hora más.`
            );
        }

        // Generate HTML
        let pointsHtml = points.map(p => `<li>${p}</li>`).join('');
        return `
            <div class="consultant-box">
                <div class="consultant-title">
                    <span class="consultant-badge">ASESORÍA DE VENTAS PROFESIONAL</span>
                    <span>Análisis Estratégico y Diagnóstico Comercial</span>
                </div>
                <p class="consultant-text">
                    <strong>Diagnóstico del Flujo Comercial:</strong> ${mainInsight} A continuación, se detallan las recomendaciones estratégicas para incrementar la rentabilidad del negocio:
                </p>
                <ul class="consultant-points">
                    ${pointsHtml}
                </ul>
            </div>
        `;
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
        .logo-area {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        .logo-circle {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background-image: url('img/logo-192.png');
            background-size: 108% 108%;
            background-position: center;
            background-repeat: no-repeat;
            border: 2px solid #C9A24A;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .logo-text h1 {
            font-family: 'Playfair Display', serif;
            font-size: 1.8rem;
            margin: 0;
            color: #0b1329;
            font-weight: 900;
            letter-spacing: -0.02em;
        }
        .logo-text p {
            font-size: 0.85rem;
            margin: 0;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            font-weight: 800;
        }
        .report-meta {
            text-align: right;
        }
        .report-meta h2 {
            font-size: 1.25rem;
            margin: 0;
            color: #d97706;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-weight: 900;
        }
        .report-meta p {
            font-size: 0.85rem;
            margin: 0.25rem 0 0;
            color: #475569;
        }
        .kpi-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.25rem;
            margin-bottom: 2rem;
        }
        .kpi-card {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 1.25rem;
            text-align: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .kpi-label {
            font-size: 0.8rem;
            color: #64748b;
            text-transform: uppercase;
            font-weight: 800;
            letter-spacing: 0.05em;
        }
        .kpi-val {
            font-size: 1.85rem;
            font-weight: 900;
            color: #0b1329;
            margin-top: 0.35rem;
        }
        .kpi-subval {
            font-size: 0.95rem;
            color: #475569;
            font-weight: 600;
            margin-top: 0.2rem;
        }
        .section-title {
            font-size: 1rem;
            text-transform: uppercase;
            font-weight: 900;
            color: #0b1329;
            margin-top: 2rem;
            margin-bottom: 1rem;
            letter-spacing: 0.08em;
            border-bottom: 2px solid #f1f5f9;
            padding-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.35rem;
        }
        .chart-container-print {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            height: 190px;
            padding: 1.5rem;
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            margin-bottom: 2rem;
        }
        .chart-col {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex: 1;
            height: 100%;
            justify-content: flex-end;
            gap: 0.35rem;
        }
        .chart-fill {
            width: 18px;
            background: linear-gradient(180deg, #10b981, #059669);
            border-radius: 4px 4px 0 0;
            min-height: 2px;
        }
        .chart-col.peak .chart-fill {
            background: linear-gradient(180deg, #C9A24A, #d97706) !important;
        }
        .chart-col-val {
            font-size: 9.5px;
            font-weight: 800;
            color: #475569;
        }
        .chart-col.peak .chart-col-val {
            color: #b45309;
            font-weight: 900;
        }
        .chart-col-label {
            font-size: 9.5px;
            color: #64748b;
            font-weight: 700;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 0.5rem;
        }
        th {
            background-color: #f8fafc;
            color: #475569;
            font-size: 0.9rem;
            text-transform: uppercase;
            font-weight: 800;
            text-align: left;
            padding: 0.95rem;
            border-bottom: 2px solid #cbd5e1;
            letter-spacing: 0.02em;
        }
        td {
            padding: 0.95rem;
            font-size: 0.9rem;
            border-bottom: 1px solid #f1f5f9;
            color: #334155;
        }
        tr:nth-child(even) {
            background-color: #fcfdfe;
        }
        .footer {
            margin-top: 3.5rem;
            border-top: 1px solid #e2e8f0;
            padding-top: 1.25rem;
            text-align: center;
            font-size: 0.7rem;
            color: #94a3b8;
        }
        .btn-print-action {
            background-color: #0b1329;
            color: #ffffff;
            border: 1px solid #C9A24A;
            padding: 0.6rem 1.75rem;
            font-size: 0.8rem;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            box-shadow: 0 4px 6px rgba(0,0,0,0.15);
            transition: all 0.2s;
        }
        .btn-print-action:hover {
            background-color: #172242;
            color: #C9A24A;
        }
        .consultant-box {
            background-color: #fdfbf7;
            border: 1.5px solid #C9A24A;
            border-left: 5px solid #d97706;
            border-radius: 8px;
            padding: 1.5rem;
            margin-top: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 4px 6px rgba(0,0,0,0.02);
            page-break-inside: avoid;
        }
        .consultant-title {
            font-size: 1.05rem;
            font-weight: 900;
            color: #0b1329;
            margin-top: 0;
            margin-bottom: 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .consultant-badge {
            background-color: #C9A24A;
            color: #000;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 800;
        }
        .consultant-text {
            font-size: 0.85rem;
            color: #334155;
            margin: 0;
            text-align: justify;
        }
        .consultant-points {
            margin-top: 0.75rem;
            padding-left: 1.25rem;
            font-size: 0.85rem;
            color: #334155;
        }
        .consultant-points li {
            margin-bottom: 0.5rem;
        }
        @media print {
            body {
                padding: 0;
            }
            .no-print {
                display: none !important;
            }
            * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
        }
    `;

    let chartColsHtml = '';
    targetHours.forEach(h => {
        const data = hourlyData[h];
        const isPeak = h === peakHour && data.revenue > 0;
        const pct = (data.revenue / scaleMax) * 100;
        const labelStr = h >= 12 ? (h === 12 ? '12 PM' : `${h - 12} PM`) : `${h} AM`;
        chartColsHtml += `
            <div class="chart-col ${isPeak ? 'peak' : ''}">
                <div class="chart-col-val">$${data.revenue.toFixed(1)}</div>
                <div class="chart-fill" style="height: ${pct}%;"></div>
                <div class="chart-col-label">${labelStr}</div>
            </div>
        `;
    });

    if (outsideCount > 0) {
        const outsidePct = (outsideRevenue / scaleMax) * 100;
        chartColsHtml += `
            <div class="chart-col" style="border-left: 1px dashed #cbd5e1; padding-left: 4px;">
                <div class="chart-col-val" style="color: #ef4444;">$${outsideRevenue.toFixed(1)}</div>
                <div class="chart-fill" style="height: ${outsidePct}%; background: linear-gradient(180deg, #ef4444, #991b1b);"></div>
                <div class="chart-col-label" style="color: #ef4444;">Fuera H.</div>
            </div>
        `;
    }

    let tableRowsHtml = '';
    targetHours.forEach(h => {
        const data = hourlyData[h];
        const isPeak = h === peakHour && data.revenue > 0;
        const labelStr = h >= 12 ? (h === 12 ? '12:00 PM' : `${h - 12}:00 PM`) : `${h}:00 AM`;
        const revenueVES = data.revenue * rate;
        
        tableRowsHtml += `
            <tr style="${isPeak ? 'background-color: rgba(243,198,63,0.05); font-weight: 700;' : ''}">
                <td style="${isPeak ? 'color: #b45309;' : ''}">${labelStr} ${isPeak ? '👑 (Hora Pico)' : ''}</td>
                <td>${data.count}</td>
                <td style="font-weight: 600;">$${data.revenue.toFixed(2)}</td>
                <td style="color: #64748b;">Bs. ${revenueVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
        `;
    });

    if (outsideCount > 0) {
        const outsideRevenueVES = outsideRevenue * rate;
        tableRowsHtml += `
            <tr style="background-color: rgba(239, 68, 68, 0.02); font-style: italic;">
                <td style="color: #ef4444; font-weight: 600;">Ventas fuera del horario de registro (Antes 6 AM / Después 3 PM)</td>
                <td>${outsideCount}</td>
                <td style="font-weight: 600; color: #ef4444;">$${outsideRevenue.toFixed(2)}</td>
                <td style="color: #64748b;">Bs. ${outsideRevenueVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
        `;
    }

    const dateLabel = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const periodLabel = mode === 'today' ? 'Diario (Hoy)' : 'Semanal (Últimos 7 Días)';
    const peakHourLabel = peakHour !== -1 && hourlyData[peakHour].revenue > 0 
        ? `${peakHour >= 12 ? (peakHour === 12 ? '12:00 PM' : `${peakHour - 12}:00 PM`) : `${peakHour}:00 AM`}` 
        : 'N/D';

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Reporte de Ventas por Hora - Casa Lucenzo</title>
            <style>${css}</style>
        </head>
        <body>
            <div class="header">
                <div class="logo-area">
                    <div class="logo-circle"></div>
                    <div class="logo-text">
                        <h1>CASA LUCENZO</h1>
                        <p>Pastelería & Bebidas</p>
                    </div>
                </div>
                <div class="report-meta">
                    <h2>Reporte Horario de Ventas</h2>
                    <p><strong>Período:</strong> ${periodLabel}</p>
                    <p><strong>Fecha de Emisión:</strong> ${dateLabel}</p>
                </div>
            </div>

            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-label">Ingresos Totales</div>
                    <div class="kpi-val">$${totalSalesVal.toFixed(2)}</div>
                    <div class="kpi-subval">Bs. ${(totalSalesVal * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Artículos Vendidos</div>
                    <div class="kpi-val">${totalSalesQty} unids.</div>
                    <div class="kpi-subval">Tasa Oficial: ${rate.toFixed(2)} Bs.</div>
                </div>
                <div class="kpi-card" style="border-color: #C9A24A; background-color: rgba(243,198,63,0.02);">
                    <div class="kpi-label" style="color: #b45309;">Hora Pico (6am-3pm)</div>
                    <div class="kpi-val" style="color: #b45309;">${peakHourLabel}</div>
                    <div class="kpi-subval" style="color: #b45309; font-weight: 700;">
                        ${peakHour !== -1 && hourlyData[peakHour].revenue > 0 ? `$${hourlyData[peakHour].revenue.toFixed(2)} (${hourlyData[peakHour].count} ventas)` : 'Sin Movimiento'}
                    </div>
                </div>
            </div>

            <div class="section-title">
                <span>📊 Gráfica de Distribución de Ingresos ($ USD)</span>
            </div>
            <div class="chart-container-print">
                ${chartColsHtml}
            </div>

            <div class="section-title">
                <span>📋 Tabla de Registro y Frecuencia Horaria</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Rango Horario</th>
                        <th>Ventas (Transacciones)</th>
                        <th>Total Facturado ($ USD)</th>
                        <th>Total Facturado (Bs. VES)</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>

            ${getConsultantInsights(hourlyData, peakHour, totalSalesVal, outsideRevenue)}

            <div class="footer">
                <p>Reporte de analítica automatizado - Sistema de Gestión Casa Lucenzo.</p>
                <p class="no-print" style="margin-top: 1.75rem;">
                    <button class="btn-print-action" onclick="window.print()">
                        📥 Imprimir / Guardar PDF
                    </button>
                </p>
            </div>
            
            <script>
                // Auto trigger print dialog on printWindow load
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 400);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/**
 * Generates the detailed sales analytics report (print-to-PDF, same
 * pattern as exportDayCloseToPDF/exportHourlyStatsToPDF above): period
 * KPIs, the weekday sales pattern, the flavor ranking, a 7-day projection,
 * and a "reseñas" box with data-driven insight sentences. All the number
 * crunching comes from window.AnalyticsManager (js/analytics.js) -- this
 * function only lays it out as printable HTML.
 * @param {Array} salesHistory Sales rows for the analytics lookback range
 * @param {Array} products Product catalog
 * @param {string} rangeLabel Human label for the lookback range, e.g. "Últimos 60 días"
 */
function exportSalesAnalyticsToPDF(salesHistory = [], products = [], rangeLabel = '') {
    const AM = window.AnalyticsManager;
    if (!AM) {
        alert("No se pudo cargar el módulo de análisis.");
        return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Por favor, permite las ventanas emergentes para poder generar el PDF.");
        return;
    }

    const dailyTotals = AM.aggregateSalesByDay(salesHistory);
    const weekdayPattern = AM.getWeekdayPattern(salesHistory);
    const flavorRankingFull = AM.getFlavorRanking(salesHistory, products, { limit: null });
    const trend = AM.getRecentTrend(salesHistory, 2);
    const projection = AM.getUpcomingProjection(weekdayPattern, 7, new Date());

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayEntry = dailyTotals.find(d => d.dateStr === todayKey);
    const todayComparison = AM.compareVsWeekdayAverage(todayEntry ? todayEntry.total : 0, weekdayPattern, now.getDay());

    const insights = AM.buildPerformanceInsights({ weekdayPattern, flavorRanking: flavorRankingFull, trend, todayComparison });

    const periodTotal = dailyTotals.reduce((sum, d) => sum + d.total, 0);
    const periodDays = dailyTotals.length;
    const avgDaily = periodDays > 0 ? periodTotal / periodDays : 0;
    const bestDay = periodDays > 0 ? dailyTotals.reduce((a, b) => (b.total > a.total ? b : a)) : null;
    const worstDay = periodDays > 0 ? dailyTotals.reduce((a, b) => (b.total < a.total ? b : a)) : null;
    const fmtDayLabel = dateStr => new Date(dateStr + 'T00:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' });

    const css = `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800;900&family=Playfair+Display:wght@700;900&display=swap');
        body { font-family: 'Outfit', sans-serif; color: #0f172a; padding: 2.5rem; margin: 0; background-color: #ffffff; line-height: 1.5; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.5rem; margin-bottom: 2rem; }
        .logo-area { display: flex; align-items: center; gap: 1rem; }
        .logo-circle { width: 60px; height: 60px; border-radius: 50%; background-image: url('img/logo-192.png'); background-size: 108% 108%; background-position: center; background-repeat: no-repeat; border: 2px solid #C9A24A; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .logo-text h1 { font-family: 'Playfair Display', serif; font-size: 1.8rem; margin: 0; color: #0b1329; font-weight: 900; letter-spacing: -0.02em; }
        .logo-text p { font-size: 0.85rem; margin: 0; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
        .report-meta { text-align: right; }
        .report-meta h2 { font-size: 1.25rem; margin: 0; color: #d97706; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 900; }
        .report-meta p { font-size: 0.85rem; margin: 0.25rem 0 0; color: #475569; }
        .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; margin-bottom: 2rem; }
        .kpi-card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1.25rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .kpi-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; }
        .kpi-val { font-size: 1.5rem; font-weight: 900; color: #0b1329; margin-top: 0.35rem; }
        .kpi-subval { font-size: 0.8rem; color: #475569; font-weight: 600; margin-top: 0.2rem; }
        .section-title { font-size: 1rem; text-transform: uppercase; font-weight: 900; color: #0b1329; margin-top: 2rem; margin-bottom: 1rem; letter-spacing: 0.08em; border-bottom: 2px solid #f1f5f9; padding-bottom: 0.5rem; display: flex; align-items: center; gap: 0.35rem; }
        table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
        th { background-color: #f8fafc; color: #475569; font-size: 0.85rem; text-transform: uppercase; font-weight: 800; text-align: left; padding: 0.85rem; border-bottom: 2px solid #cbd5e1; letter-spacing: 0.02em; }
        td { padding: 0.85rem; font-size: 0.88rem; border-bottom: 1px solid #f1f5f9; color: #334155; }
        tr:nth-child(even) { background-color: #fcfdfe; }
        .low-confidence { color: #b45309; font-size: 0.75rem; font-weight: 700; }
        .footer { margin-top: 3.5rem; border-top: 1px solid #e2e8f0; padding-top: 1.25rem; text-align: center; font-size: 0.7rem; color: #94a3b8; }
        .btn-print-action { background-color: #0b1329; color: #ffffff; border: 1px solid #C9A24A; padding: 0.6rem 1.75rem; font-size: 0.8rem; border-radius: 6px; cursor: pointer; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; box-shadow: 0 4px 6px rgba(0,0,0,0.15); transition: all 0.2s; }
        .btn-print-action:hover { background-color: #172242; color: #C9A24A; }
        .consultant-box { background-color: #fdfbf7; border: 1.5px solid #C9A24A; border-left: 5px solid #d97706; border-radius: 8px; padding: 1.5rem; margin-top: 2rem; margin-bottom: 2rem; box-shadow: 0 4px 6px rgba(0,0,0,0.02); page-break-inside: avoid; }
        .consultant-title { font-size: 1.05rem; font-weight: 900; color: #0b1329; margin-top: 0; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .consultant-badge { background-color: #C9A24A; color: #000; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 800; }
        .consultant-points { margin-top: 0.75rem; padding-left: 1.25rem; font-size: 0.9rem; color: #334155; }
        .consultant-points li { margin-bottom: 0.6rem; }
        @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
    `;

    const weekdayRowsHtml = [1, 2, 3, 4, 5, 6, 0].map(w => weekdayPattern[w]).map(b => `
        <tr>
            <td>${escapeHtml(b.label)}</td>
            <td>$${b.avgTotal.toFixed(2)}</td>
            <td>${b.avgCount} uds. prom.</td>
            <td>${b.sampleSize} semana(s) muestreadas</td>
        </tr>
    `).join('');

    const flavorTotalQty = flavorRankingFull.reduce((sum, f) => sum + f.quantity, 0);
    const flavorRowsHtml = flavorRankingFull.length > 0 ? flavorRankingFull.slice(0, 10).map((f, i) => {
        const pct = flavorTotalQty > 0 ? (f.quantity / flavorTotalQty) * 100 : 0;
        return `
            <tr>
                <td>#${i + 1} ${escapeHtml(f.name)}</td>
                <td>${escapeHtml(ANALYTICS_CATEGORY_LABELS[f.category] || f.category)}</td>
                <td>${f.quantity} uds. (${pct.toFixed(0)}%)</td>
                <td>$${f.amount.toFixed(2)}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="4" style="text-align: center; color: #64748b;">Sin ventas registradas en este período.</td></tr>';

    const projectionRowsHtml = projection.map(p => `
        <tr>
            <td>${escapeHtml(fmtDayLabel(p.dateStr))}</td>
            <td>$${p.projectedTotal.toFixed(2)}</td>
            <td>${p.projectedCount} uds. prom.</td>
            <td>${p.lowConfidence ? '<span class="low-confidence">Dato preliminar</span>' : `${p.sampleSize} semana(s)`}</td>
        </tr>
    `).join('');

    const insightsHtml = insights.map(text => `<li>${escapeHtml(text)}</li>`).join('');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Informe Detallado de Ventas - Casa Lucenzo</title>
            <style>${css}</style>
        </head>
        <body>
            <div class="header">
                <div class="logo-area">
                    <div class="logo-circle"></div>
                    <div class="logo-text">
                        <h1>CASA LUCENZO</h1>
                        <p>Pastelería & Bebidas</p>
                    </div>
                </div>
                <div class="report-meta">
                    <h2>Informe Detallado de Ventas</h2>
                    <p><strong>Período analizado:</strong> ${escapeHtml(rangeLabel || `${periodDays} día(s)`)}</p>
                    <p><strong>Generado:</strong> ${new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
            </div>

            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-label">Vendido en el período</div>
                    <div class="kpi-val">$${periodTotal.toFixed(2)}</div>
                    <div class="kpi-subval">${periodDays} día(s) con ventas</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Promedio diario</div>
                    <div class="kpi-val">$${avgDaily.toFixed(2)}</div>
                    <div class="kpi-subval">por día con actividad</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Mejor día</div>
                    <div class="kpi-val">$${bestDay ? bestDay.total.toFixed(2) : '0.00'}</div>
                    <div class="kpi-subval">${bestDay ? escapeHtml(fmtDayLabel(bestDay.dateStr)) : 'sin datos'}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Día más flojo</div>
                    <div class="kpi-val">$${worstDay ? worstDay.total.toFixed(2) : '0.00'}</div>
                    <div class="kpi-subval">${worstDay ? escapeHtml(fmtDayLabel(worstDay.dateStr)) : 'sin datos'}</div>
                </div>
            </div>

            <div class="section-title"><span>📅 Ventas por Día de la Semana</span></div>
            <table>
                <thead><tr><th>Día</th><th>Promedio ($)</th><th>Unidades</th><th>Muestras</th></tr></thead>
                <tbody>${weekdayRowsHtml}</tbody>
            </table>

            <div class="section-title"><span>🏆 Sabores Más Vendidos</span></div>
            <table>
                <thead><tr><th>Producto</th><th>Categoría</th><th>Unidades</th><th>Monto</th></tr></thead>
                <tbody>${flavorRowsHtml}</tbody>
            </table>

            <div class="section-title"><span>🔮 Proyección Próximos 7 Días</span></div>
            <table>
                <thead><tr><th>Día</th><th>Venta Estimada</th><th>Unidades Estimadas</th><th>Confianza</th></tr></thead>
                <tbody>${projectionRowsHtml}</tbody>
            </table>

            <div class="consultant-box">
                <div class="consultant-title">
                    <span class="consultant-badge">RESEÑAS</span>
                    <span>Lectura del Rendimiento</span>
                </div>
                <ul class="consultant-points">${insightsHtml}</ul>
            </div>

            <div class="footer">
                <p>Informe de análisis de ventas - Generado por el Sistema Casa Lucenzo.</p>
                <p class="no-print" style="margin-top: 1.75rem;">
                    <button class="btn-print-action" onclick="window.print()">
                        📥 Imprimir / Guardar PDF
                    </button>
                </p>
            </div>

            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 400);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/**
 * PDF del resumen de Ganancias. Misma técnica que exportSalesAnalyticsToPDF:
 * ventana nueva + document.write + window.print().
 */
function exportPnlToPDF(pnl, opts = {}) {
    if (sessionStorage.getItem('casa_lucenzo_active_role') !== 'admin') return;
    const { mode = 'week', bcvRate = (window.bcvRate || 1) } = opts;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Permite las ventanas emergentes para generar el PDF.'); return; }

    const usd = v => '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const t = pnl.totals;
    const title = `Resumen ${mode === 'month' ? 'Mensual' : 'Semanal'} — ${pnl.period.label}`;

    const catRows = pnl.categorias.map(c => `
        <tr><td>${c.label}</td><td style="text-align:right">${c.unidades}</td><td style="text-align:right">${usd(c.ventasUsd)}</td><td style="text-align:right">${usd(c.costoTercerosUsd)}</td><td style="text-align:right">${usd(c.margenUsd)}</td></tr>
        ${c.productos.map(p => `<tr class="sub"><td style="padding-left:1.5rem">${escapeHtml(p.name)}</td><td style="text-align:right">${p.unidades}</td><td style="text-align:right">${usd(p.ventasUsd)}</td><td></td><td></td></tr>`).join('')}
    `).join('');

    const gastoRows = pnl.gastos.porCategoria.map(g => `
        <tr><td>${g.label}</td><td style="text-align:right">${usd(g.montoUsd)}</td></tr>
        ${g.items.map(i => `<tr class="sub"><td style="padding-left:1.5rem">${i.fecha} · ${escapeHtml(i.description)}${i.currency === 'VES' ? ` (Bs. ${i.montoOriginal.toLocaleString('es-VE')})` : ''}</td><td style="text-align:right">${usd(i.montoUsd)}</td></tr>`).join('')}
    `).join('');

    const estNote = t.costoTerceros.estimatedDays > 0
        ? `<p class="note">Incluye ${t.costoTerceros.estimatedDays} día(s) con costo de producción estimado (antes del 22 ago no se registraba el costo real).</p>` : '';

    printWindow.document.write(`
      <html><head><title>${title} — Casa Lucenzo</title>
      <style>
        body{font-family:Arial,sans-serif;padding:2rem;color:#1e293b;}
        h1{font-size:1.3rem;margin:0 0 .25rem;} .meta{color:#64748b;font-size:.8rem;margin-bottom:1.5rem;}
        table{width:100%;border-collapse:collapse;margin-bottom:1.5rem;font-size:.85rem;}
        th,td{padding:.4rem .5rem;border-bottom:1px solid #e2e8f0;} th{text-align:left;background:#f1f5f9;}
        tr.sub td{color:#64748b;font-size:.8rem;border-bottom:1px dotted #e2e8f0;}
        .cascade td{font-size:.95rem;} .cascade .total td{font-weight:800;border-top:2px solid #334155;}
        .note{background:#fef3c7;border:1px solid #f59e0b;padding:.5rem .75rem;border-radius:6px;font-size:.8rem;}
        .neg{color:#dc2626;}
      </style></head><body>
      <h1>${title}</h1>
      <div class="meta">Casa Lucenzo · Generado ${new Date().toLocaleString('es-VE')} · Tasa BCV ${bcvRate.toLocaleString('es-VE')}</div>
      ${estNote}
      <table class="cascade">
        <tr><td>Ventas de mercadería</td><td style="text-align:right">${usd(t.ventasUsd)}</td></tr>
        <tr><td>− Costo de producción (terceros)${t.costoTerceros.isEstimated ? ' (est.)' : ''}</td><td style="text-align:right">−${usd(t.costoTerceros.usd)}</td></tr>
        <tr><td>− Gastos del local</td><td style="text-align:right">−${usd(t.gastosUsd)}</td></tr>
        <tr class="total"><td>= Ganancia neta</td><td style="text-align:right" class="${t.gananciaNetaUsd < 0 ? 'neg' : ''}">${usd(t.gananciaNetaUsd)}</td></tr>
      </table>
      <h3>Por categoría</h3>
      <table><tr><th>Categoría / Producto</th><th style="text-align:right">Unid.</th><th style="text-align:right">Ventas</th><th style="text-align:right">Terceros</th><th style="text-align:right">Margen</th></tr>${catRows}</table>
      <h3>Gastos</h3>
      <table><tr><th>Categoría / Detalle</th><th style="text-align:right">Monto</th></tr>${gastoRows}</table>
      ${pnl.abonos.count > 0 ? `<p class="meta">Abonos cobrados: ${pnl.abonos.count} · ${usd(pnl.abonos.montoUsd)} (fuera del cálculo de ganancia)</p>` : ''}
      ${pnl.delivery && pnl.delivery.count > 0 ? `<p class="meta">Delivery cobrado: ${pnl.delivery.count} · ${usd(pnl.delivery.montoUsd)} (del motorizado, fuera de ventas y ganancia)</p>` : ''}
      <script>window.onload=function(){setTimeout(function(){window.print();},400);}</script>
      </body></html>`);
    printWindow.document.close();
}
