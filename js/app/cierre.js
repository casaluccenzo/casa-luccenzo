// Cierre de turno/jornada, reporte por WhatsApp e historial de reportes PDF.
//
// Antes formaba parte de js/app.js. Script clásico (no módulo ES): comparte el
// ámbito global con los demás archivos de js/app/ y js/ui/, así que el orden de
// carga importa. Ese orden vive en sistema/index.html (y se repite en sw.js y
// js/app/index.js; tests/script-order.test.js comprueba que coincidan).

// ================= DAY CLOSE BROADCASTS =================

/**
 * Open Cierre de Día modal overlay
 */
function openDayCloseModal() {
    triggerHaptic(15);
    const todayLabel = new Date().toLocaleDateString();
    const currentRate = window.bcvRate || bcvRate;
    currentReportData = { sales: salesLog, expenses: expenses, dateLabel: todayLabel, rate: currentRate, isHistory: false };
    setDayCloseModalShift(null);
    window.UIManager.renderDayCloseModal(salesLog, expenses, products, todayLabel, currentRate);
    document.getElementById('day-close-modal').classList.remove('hidden');
}

// ================= CORTE DE TURNO =================
//
// El local trabaja dos turnos: mañana (6:00 a.m. – 1:00 p.m.) y tarde
// (6:00 p.m. – 9:30 p.m.). El corte de turno es un resumen de lo vendido en
// el turno, con su PDF, SIN cerrar la jornada: la caja, la vitrina y el stock
// siguen igual. El Cierre de Jornada de la noche trae los dos turnos y el
// total del día. La raya entre turnos es a las 3:30 p.m. (hora de Caracas),
// la misma que usa lib/day-report.js para el PDF.
const SHIFT_SPLIT_MIN = 15 * 60 + 30;
const SHIFT_INFO = {
    manana: { label: 'Turno mañana', short: 'mañana', emoji: '☀️', hours: '6:00 a.m. a 1:00 p.m.' },
    tarde: { label: 'Turno tarde', short: 'tarde', emoji: '🌙', hours: '6:00 p.m. a 9:30 p.m.' }
};

/** 'manana' o 'tarde' según la hora de Caracas de un timestamp (o de ahora). */
function shiftOfTimestamp(ts) {
    const d = ts ? (window.parseUTCTimestamp ? window.parseUTCTimestamp(ts) : new Date(ts)) : new Date();
    const caracas = new Date(d.getTime() - 4 * 3600 * 1000);
    return caracas.getUTCHours() * 60 + caracas.getUTCMinutes() < SHIFT_SPLIT_MIN ? 'manana' : 'tarde';
}

window.shiftOfTimestamp = shiftOfTimestamp;
// Repinta Clientes con lo de hoy (lo usa el selector de día del Historial al volver a "Hoy").
window.refreshClientesView = () => window.UIManager.renderClientesView(salesLog, handleUndoSale, handleEditSale, markTransactionAsPaid, products);

/** Cambia título y botón del modal: corte de turno (no cierra) o cierre normal. */
function setDayCloseModalShift(shift) {
    const title = document.querySelector('#day-close-modal .modal-header h3');
    const confirmBtn = document.getElementById('btn-cierre-dia-confirm');
    const info = shift ? SHIFT_INFO[shift] : null;
    if (title) {
        title.innerHTML = info
            ? `<i class="fa-solid fa-scissors"></i> Corte de turno · ${info.short}`
            : '<i class="fa-solid fa-door-closed"></i> Cierre de Jornada';
    }
    if (confirmBtn) {
        confirmBtn.innerHTML = info
            ? '<i class="fa-brands fa-whatsapp text-lg"></i> ENVIAR CORTE POR WHATSAPP'
            : '<i class="fa-brands fa-whatsapp text-lg"></i> ENVIAR INFORME POR WHATSAPP';
    }
}

/**
 * Abre el resumen del turno en curso (solo lo vendido en este turno de hoy).
 * El botón de WhatsApp de este modo NO cierra la jornada.
 */
