/**
 * Casa Lucenzo - Inventory & Stock Domain Module
 * Handles stock validation, inventory adjustments, and replenishment rules.
 */

const InventoryManager = {
    /**
     * Validates if a stock adjustment is allowed and returns the new stock level
     * @param {number} currentStock Current stock quantity
     * @param {number} delta Change in stock (+ or -)
     * @returns {Object} { allowed: boolean, newStock: number }
     */
    validateStockAdjustment(currentStock, delta) {
        const stock = parseInt(currentStock) || 0;
        const change = parseInt(delta) || 0;
        const newStock = stock + change;

        if (newStock < 0) {
            return { allowed: false, newStock: stock };
        }
        return { allowed: true, newStock };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStockAdjustment: InventoryManager.validateStockAdjustment,
        InventoryManager
    };
}
if (typeof window !== 'undefined') {
    window.InventoryManager = InventoryManager;
}
