// LocalStorage management for Casa Lucenzo inventory, sales, expenses, and debts

const DEFAULT_PRODUCTS = [
    { id: 'mechada', name: 'Carne Mechada', stock: 20, min: 6, max: 20, unit: 'unid.', price: 1.50, category: 'pastelitos' },
    { id: 'pollo', name: 'Pollo', stock: 20, min: 6, max: 20, unit: 'unid.', price: 1.50, category: 'pastelitos' },
    { id: 'molida', name: 'Carne Molida', stock: 12, min: 4, max: 12, unit: 'unid.', price: 1.50, category: 'pastelitos' },
    { id: 'queso', name: 'Queso', stock: 8, min: 3, max: 8, unit: 'unid.', price: 1.20, category: 'pastelitos' },
    { id: 'estaciones', name: '4 Estaciones (Especial)', stock: 12, min: 4, max: 12, unit: 'unid.', price: 1.80, category: 'pastelitos' },
    { id: 'primavera', name: 'Primavera (Especial)', stock: 8, min: 3, max: 8, unit: 'unid.', price: 1.80, category: 'pastelitos' },
    { id: 'ricota', name: 'Ricota con Tocineta', stock: 8, min: 3, max: 8, unit: 'unid.', price: 1.80, category: 'pastelitos' },
    { id: 'tocineta', name: 'Tocineta con Queso', stock: 12, min: 4, max: 12, unit: 'unid.', price: 1.80, category: 'pastelitos' },
    { id: 'tortas', name: 'Tortas de la Casa', stock: 5, min: 1, max: 5, unit: 'unid.', price: 12.00, category: 'tortas' },
    { id: 'malta', name: 'Malta Retornable', stock: 24, min: 6, max: 24, unit: 'botellas', price: 1.00, category: 'bebidas' }
];

const INVENTORY_KEY = 'casa_lucenzo_inventory_modular';
const SALES_LOG_KEY = 'casa_lucenzo_sales_log';
const EXPENSES_KEY = 'casa_lucenzo_expenses';
const DEBTS_KEY = 'casa_lucenzo_debts';
const REPLENISHMENTS_KEY = 'casa_lucenzo_replenishments';
const PREFERENCES_KEY = 'casa_lucenzo_preferences';

/**
 * Loads products from localStorage, or returns default products if empty.
 */
function loadProducts() {
    const saved = localStorage.getItem(INVENTORY_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            
            // Auto-migration: check if database contains old high-limit max values (e.g. Mechada max = 50)
            const needsMigration = parsed.some(p => p.id === 'mechada' && p.max === 50);
            
            if (needsMigration) {
                console.log("Old stock limits detected. Migrating to new stock limits...");
                saveProducts(DEFAULT_PRODUCTS);
                return JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
            }

            return parsed.map(p => ({
                ...p,
                price: p.price !== undefined ? parseFloat(p.price) : 1.50,
                category: p.category || 'pastelitos'
            }));
        } catch (e) {
            console.error("Error reading from local storage, loading defaults", e);
            return JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
        }
    }
    return JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
}

function saveProducts(products) {
    try {
        localStorage.setItem(INVENTORY_KEY, JSON.stringify(products));
    } catch (e) {
        console.error("Failed to save to local storage", e);
    }
}

function resetToDefaults() {
    try {
        localStorage.removeItem(INVENTORY_KEY);
        localStorage.removeItem(SALES_LOG_KEY);
        localStorage.removeItem(EXPENSES_KEY);
        localStorage.removeItem(DEBTS_KEY);
        localStorage.removeItem(REPLENISHMENTS_KEY);
        localStorage.removeItem(PREFERENCES_KEY);
    } catch(e) {
        console.error("Failed to clear local storage", e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
}

// ================= SALES =================

function loadSalesLog() {
    const saved = localStorage.getItem(SALES_LOG_KEY);
    return saved ? JSON.parse(saved) : [];
}

function saveSalesLog(log) {
    localStorage.setItem(SALES_LOG_KEY, JSON.stringify(log));
}

function clearSalesLog() {
    localStorage.removeItem(SALES_LOG_KEY);
}

// ================= EXPENSES =================

function loadExpenses() {
    const saved = localStorage.getItem(EXPENSES_KEY);
    return saved ? JSON.parse(saved) : [];
}

function saveExpenses(expenses) {
    localStorage.setItem(EXPENSES_KEY, JSON.stringify(expenses));
}

function clearExpenses() {
    localStorage.removeItem(EXPENSES_KEY);
}

// ================= DEBTS (FIADOS) =================

function loadDebts() {
    const saved = localStorage.getItem(DEBTS_KEY);
    return saved ? JSON.parse(saved) : [];
}

function saveDebts(debts) {
    localStorage.setItem(DEBTS_KEY, JSON.stringify(debts));
}

function clearDebts() {
    localStorage.removeItem(DEBTS_KEY);
}

// ================= REPLENISHMENTS (DISPATCHES) =================

function loadReplenishments() {
    const saved = localStorage.getItem(REPLENISHMENTS_KEY);
    return saved ? JSON.parse(saved) : [];
}

function saveReplenishments(repls) {
    localStorage.setItem(REPLENISHMENTS_KEY, JSON.stringify(repls));
}

function clearReplenishments() {
    localStorage.removeItem(REPLENISHMENTS_KEY);
}

// ================= PREFERENCES =================

function loadPreferences() {
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch(e) {
            return { sound: true, vibration: true };
        }
    }
    return { sound: true, vibration: true };
}

function savePreferences(prefs) {
    try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
    } catch(e) {
        console.error("Failed to save preferences", e);
    }
}

// Expose to window namespace
window.StorageManager = {
    DEFAULT_PRODUCTS,
    loadProducts,
    saveProducts,
    resetToDefaults,
    loadSalesLog,
    saveSalesLog,
    clearSalesLog,
    loadExpenses,
    saveExpenses,
    clearExpenses,
    loadDebts,
    saveDebts,
    clearDebts,
    loadReplenishments,
    saveReplenishments,
    clearReplenishments,
    loadPreferences,
    savePreferences
};
