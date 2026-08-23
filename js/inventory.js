/**
 * Casa Lucenzo - Inventory & Stock Domain Module
 * Extracted and enhanced for stock calculations, low-stock alerts, and UI badges.
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

function updateLowStockUI(products = [], ingredients = [], userRole = '') {
    if (typeof document === 'undefined') return;

    const lowProducts = getLowStockItems(products);
    const lowIngredients = getLowStockItems(ingredients);
    const totalLowCount = lowProducts.length + lowIngredients.length;

    const badge = document.getElementById('header-lowstock-badge');
    const countSpan = document.getElementById('header-lowstock-count');
    const normalizedRole = (userRole || '').toLowerCase();
    const canView = normalizedRole === 'admin' || normalizedRole === 'cocina';

    if (badge && countSpan) {
        if (canView && totalLowCount > 0) {
            badge.style.display = 'flex';
            countSpan.textContent = `${totalLowCount} bajo`;
        } else {
            badge.style.display = 'none';
        }
    }

    // Same signal, surfaced on the Productos sidebar tab -- previously only
    // visible from inside Resumen, so it went unnoticed unless you were
    // already looking at that specific panel.
    const productsTabBadge = document.getElementById('products-tab-lowstock-badge');
    if (productsTabBadge) {
        if (canView && lowProducts.length > 0) {
            productsTabBadge.textContent = lowProducts.length;
            productsTabBadge.classList.remove('hidden');
        } else {
            productsTabBadge.classList.add('hidden');
        }
    }

    const alertBanner = document.getElementById('kitchen-alert-banner');
    if (alertBanner) {
        if (totalLowCount > 0) {
            alertBanner.classList.remove('hidden');
            alertBanner.innerHTML = `
                <i class="fa-solid fa-triangle-exclamation animate-bounce"></i> 
                <span>🚨 ALERTA DE STOCK BAJO: ${totalLowCount} ítem(s) por debajo del mínimo (Vitrina/Ingredientes).</span>
            `;
        } else {
            alertBanner.classList.add('hidden');
        }
    }
}

const InventoryManager = {
    validateStockAdjustment,
    getLowStockItems,
    updateLowStockUI
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateStockAdjustment,
        getLowStockItems,
        updateLowStockUI,
        InventoryManager
    };
}
if (typeof window !== 'undefined') {
    window.InventoryManager = InventoryManager;
    window.validateStockAdjustment = validateStockAdjustment;
}
