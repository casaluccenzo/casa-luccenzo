/**
 * Casa Lucenzo - Inventory & Stock Domain Module
 * Extracted from app.js / ui.js for modular architecture.
 */

function validateStockAdjustment(currentStock, changeAmount) {
    const stock = parseInt(currentStock) || 0;
    const change = parseInt(changeAmount) || 0;
    const nextStock = stock + change;
    if (nextStock < 0) return { allowed: false, newStock: stock };
    return { allowed: true, newStock: nextStock };
}

const InventoryManager = {
    validateStockAdjustment
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStockAdjustment,
        InventoryManager
    };
}
if (typeof window !== 'undefined') {
    window.InventoryManager = InventoryManager;
    window.validateStockAdjustment = validateStockAdjustment;
}
