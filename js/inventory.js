/**
 * Casa Lucenzo - Inventory & Stock Domain Module
 * Extracted and enhanced for stock calculations and alerts.
 */

function validateStockAdjustment(currentStock, changeAmount) {
    const stock = parseInt(currentStock) || 0;
    const change = parseInt(changeAmount) || 0;
    const nextStock = stock + change;
    if (nextStock < 0) return { allowed: false, newStock: stock };
    return { allowed: true, newStock: nextStock };
}

function getLowStockItems(items = []) {
    return (items || []).filter(item => {
        const stock = parseInt(item.stock) || 0;
        const min = parseInt(item.min || item.stock_min) || 0;
        return stock <= min;
    });
}

const InventoryManager = {
    validateStockAdjustment,
    getLowStockItems
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStockAdjustment,
        getLowStockItems,
        InventoryManager
    };
}
if (typeof window !== 'undefined') {
    window.InventoryManager = InventoryManager;
    window.validateStockAdjustment = validateStockAdjustment;
}