function openShiftCutModal() {
    triggerHaptic(15);
    const shift = shiftOfTimestamp();
    const today = caracasDateStr();
    const inShift = row => row && row.timestamp &&
        caracasDateStr(window.parseUTCTimestamp ? window.parseUTCTimestamp(row.timestamp) : new Date(row.timestamp)) === today &&
        shiftOfTimestamp(row.timestamp) === shift;
    const shiftSales = salesLog.filter(inShift);
    const shiftExpenses = expenses.filter(inShift);
    const label = `${new Date().toLocaleDateString()} · ${SHIFT_INFO[shift].label}`;
    const currentRate = window.bcvRate || bcvRate;
    currentReportData = { sales: shiftSales, expenses: shiftExpenses, dateLabel: label, rate: currentRate, isHistory: false, shift };
    setDayCloseModalShift(shift);
    window.UIManager.renderDayCloseModal(shiftSales, shiftExpenses, products, label, currentRate, { shift });
    document.getElementById('day-close-modal').classList.remove('hidden');
}

/**
 * Close Cierre de Día modal overlay
 */
function closeDayCloseModal() {
    triggerHaptic(15);
    document.getElementById('day-close-modal').classList.add('hidden');
}

/** Ventas agrupadas por día de Caracas: [{label:'25/11', total, count}] en orden. */
function salesByCaracasDay(list) {
    const dias = {};
    (list || []).forEach(s => {
        if (!s.timestamp) return;
        const d = window.parseUTCTimestamp ? window.parseUTCTimestamp(s.timestamp) : new Date(s.timestamp);
        const c = new Date(d.getTime() - 4 * 3600 * 1000);
        const key = c.toISOString().slice(0, 10);
        if (!dias[key]) dias[key] = { key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, total: 0, count: 0 };
        dias[key].total += s.price || 0;
        dias[key].count += 1;
    });
    return Object.values(dias).sort((a, b) => a.key.localeCompare(b.key));
}

