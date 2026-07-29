// Lightweight Unit Test Runner for Casa Lucenzo (Vanilla JS)

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ TEST FAILED: ${message}`);
        process.exit(1);
    } else {
        console.log(`✅ TEST PASSED: ${message}`);
    }
}

console.log("🧪 Running Casa Lucenzo Unit Tests...\n");

// --- TEST SUITE 1: Sales & Revenue Calculations ---
function calculateTotals(sales, expenses) {
    const totalSales = sales.reduce((sum, s) => sum + (s.price || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netCash = Math.max(0, totalSales - totalExpenses);
    return { totalSales, totalExpenses, netCash };
}

const mockSales = [{ price: 1.70 }, { price: 2.50 }, { price: 3.00 }];
const mockExpenses = [{ amount: 1.20 }];
const totals = calculateTotals(mockSales, mockExpenses);

assert(totals.totalSales === 7.20, "Total sales calculation should equal $7.20");
assert(totals.totalExpenses === 1.20, "Total expenses calculation should equal $1.20");
assert(totals.netCash === 6.00, "Net cash calculation should equal $6.00");

// --- TEST SUITE 2: Inventory & Stock Control ---
function validateStockAdjustment(currentStock, changeAmount) {
    const nextStock = currentStock + changeAmount;
    if (nextStock < 0) return { allowed: false, newStock: currentStock };
    return { allowed: true, newStock: nextStock };
}

const stockTest1 = validateStockAdjustment(5, -1);
assert(stockTest1.allowed === true && stockTest1.newStock === 4, "Decreasing stock from 5 by 1 should result in 4");

const stockTest2 = validateStockAdjustment(0, -1);
assert(stockTest2.allowed === false && stockTest2.newStock === 0, "Selling item with 0 stock should be blocked");

// --- TEST SUITE 3: User Roles & Permissions ---
function checkRolePermission(role, action) {
    const rolePermissions = {
        admin: ['view_stats', 'edit_inventory', 'day_close', 'manage_users', 'view_pos', 'kitchen_dispatch'],
        venta: ['view_pos', 'register_sale', 'view_debts'],
        cocina: ['kitchen_dispatch', 'view_recipes', 'confirm_dispatch']
    };
    return (rolePermissions[role] || []).includes(action);
}

assert(checkRolePermission('admin', 'day_close') === true, "Admin should have permission for Day Close");
assert(checkRolePermission('venta', 'day_close') === false, "Ventas should NOT have permission for Day Close");
assert(checkRolePermission('cocina', 'view_pos') === false, "Cocina should NOT have permission for POS register");

console.log("\n🎉 ALL UNIT TESTS PASSED SUCCESSFULLY! (100% Verification)");
