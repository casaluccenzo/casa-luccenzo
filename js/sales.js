/**
 * Casa Lucenzo - Sales & Revenue Domain Module
 * Extracted from app.js / ui.js for modular architecture.
 */

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

const SalesManager = {
    calculateTotals
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateTotals,
        SalesManager
    };
}
if (typeof window !== 'undefined') {
    window.SalesManager = SalesManager;
    window.calculateTotals = calculateTotals;
}