function generateWhatsAppReport(reportSales, reportExpenses, dateLabel, rate, productsList = [], shift = null) {
    const totalSales = reportSales.reduce((sum, s) => sum + (s.price || 0), 0);
    const totalExpenses = reportExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netCash = totalSales - totalExpenses;

    const categoryMap = {};

    reportSales.forEach(sale => {
        let cleanName = sale.name;
        if (sale.productId !== 'abono') {
            cleanName = sale.name.replace(/\s*\[.*\](\s*\(Pagado(?: - .*?)?\))?$/, '');
        }

        let catKey = 'otros';
        let catLabel = '📦 Otros / Varios';
        let sortOrder = 99;

        if (sale.productId !== 'abono') {
            const product = productsList.find(p => p.id === sale.productId);
            const rawCat = product ? product.category : 'otros';

            if (Combos && Combos.isDeliverySale(sale)) {
                catKey = 'delivery';
                catLabel = '🛵 Delivery (fuera de IVA)';
                sortOrder = 85;
            } else if (Combos && Combos.isExtraSale(sale)) {
                catKey = 'extra';
                catLabel = '🛍️ Productos extra (comprados afuera)';
                sortOrder = 75;
            } else if (Combos && Combos.isStaffSale(sale)) {
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
            catGroup[cleanName] = { count: 0, unitPrice: sale.price || 0, total: 0 };
        }
        catGroup[cleanName].count++;
        catGroup[cleanName].total += sale.price || 0;
    });

    const totalItemsSold = reportSales.filter(s => s.productId !== 'abono' && !(Combos && Combos.isDeliverySale(s))).length;
    const deliverySales = reportSales.filter(s => Combos && Combos.isDeliverySale(s));
    const totalDelivery = deliverySales.reduce((sum, s) => sum + (s.price || 0), 0);

    const shiftInfo = shift ? SHIFT_INFO[shift] : null;
    let message = shiftInfo
        ? `✂️ *CORTE DE TURNO ${shiftInfo.short.toUpperCase()} - CASA LUCENZO*\n`
        : `📋 *CIERRE DE JORNADA - CASA LUCENZO*\n`;
    message += `📅 Fecha: ${dateLabel}\n`;
    if (shiftInfo) message += `${shiftInfo.emoji} Turno: ${shiftInfo.hours}\n`;
    message += `💱 Tasa BCV: ${rate.toFixed(2)} Bs.\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🛒 *VENTAS ${shiftInfo ? 'DEL TURNO' : 'DEL DÍA'}* (${totalItemsSold} unidades)\n\n`;

    const sortedCategories = Object.values(categoryMap).sort((a, b) => a.sortOrder - b.sortOrder);

    for (const catData of sortedCategories) {
        const items = Object.entries(catData.sales);
        if (items.length > 0) {
            message += `*${catData.label.toUpperCase()}*\n`;
            for (const [name, data] of items) {
                message += `  • ${data.count}x ${name}\n`;
                message += `    $${data.unitPrice.toFixed(2)} c/u → *$${data.total.toFixed(2)}* (Bs. ${(data.total * rate).toFixed(2)})\n`;
            }
            message += `\n`;
        }
    }
    if (totalItemsSold === 0) {
        message += `  Sin ventas registradas.\n`;
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🏪 *GASTOS DEL LOCAL* (${reportExpenses.length})\n\n`;
    reportExpenses.forEach(exp => {
        message += `  • ${exp.description}: -$${exp.amount.toFixed(2)} (Bs. ${(exp.amount * rate).toFixed(2)})\n`;
    });
    if (reportExpenses.length === 0) {
        message += `  Sin gastos registrados.\n`;
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📊 *RESUMEN FINANCIERO*\n\n`;
    message += `  💰 Ventas:  +$${totalSales.toFixed(2)} (Bs. ${(totalSales * rate).toFixed(2)})\n`;
    if (totalDelivery > 0) {
        message += `     _de eso, delivery (${deliverySales.length}): $${totalDelivery.toFixed(2)} (Bs. ${(totalDelivery * rate).toFixed(2)}), fuera de IVA_\n`;
    }
    message += `  💸 Gastos:  -$${totalExpenses.toFixed(2)} (Bs. ${(totalExpenses * rate).toFixed(2)})\n`;
    message += `  ─────────────────\n`;
    message += `  💵 *CAJA NETA: $${netCash.toFixed(2)}*\n`;
    message += `     _(Bs. ${(netCash * rate).toFixed(2)})_\n`;

    // Cierre del día: cuánto se vendió en cada turno y el total de los dos.
    if (!shiftInfo && reportSales.some(s => s.timestamp)) {
        message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `🕐 *POR TURNO*\n\n`;
        for (const key of Object.keys(SHIFT_INFO)) {
            const info = SHIFT_INFO[key];
            const t = reportSales.filter(s => shiftOfTimestamp(s.timestamp) === key).reduce((sum, s) => sum + (s.price || 0), 0);
            message += `  ${info.emoji} ${info.label}: $${t.toFixed(2)} (Bs. ${(t * rate).toFixed(2)})\n`;
        }
        message += `  ─────────────────\n`;
        message += `  🧮 *Total del día: $${totalSales.toFixed(2)}* (Bs. ${(totalSales * rate).toFixed(2)})\n`;

        // Si un día quedó sin cerrar, la caja junta varios días. Avisarlo y
        // separar cuánto fue de cada uno (27/11/2026: el 26 sumó también el 25).
        const porDia = salesByCaracasDay(reportSales);
        if (porDia.length > 1) {
            message += `\n⚠️ *OJO: incluye ${porDia.length} días* (no se cerró la jornada):\n`;
            porDia.forEach(d => { message += `  • ${d.label}: $${d.total.toFixed(2)} (${d.count} ventas)\n`; });
        }
    }
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += shiftInfo ? `📢 _Corte de turno: la jornada sigue abierta._\n` : `📢 _Cierre generado automáticamente._\n`;
    message += `_¡Casa Lucenzo!_ 🌟`;

    return message;
}

/**
 * Open report history modal and load days from Supabase
 */
async function openReportHistoryModal() {
    // Historial de reportes (días pasados): el admin entra directo; la vendedora
    // solo con la clave de supervisor (v1.0.50). Cada entrada queda anotada.
    if (currentRole !== 'admin') {
        if (!(await requireSupervisor('Ver el historial de reportes de días anteriores'))) return;
    }
    triggerHaptic(15);
    const modal = document.getElementById('report-history-modal');
    const body = document.getElementById('report-history-modal-body');
    modal.classList.remove('hidden');

    // Show loading
    body.innerHTML = `
        <div style="text-align: center; padding: 2rem 0; color: var(--color-text-muted); font-size: 0.8125rem;">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>
            Cargando historial...
        </div>
    `;

    if (!window.SupabaseManager.isConfigured()) {
        body.innerHTML = `
            <div style="text-align: center; padding: 2rem 0; color: var(--color-text-muted); font-size: 0.8125rem;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: var(--color-gold);"></i>
                Configura Supabase para acceder al historial de reportes.
            </div>
        `;
        return;
    }

    // Plan B, Task 14: fetchReportDays goes straight to Postgres (not part of
    // PowerSync's sync stream) -- offline it silently returned [], and the
    // empty-state below read as "No se encontraron reportes recientes",
    // indistinguishable from a genuinely quiet 30 days. Distinguish them.
    if (!navigator.onLine) {
        body.innerHTML = `
            <div style="text-align: center; padding: 2rem 0; color: var(--color-text-muted); font-size: 0.8125rem;">
                <i class="fa-solid fa-wifi-slash" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: var(--color-danger);"></i>
                Sin conexión — el historial de reportes necesita datos del servidor.
                <br><button id="btn-report-history-retry-offline" class="btn-action-small" style="margin-top:0.75rem;"><i class="fa-solid fa-rotate"></i> Reintentar</button>
            </div>
        `;
        const retryBtn = document.getElementById('btn-report-history-retry-offline');
        if (retryBtn) retryBtn.addEventListener('click', () => openReportHistoryModal());
        return;
    }

    const [days, savedPdfs] = await Promise.all([
        window.SupabaseManager.fetchReportDays(30),
        window.SupabaseManager.fetchSavedDayReports(30)
    ]);
    const pdfByDate = new Map((savedPdfs || []).map(r => [r.report_date, r]));
    const pdfToday = caracasDateStr();
    const pdfYesterday = caracasDateStr(new Date(Date.now() - 24 * 3600 * 1000));

    if (!days || days.length === 0) {
        body.innerHTML = `
            <div style="text-align: center; padding: 2rem 0; color: var(--color-text-muted); font-size: 0.8125rem;">
                <i class="fa-solid fa-inbox" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: var(--color-text-muted);"></i>
                No se encontraron reportes recientes.
            </div>
        `;
        return;
    }

    // Day name helper
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    let html = '';
    days.forEach(dateStr => {
        const d = new Date(dateStr + 'T12:00:00');
        const dayName = dayNames[d.getDay()];
        const displayDate = d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
        const today = new Date().toISOString().split('T')[0];
        const isToday = dateStr === today;
        const badge = isToday ? '<span style="font-size: 9px; background: var(--color-gold); color: #000; padding: 1px 6px; border-radius: 4px; font-weight: 800; margin-left: 0.35rem;">HOY</span>' : '';

        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--radius-md); margin-bottom: 0.5rem;">
                <div>
                    <div style="font-size: 0.8125rem; font-weight: 700; color: var(--color-white);">${dayName} ${badge}</div>
                    <div style="font-size: 0.6875rem; color: var(--color-text-muted);">${displayDate}</div>
                </div>
                <div style="display: flex; gap: 0.375rem; flex-wrap: wrap; justify-content: flex-end;">
                    ${pdfByDate.has(dateStr) ? `
                    <button class="btn-report-pdf" data-date="${dateStr}" title="PDF guardado al cierre" style="height: 34px; padding: 0 0.75rem; border-radius: var(--radius-md); border: none; background: #c0392b; color: #fff; font-weight: 700; font-size: 0.6875rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fa-solid fa-file-pdf" style="font-size: 11px;"></i> PDF
                    </button>` : ''}
                    ${(dateStr === pdfToday || dateStr === pdfYesterday || !pdfByDate.has(dateStr)) ? `
                    <button class="btn-report-pdf-regen" data-date="${dateStr}" title="${pdfByDate.has(dateStr) ? 'Volver a generar el PDF con las ventas actuales' : 'Generar el PDF de este día'}" style="height: 34px; padding: 0 0.6rem; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.2); background: transparent; color: var(--color-text-muted); font-weight: 700; font-size: 0.6875rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fa-solid fa-rotate" style="font-size: 10px;"></i> ${pdfByDate.has(dateStr) ? '' : 'PDF'}
                    </button>` : ''}
                    <button class="btn-report-pdf-shift" data-date="${dateStr}" title="PDF del turno de la mañana (corte de turno)" style="height: 34px; padding: 0 0.6rem; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.2); background: transparent; color: var(--color-white); font-weight: 700; font-size: 0.6875rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                        ☀️ Mañana
                    </button>
                    <button class="btn-report-view" data-date="${dateStr}" style="height: 34px; padding: 0 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-gold); background: transparent; color: var(--color-gold); font-weight: 700; font-size: 0.6875rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fa-solid fa-eye" style="font-size: 10px;"></i> Ver
                    </button>
                    <button class="btn-report-whatsapp" data-date="${dateStr}" data-label="${dayName} ${displayDate}" style="height: 34px; padding: 0 0.75rem; border-radius: var(--radius-md); border: none; background: var(--color-success); color: #fff; font-weight: 700; font-size: 0.6875rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;">
                        <i class="fa-brands fa-whatsapp" style="font-size: 12px;"></i> Enviar
                    </button>
                </div>
            </div>
        `;
    });

    function formatReportDateStr(dateStr) {
        if (!dateStr) return new Date().toLocaleDateString();
        if (dateStr.includes('/')) return dateStr;
        const parts = dateStr.split('T')[0].split('-');
        if (parts.length === 3) {
            return `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`;
        }
        return dateStr;
    }

    body.innerHTML = html;

    body.querySelectorAll('.btn-report-pdf').forEach(btn => {
        btn.addEventListener('click', (e) => {
            triggerHaptic(15);
            openDayReportPdf(e.currentTarget.dataset.date);
        });
    });

    body.querySelectorAll('.btn-report-pdf-shift').forEach(btn => {
        btn.addEventListener('click', (e) => {
            triggerHaptic(15);
            if (!requireOnline('Ver el corte de turno')) return;
            openDayReportPdf(e.currentTarget.dataset.date, 'manana');
        });
    });

    body.querySelectorAll('.btn-report-pdf-regen').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const dateStr = e.currentTarget.dataset.date;
            triggerHaptic(15);
            if (!requireOnline('Generar el PDF del día')) return;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            const ok = await requestDayReportPdf({ fecha: dateStr, manual: true });
            if (ok) openReportHistoryModal();
            else btn.disabled = false;
        });
    });

    // Bind view buttons
    body.querySelectorAll('.btn-report-view').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const dateStr = e.currentTarget.dataset.date;
            const formattedDate = formatReportDateStr(dateStr);
            triggerHaptic(15);
            if (!requireOnline('Ver el reporte de un día anterior')) return;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            const report = await window.SupabaseManager.fetchDayReport(dateStr);
            if (report) {
                const reportRate = report.bcvRate || report.sales?.find(s => s.bcvRate)?.bcvRate || window.bcvRate || bcvRate;
                currentReportData = { sales: report.sales, expenses: report.expenses, dateLabel: formattedDate, rate: reportRate, isHistory: true };
                setDayCloseModalShift(null);
                modal.classList.add('hidden');
                window.UIManager.renderDayCloseModal(report.sales, report.expenses, products, formattedDate, reportRate);
                document.getElementById('day-close-modal').classList.remove('hidden');
            } else {
                window.UIManager.showToast("❌ No se pudo cargar el reporte.", "fa-solid fa-circle-xmark");
            }
            btn.innerHTML = '<i class="fa-solid fa-eye" style="font-size: 10px;"></i> Ver';
        });
    });

    // Bind WhatsApp buttons
    body.querySelectorAll('.btn-report-whatsapp').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const dateStr = e.currentTarget.dataset.date;
            const formattedDate = formatReportDateStr(dateStr);
            triggerHaptic(15);
            if (!requireOnline('Enviar el reporte por WhatsApp')) return;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            // Same Safari/iPadOS quirk as the day-close confirm button: open the
            // tab before the await below so it stays authorized by the click.
            const waTab = window.open('', '_blank');
            const report = await window.SupabaseManager.fetchDayReport(dateStr);
            if (report) {
                const reportRate = report.bcvRate || report.sales?.find(s => s.bcvRate)?.bcvRate || window.bcvRate || bcvRate;
                let message = generateWhatsAppReport(report.sales, report.expenses, formattedDate, reportRate, products);
                if (pdfByDate.has(dateStr)) message += `\n\n📄 PDF del día: ${dayReportPdfUrl(dateStr)}`;
                const encodedMessage = encodeURIComponent(message);
                if (waTab) {
                    waTab.location.href = `https://api.whatsapp.com/send?text=${encodedMessage}`;
                } else {
                    window.open(`https://api.whatsapp.com/send?text=${encodedMessage}`, '_blank');
                }
            } else {
                if (waTab) waTab.close();
                window.UIManager.showToast("❌ No se pudo cargar el reporte.", "fa-solid fa-circle-xmark");
            }
            btn.innerHTML = '<i class="fa-brands fa-whatsapp" style="font-size: 12px;"></i> Enviar';
        });
    });
}

