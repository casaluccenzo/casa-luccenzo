/**
 * Casa Lucenzo - Sales & Revenue Domain Module
 * Extracted and enhanced for domain calculations and executive dashboard.
 */

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function calculateTotals(sales = [], expenses = []) {
    const totalSales = (sales || []).reduce((sum, s) => sum + (parseFloat(s.price || s.total) || 0), 0);
    const totalExpenses = (expenses || []).reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const netCash = Math.max(0, totalSales - totalExpenses);
    return {
        totalSales: Number(totalSales.toFixed(2)),
        totalExpenses: Number(totalExpenses.toFixed(2)),
        netCash: Number(netCash.toFixed(2))
    };
}

function getTopProductOfDay(sales = []) {
    if (!sales || sales.length === 0) return null;
    const counts = {};
    sales.forEach(s => {
        let name = s.name || s.product_name || 'Producto';
        const match = name.match(/^(.*)\s+\[.*\]/);
        if (match) name = match[1];
        if (!counts[name]) counts[name] = { name, quantity: 0, totalAmount: 0 };
        counts[name].quantity += 1;
        counts[name].totalAmount += (parseFloat(s.price) || 0);
    });
    const sorted = Object.values(counts).sort((a, b) => b.quantity - a.quantity);
    return sorted[0] || null;
}

function compareSalesVsPreviousWeek(currentTotal, previousTotal) {
    if (previousTotal === undefined || previousTotal === null || previousTotal <= 0) {
        return { pctChange: null, label: 'sin datos previos' };
    }
    const diff = currentTotal - previousTotal;
    const pct = (diff / previousTotal) * 100;
    const symbol = pct >= 0 ? '↑' : '↓';
    return {
        pctChange: Number(pct.toFixed(1)),
        label: `${symbol} ${Math.abs(pct).toFixed(1)}% vs. semana pasada`
    };
}

function renderAdminDashboard(sales = [], expenses = [], previousWeekTotal = null) {
    const totals = calculateTotals(sales, expenses);
    const topProduct = getTopProductOfDay(sales);
    const comparison = compareSalesVsPreviousWeek(totals.totalSales, previousWeekTotal);
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    const bcv = (typeof window !== 'undefined' && window.bcvRate) ? window.bcvRate : 1;
    const netCashVes = totals.netCash * bcv;
    const totalSalesVes = totals.totalSales * bcv;
    const totalExpensesVes = totals.totalExpenses * bcv;

    const topProductHtml = topProduct ? `
        <div style="font-weight: 900; font-size: 1.1rem; color: var(--color-gold); margin-top: 0.25rem;">
            ${escapeHtml(topProduct.name)}
        </div>
        <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.15rem;">
            <b>${topProduct.quantity}</b> unidades vendidas ($${topProduct.totalAmount.toFixed(2)})
        </div>
    ` : `<div style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem;">Sin ventas registradas hoy aún.</div>`;

    return `
        ${isOffline ? `
            <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 8px; padding: 0.5rem 0.75rem; color: #FBBF24; font-size: 11px; font-weight: 700; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
                <i class="fa-solid fa-wifi-slash"></i> Datos hasta la última sincronización (Modo Offline)
            </div>
        ` : ''}

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; margin-bottom: 1rem;">
            <!-- Net Cash Card -->
            <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 78, 59, 0.25) 100%); border: 1.5px solid #10B981; border-radius: 12px; padding: 1rem; box-shadow: 0 4px 12px rgba(16,185,129,0.15);">
                <div style="font-size: 10px; font-weight: 900; color: #34D399; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between;">
                    <span>NETO EN CAJA (HOY)</span>
                    <i class="fa-solid fa-wallet"></i>
                </div>
                <div style="font-size: 1.8rem; font-weight: 900; color: #FFFFFF; font-family: monospace; margin-top: 0.25rem;">
                    $${totals.netCash.toFixed(2)}
                </div>
                <div style="font-size: 0.85rem; font-weight: 700; color: #A7F3D0; margin-top: 0.15rem;">
                    Bs. ${netCashVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            </div>

            <!-- Total Sales Card -->
            <div style="background: rgba(243, 198, 63, 0.1); border: 1px solid var(--color-gold); border-radius: 12px; padding: 1rem;">
                <div style="font-size: 10px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between;">
                    <span>VENTAS TOTALES</span>
                    <i class="fa-solid fa-cart-shopping"></i>
                </div>
                <div style="font-size: 1.6rem; font-weight: 900; color: var(--color-gold); font-family: monospace; margin-top: 0.25rem;">
                    $${totals.totalSales.toFixed(2)}
                </div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                    Bs. ${totalSalesVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} &bull; <span style="color: #60A5FA; font-weight: 800;">${comparison.label}</span>
                </div>
            </div>

            <!-- Total Expenses Card -->
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 12px; padding: 1rem;">
                <div style="font-size: 10px; font-weight: 900; color: #F87171; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between;">
                    <span>GASTOS REGISTRADOS</span>
                    <i class="fa-solid fa-receipt"></i>
                </div>
                <div style="font-size: 1.6rem; font-weight: 900; color: #F87171; font-family: monospace; margin-top: 0.25rem;">
                    -$${totals.totalExpenses.toFixed(2)}
                </div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                    Bs. ${totalExpensesVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            </div>
        </div>

        <!-- Top Product Box -->
        <div style="background: rgba(10, 20, 38, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1rem;">
            <div style="font-size: 10px; font-weight: 900; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 0.35rem;">
                <i class="fa-solid fa-trophy"></i> PRODUCTO MÁS VENDIDO DEL DÍA
            </div>
            ${topProductHtml}
        </div>
    `;
}

const SalesManager = {
    calculateTotals,
    getTopProductOfDay,
    compareSalesVsPreviousWeek,
    renderAdminDashboard
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateTotals,
        getTopProductOfDay,
        compareSalesVsPreviousWeek,
        renderAdminDashboard,
        SalesManager
    };
}
if (typeof window !== 'undefined') {
    window.SalesManager = SalesManager;
    window.calculateTotals = calculateTotals;
}
