/**
 * Casa Lucenzo - Sales & Revenue Domain Module
 * Handles sales calculations, cart manipulation, and day close financial totals.
 */

const SalesManager = {
    /**
     * Calculates gross sales, total expenses, and net cash total
     * @param {Array} sales List of sales objects
     * @param {Array} expenses List of expense objects
     * @returns {Object} { totalSales, totalExpenses, netCash }
     */
    calculateTotals(sales = [], expenses = []) {
        const totalSales = (sales || []).reduce((sum, item) => sum + (parseFloat(item.price || item.total) || 0), 0);
        const totalExpenses = (expenses || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
        const netCash = totalSales - totalExpenses;
        
        return {
            totalSales: Number(totalSales.toFixed(2)),
            totalExpenses: Number(totalExpenses.toFixed(2)),
            netCash: Number(netCash.toFixed(2))
        };
    },

    /**
     * Adds a product to the cart or increments item quantity
     * @param {Array} cart Current cart items
     * @param {Object} product Product object to add
     * @returns {Array} Updated cart
     */
    addToCart(cart = [], product) {
        if (!product || !product.id) return cart;
        const newCart = [...cart];
        const index = newCart.findIndex(item => item.id === product.id);
        if (index >= 0) {
            newCart[index] = { ...newCart[index], qty: newCart[index].qty + 1 };
        } else {
            newCart.push({ ...product, qty: 1 });
        }
        return newCart;
    },

    /**
     * Removes or decrements a product from the cart
     * @param {Array} cart Current cart items
     * @param {string} productId Product ID to remove
     * @returns {Array} Updated cart
     */
    removeFromCart(cart = [], productId) {
        const newCart = cart.map(item => {
            if (item.id === productId) {
                return { ...item, qty: item.qty - 1 };
            }
            return item;
        }).filter(item => item.qty > 0);
        return newCart;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateTotals: SalesManager.calculateTotals,
        SalesManager
    };
}
if (typeof window !== 'undefined') {
    window.SalesManager = SalesManager;
}