// ================= REPORTE PDF DEL DÍA =================

// La app de escritorio corre en app://: ahí la API va absoluta, a www (el dominio
// sin www redirige con 308 y el preflight CORS no sigue redirecciones).
const API_BASE = /^https?:$/.test(window.location.protocol) ? '' : 'https://www.casalucenzo.com';

/** "AAAA-MM-DD" del día en Caracas (UTC-4), sin importar la zona del equipo. */
function caracasDateStr(date = new Date()) {
    return new Date(date.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Pide al servidor que arme y guarde el PDF de ventas del día (api/cierre-pdf.js).
 * El PDF sale de la base. Si falla o no hay conexión,
 * el cron de medianoche lo genera igual; nunca bloquea ni deshace el cierre.
 */
async function requestDayReportPdf({ fecha, manual = false } = {}) {
    try {
        const resp = await fetch(`${API_BASE}/api/cierre-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fecha: fecha || caracasDateStr(), manual })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        if (manual) window.UIManager.showToast("📄 Reporte PDF del día guardado.", "fa-solid fa-file-pdf");
        else showDayReportShareCard(fecha || caracasDateStr());
        return true;
    } catch (e) {
        console.warn("No se pudo generar el PDF del día; el cron de medianoche lo reintenta.", e);
        if (manual) window.UIManager.showToast("❌ No se pudo generar el PDF. Revisá la conexión.", "fa-solid fa-circle-xmark");
        return false;
    }
}

/** Enlace fijo al PDF guardado de un día; la API lo cambia por una URL firmada al abrirlo. */
function dayReportPdfUrl(fecha, turno = null) {
    return `https://www.casalucenzo.com/api/cierre-pdf?fecha=${encodeURIComponent(fecha)}${turno ? `&turno=${turno}` : ''}`;
}

function openDayReportPdf(fecha, turno = null) {
    window.open(`${API_BASE}/api/cierre-pdf?fecha=${encodeURIComponent(fecha)}${turno ? `&turno=${turno}` : ''}`, '_blank');
}

/**
 * Corte de turno: el PDF del turno se arma en el momento desde la base;
 * muestra la tarjeta para compartirlo.
 */
async function shareShiftReportPdf(fecha, turno) {
    showDayReportShareCard(fecha, turno);
}

/**
 * Tarjeta flotante "Compartir PDF" tras el cierre. El archivo se baja ANTES de
 * mostrar el botón: el menú de compartir del teléfono solo abre si se llama
 * directo desde el toque, sin esperas de red en medio. Donde no se pueden
 * compartir archivos (escritorio) el botón abre el PDF.
 */
async function showDayReportShareCard(fecha, turno = null) {
    let file = null;
    try {
        const resp = await fetch(`${API_BASE}/api/cierre-pdf?fecha=${encodeURIComponent(fecha)}${turno ? `&turno=${turno}` : ''}`);
        if (resp.ok) {
            const blob = await resp.blob();
            const fname = turno ? `corte-${turno}-${fecha}-casa-lucenzo.pdf` : `ventas-${fecha}-casa-lucenzo.pdf`;
            const f = new window.File([blob], fname, { type: 'application/pdf' });
            if (navigator.canShare && navigator.canShare({ files: [f] })) file = f;
        }
    } catch (e) {
        console.warn("No se pudo bajar el PDF para compartir; el botón lo abrirá.", e);
    }

    document.getElementById('day-report-share-card')?.remove();
    const card = document.createElement('div');
    card.id = 'day-report-share-card';
    card.style.cssText = 'position:fixed;left:50%;bottom:calc(1.25rem + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:10050;display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0.7rem 0.6rem 0.9rem;border-radius:14px;background:#0f2a52;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.35);font-size:0.8125rem;max-width:calc(100vw - 32px);';
    card.innerHTML = `
        <i class="fa-solid fa-file-pdf" style="color: var(--color-danger);"></i>
        <span style="font-weight:700;white-space:nowrap;">${turno ? `PDF del turno ${SHIFT_INFO[turno].short} listo` : 'PDF del día listo'}</span>
        <button type="button" data-act="share" style="height:34px;padding:0 0.8rem;border:none;border-radius:10px;background:#25d366;color:#fff;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:0.3rem;">
            <i class="fa-brands fa-whatsapp"></i> ${file ? 'Compartir' : 'Abrir'}
        </button>
        <button type="button" data-act="close" aria-label="Cerrar" style="height:34px;width:34px;border:none;border-radius:10px;background:transparent;color:#cbd5e1;cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>`;
    document.body.appendChild(card);

    const remove = () => card.remove();
    const timer = setTimeout(remove, 60000);
    card.querySelector('[data-act="close"]').addEventListener('click', () => { clearTimeout(timer); remove(); });
    card.querySelector('[data-act="share"]').addEventListener('click', async () => {
        triggerHaptic(15);
        if (!file) { openDayReportPdf(fecha, turno); return; }
        try {
            await navigator.share({ files: [file], title: turno ? `Corte turno ${SHIFT_INFO[turno].short} ${fecha} - Casa Lucenzo` : `Ventas ${fecha} - Casa Lucenzo` });
            clearTimeout(timer);
            remove();
        } catch (e) {
            // Cancelado por el usuario: la tarjeta queda para intentar otra vez.
            if (e && e.name !== 'AbortError') openDayReportPdf(fecha, turno);
        }
    });
}

/**
 * Clear daily sales and expenses logs locally and sync to Supabase, and refill vitrina stock to max for tomorrow
 */
async function closeDayAndResetLogs() {
    // The day close zeroes the register and the vitrina. Running it twice --
    // a double-tap on "confirmar", or two admins closing at once -- files a
    // second close, re-zeroes stock and fires a second WhatsApp report. Same
    // re-entrancy guard as handleCheckoutCart, on a heavier operation.
    if (closeDayAndResetLogs._inProgress) {
        window.UIManager.showToast("⏳ El cierre ya se está procesando, esperá un momento.", "fa-solid fa-hourglass-half");
        return;
    }
    closeDayAndResetLogs._inProgress = true;

    try {
        window.UIManager.showToast("⏳ Cerrando jornada y preparando vitrina...", "fa-solid fa-hourglass-start");

        const nowStr = new Date().toISOString();

        // 1. Record the close on the server FIRST. Writing it locally up front
        // meant a failed server write still advanced this device's cutoff: the
        // day's sales dropped out of its view while every other device -- and
        // the database -- still had the day open.
        if (window.SupabaseManager.isConfigured()) {
            if (window.SupabaseManager.getDbSupportsLastClose()) {
                console.log("Saving last day close timestamp to Supabase app_config...");
                await window.SupabaseManager.upsertAppConfig({ lastCloseTime: nowStr });
            } else {
                console.log("Database does not support last_close_time. Voiding daily sales and clearing expenses from Supabase as fallback...");
                await Promise.all(salesLog.map(s => window.SupabaseManager.voidSale(s.uuid, "Cierre de jornada (sin soporte de last_close_time)")));
                await window.SupabaseManager.deleteExpenses(expenses.map(e => e.uuid));
            }
        }
        window.StorageManager.saveLastCloseTime(nowStr);

        // 1b. Also record the close in day_closes (Plan A/B, migrations 026/030/033).
        // last_close_at() reads MAX(day_closes.closed_at) to know where "today"
        // starts for the pastelitos stock calculation; app_config.last_close_time
        // above doesn't feed that at all. Isolated in its own try/catch like the
        // BCV refresh below -- the close is already committed by this point, a
        // failure here must not report a completed close as failed.
        if (window.SupabaseManager.isConfigured()) {
            try {
                await window.SupabaseManager.insertDayClose(nowStr, myDeviceId);
            } catch (e) {
                console.warn("Day close committed, but insertDayClose failed.", e);
            }
        }

        // 2. Clear local arrays
        salesLog = [];
        expenses = [];

        // 3. Clear local storage logs
        window.StorageManager.clearSalesLog();
        window.StorageManager.clearExpenses();

        // 3b. A new day starts with no dispatches owed, so the guard list that
        // protects yesterday's batches from being re-loaded can start empty too.
        window.StorageManager.clearConsumedReplenishmentUuids();

        // 4. Todo el stock (pastelitos incluidos) pasa al día siguiente tal cual.
        // stock/initial_stock los recalcula Postgres desde stock_movements al
        // subir el cierre; esto es solo para que la pantalla quede bien ya.
        // Stock manual (27/11/2026, migración 053): los pastelitos ya NO se
        // ponen en cero al cerrar. Lo que queda (aunque sea negativo) pasa al
        // día siguiente, igual que las bebidas; Gustavo los carga a mano con
        // "Cargar pasteles". El cierre solo mueve dónde empieza "hoy" para el
        // cuadre. `max` de los pastelitos se reinicia a lo que quedó, para que
        // el "de X" de la vitrina sea lo de hoy y no un techo viejo (el trigger
        // solo puede crecerlo, por eso resetPastelitoCapacity sigue aquí).
        products.forEach(p => {
            const cat = p.category || (window.StorageManager ? window.StorageManager.getProductCategory(p) : 'pastelitos');
            p.initial_stock = p.stock || 0;
            if (cat === 'pastelitos') {
                p.max = Math.max(0, p.stock || 0);
                if (window.SupabaseManager.isConfigured()) {
                    window.SupabaseManager.resetPastelitoCapacity(p.id);
                }
            }
        });
        // 4.5. Ensure BCV automatic exchange connector is active and refreshed
        // for the next day. Isolated on purpose: the close itself is already
        // committed by this point, so a BCV provider being down must not throw
        // us into the catch below and report a completed close as failed --
        // that reads as "it didn't work" and invites closing a second time.
        useAutoBcv = true;
        try {
            await fetchBcvRate(true);
        } catch (e) {
            console.warn("Day close committed, but refreshing the BCV rate failed. Rate stays at its current value.", e);
            window.UIManager.showToast("⚠️ Jornada cerrada, pero no se pudo actualizar la tasa BCV. Revisala mañana antes de vender.", "fa-solid fa-triangle-exclamation");
        }

        // 5. Re-render UI
        window.UIManager.renderLocal(products, adjustStock, activeCategory, searchQuery);
        window.UIManager.renderCashRegister(salesLog, expenses);
        window.UIManager.renderSalesHistory(salesLog, handleUndoSale);
        window.UIManager.renderExpenses(expenses, deleteExpense);
        
        if (currentRole === 'admin') {
            loadAndRenderAdminStats();
        }

        window.UIManager.showToast("🌅 ¡Jornada cerrada! Caja en cero. El stock de pasteles se mantiene para mañana.", "fa-solid fa-circle-check");
        return true;
    } catch (e) {
        console.error("Failed to reset logs during day close", e);
        window.UIManager.showToast("❌ Error al cerrar la jornada. No se cerró -- revisá la conexión y probá de nuevo.", "fa-solid fa-circle-xmark");
        return false;
    } finally {
        closeDayAndResetLogs._inProgress = false;
    }
}
