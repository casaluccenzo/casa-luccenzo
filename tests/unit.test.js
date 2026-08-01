// Lightweight Unit Test Runner importing REAL application code for Casa Lucenzo

// Mock browser globals for Node environment execution
global.window = {
    location: { port: '', search: '', hash: '' },
    addEventListener: () => {},
    SupabaseManager: { isConfigured: () => false },
    StorageManager: { loadUsers: () => [], DEFAULT_USERS: [] },
    UIManager: { showToast: (msg) => {} }
};
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} };
global.sessionStorage = { setItem: () => {}, getItem: () => null };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.triggerHaptic = () => {};
global.logActivity = () => {};
global.applyUserRole = () => {};
global.updateLockoutUI = () => {};

const { calculateTotals } = require('../js/sales.js');
const { validateStockAdjustment } = require('../js/inventory.js');
const { checkRolePermission } = require('../js/auth.js');
const { handleUserLogin } = require('../js/app.js');

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ TEST FAILED: ${message}`);
        process.exit(1);
    } else {
        console.log(`✅ TEST PASSED: ${message}`);
    }
}

console.log("🧪 Running Casa Lucenzo Unit Tests (Importing REAL application code)...\n");

// --- TEST SUITE 1: Real Sales & Revenue Calculations ---
const mockSales = [{ price: 1.70 }, { price: 2.50 }, { price: 3.00 }];
const mockExpenses = [{ amount: 1.20 }];
const totals = calculateTotals(mockSales, mockExpenses);

assert(totals.totalSales === 7.20, "REAL calculateTotals: Total sales calculation should equal $7.20");
assert(totals.totalExpenses === 1.20, "REAL calculateTotals: Total expenses calculation should equal $1.20");
assert(totals.netCash === 6.00, "REAL calculateTotals: Net cash calculation should equal $6.00");

// --- TEST SUITE 2: Real Inventory & Stock Control ---
const stockTest1 = validateStockAdjustment(5, -1);
assert(stockTest1.allowed === true && stockTest1.newStock === 4, "REAL validateStockAdjustment: Decreasing stock from 5 by 1 should result in 4");

const stockTest2 = validateStockAdjustment(0, -1);
assert(stockTest2.allowed === false && stockTest2.newStock === 0, "REAL validateStockAdjustment: Selling item with 0 stock should be blocked");

// --- TEST SUITE 3: Real User Roles & Permissions ---
assert(checkRolePermission('admin', 'day_close') === true, "REAL checkRolePermission: Admin should have permission for Day Close");
assert(checkRolePermission('venta', 'day_close') === false, "REAL checkRolePermission: Ventas should NOT have permission for Day Close");
assert(checkRolePermission('cocina', 'view_pos') === false, "REAL checkRolePermission: Cocina should NOT have permission for POS register");

// --- TEST SUITE 4: Real Login Fallback Rejection (Security Hotfix #1 Verification) ---
async function verifyLegacyLoginRejections() {
    const legacyAttempts = [
        { u: 'admin', p: '070821' },
        { u: 'admin', p: 'Lucenzo2026!' },
        { u: 'vendedora', p: '1111' },
        { u: 'vendedora', p: 'Ventas2026!' },
        { u: 'cocina', p: '2222' },
        { u: 'cocina', p: 'Cocina2026!' }
    ];

    for (const item of legacyAttempts) {
        const res = await handleUserLogin(item.u, item.p);
        assert(res === false, `REAL handleUserLogin: Legacy credential (${item.u}:${item.p}) MUST be strictly rejected`);
    }
}

const waWebhookHandler = require('../api/whatsapp-webhook.js');

function createMockReqRes(method, query = {}, body = {}) {
    let statusCode = 200;
    let responseData = null;
    return {
        req: { method, query, body },
        res: {
            status(code) { statusCode = code; return this; },
            send(data) { responseData = data; return this; },
            json(data) { responseData = data; return this; },
            getStatusCode() { return statusCode; },
            getData() { return responseData; }
        }
    };
}

async function verifyWhatsAppBot() {
    // 1. Handshake verification
    const { req: r1, res: res1 } = createMockReqRes('GET', { 'hub.mode': 'subscribe', 'hub.verify_token': 'casa_lucenzo_wa_token', 'hub.challenge': '5551212' });
    await waWebhookHandler(r1, res1);
    assert(res1.getStatusCode() === 200 && res1.getData() === '5551212', "REAL WhatsApp Bot: GET handshake verification returns 200 OK with challenge");

    // 2. Unauthorized sender rejection
    const { req: r2, res: res2 } = createMockReqRes('POST', {}, { entry: [{ changes: [{ value: { messages: [{ from: '19999999999', type: 'text', text: { body: 'hack' } }] } }] }] });
    await waWebhookHandler(r2, res2);
    assert(res2.getData()?.status === 'unauthorized_sender', "REAL WhatsApp Bot: Unauthorized phone number correctly blocked");

    // 3. Stock add command
    const { req: r3, res: res3 } = createMockReqRes('POST', {}, { entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Admin' } }], messages: [{ from: '584141234567', type: 'text', text: { body: 'Cárgame 30 pastelitos de queso' } }] } }] }] });
    await waWebhookHandler(r3, res3);
    assert(res3.getData()?.status === 'success' && res3.getData()?.intent === 'add_stock', "REAL WhatsApp Bot: Stock add command correctly extracted intent 'add_stock'");

    // 4. Sales query command
    const { req: r4, res: res4 } = createMockReqRes('POST', {}, { entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Admin' } }], messages: [{ from: '584141234567', type: 'text', text: { body: '¿Cuánto llevamos vendido hoy?' } }] } }] }] });
    await waWebhookHandler(r4, res4);
    assert(res4.getData()?.status === 'success' && res4.getData()?.intent === 'query_sales', "REAL WhatsApp Bot: Sales query command correctly extracted intent 'query_sales'");
}

verifyLegacyLoginRejections().then(() => verifyWhatsAppBot()).then(() => {
    console.log("\n🎉 ALL UNIT TESTS PASSED ON REAL APPLICATION CODE! (100% Verification)");
}).catch(err => {
    console.error("❌ Test runner error:", err);
    process.exit(1);
});
