/**
 * Casa Lucenzo - Authentication & Access Role Domain Module
 * Extracted from app.js / ui.js for modular architecture.
 */

function checkRolePermission(role, action) {
    if (!role || !action) return false;
    const normalizedRole = role.toLowerCase();
    const rolePermissions = {
        admin: ['view_stats', 'edit_inventory', 'day_close', 'manage_users', 'view_pos', 'kitchen_dispatch', 'edit_products', 'manage_users', 'edit_bcv'],
        venta: ['view_pos', 'register_sale', 'view_debts', 'add_expenses', 'add_debts'],
        cocina: ['kitchen_dispatch', 'view_recipes', 'confirm_receipt', 'replenish_stock', 'manage_ingredients']
    };
    if (normalizedRole === 'admin') return true;
    return (rolePermissions[normalizedRole] || []).includes(action);
}

const AuthManager = {
    checkRolePermission
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkRolePermission,
        AuthManager
    };
}
if (typeof window !== 'undefined') {
    window.AuthManager = AuthManager;
    window.checkRolePermission = checkRolePermission;
}
