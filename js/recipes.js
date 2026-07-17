// Recipe database and calculator for Casa Lucenzo kitchen

// Base ingredients needed per single unit (in grams or milliliters)
const RECIPES = {
    mechada: {
        "Harina de Trigo": 50,
        "Margarina": 5,
        "Carne Mechada Guisada": 30
    },
    pollo: {
        "Harina de Trigo": 50,
        "Margarina": 5,
        "Pollo Guisado desmechado": 30
    },
    molida: {
        "Harina de Trigo": 50,
        "Margarina": 5,
        "Carne Molida Guisada": 30
    },
    queso: {
        "Harina de Trigo": 50,
        "Margarina": 5,
        "Queso Blanco": 30
    },
    estaciones: {
        "Harina de Trigo": 50,
        "Margarina": 5,
        "Relleno Especial (4 Estaciones)": 35
    },
    primavera: {
        "Harina de Trigo": 50,
        "Margarina": 5,
        "Relleno Especial (Primavera)": 35
    },
    ricota: {
        "Harina de Trigo": 50,
        "Margarina": 5,
        "Queso Ricota": 20,
        "Tocineta picada": 10
    },
    tocineta: {
        "Harina de Trigo": 50,
        "Margarina": 5,
        "Queso Blanco": 15,
        "Tocineta picada": 15
    }
};

/**
 * Calculates raw ingredients needed to prepare a list of replenishment orders
 * @param {Array} criticalItems List of low stock product items
 * @returns {Array} Summed raw ingredients with units (kg, units, etc.)
 */
function calculateIngredients(criticalItems) {
    const totals = {};

    criticalItems.forEach(item => {
        const recipe = RECIPES[item.id];
        if (!recipe) return; // Skip if no recipe exists (e.g. cakes, drinks)

        const qtyNeeded = item.max - item.stock;
        if (qtyNeeded <= 0) return;

        for (const [ingredient, gramsPerUnit] of Object.entries(recipe)) {
            if (!totals[ingredient]) {
                totals[ingredient] = 0;
            }
            totals[ingredient] += gramsPerUnit * qtyNeeded;
        }
    });

    // Format output (convert grams to kg if amount > 500g for easier reading)
    return Object.entries(totals).map(([name, grams]) => {
        if (grams >= 1000) {
            return {
                name,
                amount: parseFloat((grams / 1000).toFixed(2)),
                unit: 'kg'
            };
        }
        return {
            name,
            amount: Math.round(grams),
            unit: 'g'
        };
    });
}

// Expose to window namespace
window.RecipeCalculator = {
    calculateIngredients
};
