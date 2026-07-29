/**
 * Casa Lucenzo - Authentication & Access Role Domain Module
 * Handles role permission validation and user session rules.
 */

const AuthManager = {
    /**
     * Role permission matrix
     */
    PERMISSIONS: {
        admin: ['day_close', 'view_pos', 'view_kitchen', 'view_admin', 'edit_products', 'manage_users', 'edit_bcv'],
        venta: ['view_pos', 'register_sales', 'add_expenses', 'add_debts'],
        cocina: ['view_kitchen', 'replenish_stock', 'manage_ingredients']
    },

    /**
     * Checks whether a role has permission for a specific action
     * @param {string} role User role ('admin' | 'venta' | 'cocina')
     * @param {string} action Permission action key
     * @returns {boolean} True if permitted
     */
    checkRolePermission(role, action) {
        if (!role || !action) return false;
        const normalizedRole = role.toLowerCase();
        if (normalizedRole === 'admin') return true;
        const permissions = AuthManager.PERMISSIONS[normalizedRole] || [];
        return permissions.includes(action);
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkRolePermission: AuthManager.checkRolePermission,
        AuthManager
    };
}
if (typeof window !== 'undefined') {
    window.AuthManager = AuthManager;
}
