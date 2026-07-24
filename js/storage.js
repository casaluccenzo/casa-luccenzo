// LocalStorage management for Casa Lucenzo inventory, sales, expenses, debts, and ingredients

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
    { id: 'malta', name: 'Malta Retornable', stock: 24, min: 6, max: 24, unit: 'botellas', price: 1.00, category: 'bebidas' },
    { id: 'samba_fresa', name: 'Samba de fresa', stock: 20, min: 5, max: 20, unit: 'unid.', price: 1.06, category: 'dulces' },
    { id: 'cocosette_maxi', name: 'Cocosette Maxi', stock: 18, min: 4, max: 18, unit: 'unid.', price: 0.90, category: 'dulces' },
    { id: 'susy_maxi', name: 'Susy Maxi', stock: 18, min: 4, max: 18, unit: 'unid.', price: 0.90, category: 'dulces' },
    { id: 'savoy_leche', name: 'Chocolate de Leche SAVOY 30 gr', stock: 12, min: 3, max: 12, unit: 'unid.', price: 1.44, category: 'dulces' },
    { id: 'savoy_cricri', name: 'Chocolate CRICRI SAVOY 30 gr', stock: 12, min: 3, max: 12, unit: 'unid.', price: 1.44, category: 'dulces' },
    { id: 'savoy_rikiti', name: 'Chocolate MANI RIKITI SAVOY 30 gr', stock: 12, min: 3, max: 12, unit: 'unid.', price: 1.44, category: 'dulces' },
    { id: 'pirulin_16g', name: 'Pirulin 16 gr', stock: 25, min: 5, max: 25, unit: 'unid.', price: 0.65, category: 'dulces' }
];

const DEFAULT_INGREDIENTS = [
    { id: 'harina', name: 'Harina de Trigo', stock: 25.0, unit: 'kg' },
    { id: 'margarina', name: 'Margarina / Grasa', stock: 10.0, unit: 'kg' },
    { id: 'carne_mechada', name: 'Carne Mechada (Relleno)', stock: 15.0, unit: 'kg' },
    { id: 'pollo', name: 'Pollo Desmechado (Relleno)', stock: 15.0, unit: 'kg' },
    { id: 'queso', name: 'Queso Blanco (Relleno)', stock: 10.0, unit: 'kg' }
];

const INVENTORY_KEY = 'casa_lucenzo_inventory_modular';
const SALES_LOG_KEY = 'casa_lucenzo_sales_log';
const EXPENSES_KEY = 'casa_lucenzo_expenses';
const DEBTS_KEY = 'casa_lucenzo_debts';
const REPLENISHMENTS_KEY = 'casa_lucenzo_replenishments';
const PREFERENCES_KEY = 'casa_lucenzo_preferences';
const INGREDIENTS_KEY = 'casa_lucenzo_ingredients';

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

            // Auto-merge missing default products (e.g. dulces)
            let updated = false;
            DEFAULT_PRODUCTS.forEach(defProd => {
                if (!parsed.some(p => p.id === defProd.id)) {
                    parsed.push({ ...defProd });
                    updated = true;
                }
            });
            if (updated) {
                saveProducts(parsed);
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
        localStorage.removeItem(INGREDIENTS_KEY);
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

// ================= INGREDIENTS =================

function loadIngredients() {
    const saved = localStorage.getItem(INGREDIENTS_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch(e) {
            return JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
        }
    }
    return JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
}

function saveIngredients(ingredients) {
    localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(ingredients));
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

const BCV_PREFS_KEY = 'casa_lucenzo_bcv_prefs';

function loadBcvPreferences() {
    const saved = localStorage.getItem(BCV_PREFS_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch(e) {
            return { bcvRate: 732.48, useAutoBcv: true };
        }
    }
    return { bcvRate: 732.48, useAutoBcv: true };
}

function saveBcvPreferences(rate, auto) {
    try {
        localStorage.setItem(BCV_PREFS_KEY, JSON.stringify({ bcvRate: parseFloat(rate) || 732.48, useAutoBcv: !!auto }));
    } catch(e) {
        console.error("Failed to save BCV preferences", e);
    }
}



const LAST_CLOSE_KEY = 'casa_lucenzo_last_close_time';

function loadLastCloseTime() {
    return localStorage.getItem(LAST_CLOSE_KEY);
}

function saveLastCloseTime(time) {
    localStorage.setItem(LAST_CLOSE_KEY, time || '');
}

const COST_INSUMOS_KEY = 'casa_lucenzo_cost_insumos';

const DEFAULT_COST_INSUMOS = [
    { id: 'harina', name: 'Harina de Trigo', type: 'solid', qty: 25, price: 22.00, unit: 'kg' },
    { id: 'margarina', name: 'Margarina / Grasa', type: 'solid', qty: 10, price: 18.00, unit: 'kg' },
    { id: 'carne_mechada', name: 'Carne Mechada Guisada', type: 'solid', qty: 15, price: 75.00, unit: 'kg' },
    { id: 'pollo', name: 'Pollo Guisado desmechado', type: 'solid', qty: 15, price: 50.00, unit: 'kg' },
    { id: 'queso', name: 'Queso Blanco Rayado', type: 'solid', qty: 10, price: 45.00, unit: 'kg' },
    { id: 'aceite', name: 'Aceite de Fritura (Líquido)', type: 'liquid', qty: 10, price: 20.00, unit: 'L' },
    { id: 'tocineta', name: 'Tocineta picada', type: 'solid', qty: 5, price: 30.00, unit: 'kg' }
];

function loadCostInsumos() {
    const saved = localStorage.getItem(COST_INSUMOS_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            return JSON.parse(JSON.stringify(DEFAULT_COST_INSUMOS));
        }
    }
    return JSON.parse(JSON.stringify(DEFAULT_COST_INSUMOS));
}

function saveCostInsumos(insumos) {
    try {
        localStorage.setItem(COST_INSUMOS_KEY, JSON.stringify(insumos));
    } catch (e) {
        console.error("Failed to save cost insumos", e);
    }
}

// Expose to window namespace
window.StorageManager = {
    DEFAULT_PRODUCTS,
    DEFAULT_INGREDIENTS,
    DEFAULT_COST_INSUMOS,
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
    loadIngredients,
    saveIngredients,
    loadCostInsumos,
    saveCostInsumos,
    loadPreferences,
    savePreferences,
    loadBcvPreferences,
    saveBcvPreferences,
    loadLastCloseTime,
    saveLastCloseTime
};
