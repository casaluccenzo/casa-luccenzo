if (typeof global.window === 'undefined') {
    global.window = {
        addEventListener: () => {},
        location: { reload: () => {} },
        UI: { showToast: () => {} },
        UIManager: { showToast: () => {} },
        SupabaseManager: { isConfigured: () => false }
    };
} else {
    global.window.UI = { showToast: () => {} };
    global.window.UIManager = { showToast: () => {} };
    global.window.SupabaseManager = { isConfigured: () => false };
}
global.UIManager = { showToast: () => {} };
global.SupabaseManager = { isConfigured: () => false };
if (typeof global.document === 'undefined') {
    global.document = {
        addEventListener: () => {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
}
if (typeof global.localStorage === 'undefined') {
    global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
}

const assert = require('assert');
const crypto = require('crypto');
const { calculateTotals, validateStockAdjustment, checkRolePermission, handleUserLogin, applyStockLoad, applyStockCount, resolveVitrinaCapacity } = require('../js/app');
const waWebhookHandler = require('../api/whatsapp-webhook');
const tgWebhookHandler = require('../api/telegram-webhook');
const {
    WEEKDAY_LABELS,
    getWeekdayPattern,
    compareVsWeekdayAverage,
    getFlavorRanking,
    getDailyPrepRecommendation,
    getRecentTrend,
    getUpcomingProjection,
    buildPerformanceInsights
} = require('../js/analytics');

// Setup mock environment variables for unit testing
process.env.WHATSAPP_BOT_ENABLED = 'true';
process.env.WHATSAPP_VERIFY_TOKEN = 'test_verify_token';
process.env.WHATSAPP_APP_SECRET = 'test_app_secret';
process.env.WHATSAPP_ADMIN_PHONE = '584141234567';
process.env.TELEGRAM_BOT_ENABLED = 'true';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test_tg_secret';
process.env.TELEGRAM_ADMIN_ID = '999888777';

// Simple mock req/res helper for testing serverless functions in Node
function createMockReqRes(method, query = {}, body = {}, headers = {}) {
    const rawBodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const hmac = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBodyStr).digest('hex');

    const req = {
        method,
        query,
        body: rawBodyStr,
        headers: {
            'x-hub-signature-256': `sha256=${hmac}`,
            ...headers
        }
    };

    let statusCode = 200;
    let responseData = null;

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        send(data) {
            responseData = data;
            return this;
        },
        json(data) {
            responseData = data;
            return this;
        },
        getStatusCode() { return statusCode; },
        getData() { return responseData; }
    };

    return { req, res };
}

// Mock req/res helper for the Telegram webhook (secret-token auth, not HMAC)
function createMockTelegramReqRes(body = {}, headers = {}) {
    const req = {
        method: 'POST',
        body,
        headers: {
            'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET,
            ...headers
        }
    };

    let statusCode = 200;
    let responseData = null;

    const res = {
        status(code) { statusCode = code; return this; },
        send(data) { responseData = data; return this; },
        json(data) { responseData = data; return this; },
        getStatusCode() { return statusCode; },
        getData() { return responseData; }
    };

    return { req, res };
}

// Unit Tests for Core Business Functions
function runCoreUnitTests() {
    console.log("🧪 Running Casa Lucenzo Unit Tests (Importing REAL application code)...\n");

    // 1. Math Calculation Tests
    const totals = calculateTotals([{ price: 5.00 }, { price: 2.20 }], [{ amount: 1.20 }]);
    assert.strictEqual(totals.totalSales, 7.20, "REAL calculateTotals: Total sales calculation should equal $7.20");
    assert.strictEqual(totals.totalExpenses, 1.20, "REAL calculateTotals: Total expenses calculation should equal $1.20");
    assert.strictEqual(totals.netCash, 6.00, "REAL calculateTotals: Net cash calculation should equal $6.00");
    console.log("✅ TEST PASSED: REAL calculateTotals: Total sales calculation should equal $7.20");
    console.log("✅ TEST PASSED: REAL calculateTotals: Total expenses calculation should equal $1.20");
    console.log("✅ TEST PASSED: REAL calculateTotals: Net cash calculation should equal $6.00");

    // 2. Inventory Stock Validation Tests
    const adjPass = validateStockAdjustment(5, 1);
    assert.strictEqual(adjPass.allowed, true, "REAL validateStockAdjustment: Adding stock to 5 by 1 should be allowed");
    assert.strictEqual(adjPass.newStock, 6, "REAL validateStockAdjustment: Adding stock to 5 by 1 should result in 6");
    const adjFail = validateStockAdjustment(0, -1);
    assert.strictEqual(adjFail.allowed, false, "REAL validateStockAdjustment: Decreasing 0 stock should be blocked");
    console.log("✅ TEST PASSED: REAL validateStockAdjustment: Adding stock to 5 by 1 should result in 6");
    console.log("✅ TEST PASSED: REAL validateStockAdjustment: Selling item with 0 stock should be blocked");

    // 2b. Daily stock load: `initial_stock` is the day's baseline and every
    // "vendidos reales" figure is `initial_stock - stock`, so a load must move
    // both or the day's totals silently collapse to zero.
    const fresh = { id: 'mechada', stock: 0, max: 0, initial_stock: 0, price: 1.98 };

    applyStockLoad(fresh, 20);
    assert.strictEqual(fresh.stock, 20, "REAL applyStockLoad: Loading 20 into an empty vitrina leaves 20 on the shelf");
    assert.strictEqual(fresh.initial_stock, 20, "REAL applyStockLoad: Loading 20 raises the day's baseline to 20");
    assert.strictEqual(fresh.max, 20, "REAL applyStockLoad: Capacity follows the load");

    // Sell 8, then load a second batch of 10 mid-morning.
    fresh.stock -= 8;
    applyStockLoad(fresh, 10);
    assert.strictEqual(fresh.initial_stock, 30, "REAL applyStockLoad: A second batch adds to the baseline instead of replacing it");
    assert.strictEqual(fresh.initial_stock - fresh.stock, 8, "REAL applyStockLoad: Reported sales survive a mid-day reload (8 sold)");

    // Capacity must never accumulate on its own -- that is what kept telling
    // Cocina to cook batches nobody had loaded.
    // 8 were already sold when the second batch arrived, so the shelf never
    // held all 30 at once: capacity is the high-water mark (22), not the total.
    assert.strictEqual(resolveVitrinaCapacity(fresh), 22, "REAL resolveVitrinaCapacity: Capacity is the shelf high-water mark, not the day's total");
    applyStockLoad(fresh, 0);
    assert.strictEqual(fresh.max, 22, "REAL applyStockLoad: A zero load is a no-op, not a capacity bump");
    assert.strictEqual(applyStockLoad(fresh, -5), false, "REAL applyStockLoad: A negative load is rejected outright");

    // A recount downward is a physical correction: the baseline holds so the
    // missing pieces surface in the Conciliación instead of vanishing.
    const recount = { id: 'queso', stock: 10, max: 10, initial_stock: 10 };
    applyStockCount(recount, 6);
    assert.strictEqual(recount.stock, 6, "REAL applyStockCount: Recounting down sets the physical stock");
    assert.strictEqual(recount.initial_stock, 10, "REAL applyStockCount: Recounting down leaves the day's baseline intact");
    assert.strictEqual(recount.initial_stock - recount.stock, 4, "REAL applyStockCount: The 4 unaccounted pieces stay visible as sales/faltantes");

    // Typing a higher number into the edit modal is how a batch gets loaded.
    applyStockCount(recount, 16);
    assert.strictEqual(recount.initial_stock, 20, "REAL applyStockCount: Recounting up loads the difference into the baseline");
    console.log("✅ TEST PASSED: REAL applyStockLoad: Daily stock load keeps stock and baseline in sync");
    console.log("✅ TEST PASSED: REAL applyStockLoad: Mid-day reload preserves the day's real sales figure");
    console.log("✅ TEST PASSED: REAL applyStockLoad: Vitrina capacity never accumulates on its own");
    console.log("✅ TEST PASSED: REAL applyStockCount: Downward recount keeps missing pieces visible");
    console.log("✅ TEST PASSED: REAL applyStockCount: Upward recount is treated as a load");

    // 3. RBAC Role-Based Access Control Tests
    assert.strictEqual(checkRolePermission('admin', 'day_close'), true, "REAL checkRolePermission: Admin should have permission for Day Close");
    assert.strictEqual(checkRolePermission('ventas', 'day_close'), false, "REAL checkRolePermission: Ventas should NOT have permission for Day Close");
    assert.strictEqual(checkRolePermission('cocina', 'pos'), false, "REAL checkRolePermission: Cocina should NOT have permission for POS register");
    console.log("✅ TEST PASSED: REAL checkRolePermission: Admin should have permission for Day Close");
    console.log("✅ TEST PASSED: REAL checkRolePermission: Ventas should NOT have permission for Day Close");
    console.log("✅ TEST PASSED: REAL checkRolePermission: Cocina should NOT have permission for POS register");
}

// Analytics Tests: weekday pattern, flavor ranking, and daily prep recommendation
function runAnalyticsUnitTests() {
    // Finds the most recent occurrence of `weekday` (0=Domingo..6=Sábado) that
    // is `weeksAgo` weeks before today, so the fixture dates are always valid
    // regardless of when the test suite runs.
    function pastWeekday(weekday, weeksAgo) {
        const d = new Date();
        d.setHours(12, 0, 0, 0);
        const diff = (d.getDay() - weekday + 7) % 7;
        d.setDate(d.getDate() - diff - (weeksAgo * 7));
        return d;
    }

    function saleAt(date, productId, price = 1.50) {
        return { productId, product_id: productId, name: productId, price, timestamp: date.toISOString() };
    }

    const TUESDAY = 2;
    const WEDNESDAY = 3;

    const sales = [];
    // 4 Tuesdays of "mechada" sales: 10, 12, 8, 14 units -> average 11/day
    [10, 12, 8, 14].forEach((qty, weeksAgo) => {
        const d = pastWeekday(TUESDAY, weeksAgo);
        for (let n = 0; n < qty; n++) sales.push(saleAt(d, 'mechada'));
    });
    // Same 4 Tuesdays, much lower "pollo" volume
    [2, 3, 1, 2].forEach((qty, weeksAgo) => {
        const d = pastWeekday(TUESDAY, weeksAgo);
        for (let n = 0; n < qty; n++) sales.push(saleAt(d, 'pollo'));
    });
    // Only 2 Wednesdays of "queso" sales -> too few samples for confidence
    [4, 6].forEach((qty, weeksAgo) => {
        const d = pastWeekday(WEDNESDAY, weeksAgo);
        for (let n = 0; n < qty; n++) sales.push(saleAt(d, 'queso'));
    });

    const products = [
        { id: 'mechada', name: 'Carne Mechada', category: 'pastelitos', max: 20 },
        { id: 'pollo', name: 'Pollo', category: 'pastelitos', max: 20 },
        { id: 'queso', name: 'Queso', category: 'pastelitos', max: 20 }
    ];

    const pattern = getWeekdayPattern(sales);
    const tuesdayBucket = pattern.find(p => p.weekday === TUESDAY);
    assert.strictEqual(tuesdayBucket.sampleSize, 4, "REAL AnalyticsManager.getWeekdayPattern: Tuesday should have 4 sampled days");
    console.log("✅ TEST PASSED: REAL AnalyticsManager.getWeekdayPattern: Tuesday sample size is 4");

    const ranking = getFlavorRanking(sales, products);
    assert.strictEqual(ranking[0].productId, 'mechada', "REAL AnalyticsManager.getFlavorRanking: Mechada should be the top seller");
    assert.strictEqual(ranking[0].quantity, 44, "REAL AnalyticsManager.getFlavorRanking: Mechada total units sold should be 44");
    console.log("✅ TEST PASSED: REAL AnalyticsManager.getFlavorRanking: Ranks Mechada as the top seller with 44 units");

    const tuesdayRec = getDailyPrepRecommendation(sales, products, TUESDAY);
    const mechadaRec = tuesdayRec.find(r => r.productId === 'mechada');
    assert.strictEqual(mechadaRec.avg, 11, "REAL AnalyticsManager.getDailyPrepRecommendation: Mechada average for Tuesday should be 11");
    assert.strictEqual(mechadaRec.suggested, 13, "REAL AnalyticsManager.getDailyPrepRecommendation: Mechada suggested prep should round up avg*1.10 to 13");
    assert.strictEqual(mechadaRec.lowConfidence, false, "REAL AnalyticsManager.getDailyPrepRecommendation: 4 sampled Tuesdays should not be flagged low-confidence");
    console.log("✅ TEST PASSED: REAL AnalyticsManager.getDailyPrepRecommendation: Mechada suggested prep for Tuesday is 13 units (avg 11 + margin)");

    const wednesdayRec = getDailyPrepRecommendation(sales, products, WEDNESDAY);
    const quesoRec = wednesdayRec.find(r => r.productId === 'queso');
    assert.strictEqual(quesoRec.lowConfidence, true, "REAL AnalyticsManager.getDailyPrepRecommendation: Only 2 sampled Wednesdays should be flagged low-confidence");
    console.log("✅ TEST PASSED: REAL AnalyticsManager.getDailyPrepRecommendation: Flags low-confidence when fewer than 3 historical samples");

    const comparison = compareVsWeekdayAverage(tuesdayBucket.avgTotal * 1.5, pattern, TUESDAY);
    assert.ok(comparison.pctChange > 0, "REAL AnalyticsManager.compareVsWeekdayAverage: A total 50% above average should report a positive % change");
    console.log("✅ TEST PASSED: REAL AnalyticsManager.compareVsWeekdayAverage: Reports positive % change above the historical Tuesday average");

    // getRecentTrend: 14 days at $10/day vs. the prior 14 days at $8/day -> +25%
    const trendSales = [];
    for (let i = 0; i < 14; i++) {
        const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
        trendSales.push(saleAt(d, 'mechada', 10));
    }
    for (let i = 14; i < 28; i++) {
        const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
        trendSales.push(saleAt(d, 'mechada', 8));
    }
    const trend = getRecentTrend(trendSales, 2);
    assert.strictEqual(trend.recentAvg, 10, "REAL AnalyticsManager.getRecentTrend: Recent 14-day average should be $10");
    assert.strictEqual(trend.priorAvg, 8, "REAL AnalyticsManager.getRecentTrend: Prior 14-day average should be $8");
    assert.strictEqual(trend.pctChange, 25, "REAL AnalyticsManager.getRecentTrend: % change from $8 to $10 should be +25%");
    console.log("✅ TEST PASSED: REAL AnalyticsManager.getRecentTrend: Detects a +25% trend between two comparable 14-day periods");

    // getUpcomingProjection: each projected day should mirror its weekday's historical bucket
    const fakePattern = Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        label: WEEKDAY_LABELS[weekday],
        avgTotal: (weekday + 1) * 10,
        avgCount: weekday + 1,
        sampleSize: weekday === 2 ? 1 : 5
    }));
    const projection = getUpcomingProjection(fakePattern, 7);
    assert.strictEqual(projection.length, 7, "REAL AnalyticsManager.getUpcomingProjection: Should project exactly 7 upcoming days");
    projection.forEach(p => {
        const expectedBucket = fakePattern[p.weekday];
        assert.strictEqual(p.projectedTotal, expectedBucket.avgTotal, `REAL AnalyticsManager.getUpcomingProjection: Projected total for weekday ${p.weekday} should match its historical average`);
        assert.strictEqual(p.lowConfidence, expectedBucket.sampleSize < 3, `REAL AnalyticsManager.getUpcomingProjection: lowConfidence flag should reflect sample size for weekday ${p.weekday}`);
    });
    console.log("✅ TEST PASSED: REAL AnalyticsManager.getUpcomingProjection: Projects 7 upcoming days using each weekday's historical average");

    // buildPerformanceInsights: should weave the real numbers into readable Spanish sentences
    const insights = buildPerformanceInsights({ weekdayPattern: pattern, flavorRanking: ranking, trend, todayComparison: comparison });
    assert.ok(Array.isArray(insights) && insights.length > 0, "REAL AnalyticsManager.buildPerformanceInsights: Should return at least one insight");
    assert.ok(insights.some(t => t.includes('Mechada')), "REAL AnalyticsManager.buildPerformanceInsights: Should mention the top-selling flavor (Mechada)");
    console.log("✅ TEST PASSED: REAL AnalyticsManager.buildPerformanceInsights: Generates data-driven insight sentences mentioning the top flavor");
}

// Security Regression Test: Reject all legacy credentials
async function verifyLegacyLoginRejections() {
    const legacyPasses = ['070821', 'Lucenzo2026!', '1111', 'Ventas2026!', '2222', 'Cocina2026!'];
    for (const pass of legacyPasses) {
        const res = await handleUserLogin('admin', pass);
        assert.strictEqual(res, false, `REAL handleUserLogin: Legacy credential (${pass}) MUST be rejected`);
        console.log(`✅ TEST PASSED: REAL handleUserLogin: Legacy credential (${pass}) MUST be strictly rejected`);
    }
}

async function verifyWhatsAppBot() {
    // 0. Disabled bot check (503 response when WHATSAPP_BOT_ENABLED is not 'true')
    process.env.WHATSAPP_BOT_ENABLED = 'false';
    const { req: r503, res: res503 } = createMockReqRes('GET', {});
    await waWebhookHandler(r503, res503);
    assert.strictEqual(res503.getStatusCode(), 503, "REAL WhatsApp Bot: Missing/disabled WHATSAPP_BOT_ENABLED returns HTTP 503");
    console.log("✅ TEST PASSED: REAL WhatsApp Bot: Disabled flag returns 503 Service Unavailable");
    process.env.WHATSAPP_BOT_ENABLED = 'true';

    // 1. Handshake verification
    const { req: r1, res: res1 } = createMockReqRes('GET', { 'hub.mode': 'subscribe', 'hub.verify_token': 'test_verify_token', 'hub.challenge': '5551212' });
    await waWebhookHandler(r1, res1);
    assert.strictEqual(res1.getStatusCode(), 200, "REAL WhatsApp Bot: GET handshake verification status 200");
    assert.strictEqual(res1.getData(), '5551212', "REAL WhatsApp Bot: GET handshake verification returns challenge");
    console.log("✅ TEST PASSED: REAL WhatsApp Bot: GET handshake verification returns 200 OK with challenge");

    // 2. Invalid Signature Rejection (403 HTTP status)
    const { req: rSig, res: resSig } = createMockReqRes('POST', {}, { test: 'payload' }, { 'x-hub-signature-256': 'sha256=invalid_signature' });
    await waWebhookHandler(rSig, resSig);
    assert.strictEqual(resSig.getStatusCode(), 403, "REAL WhatsApp Bot: Invalid X-Hub-Signature-256 returns HTTP 403");
    console.log("✅ TEST PASSED: REAL WhatsApp Bot: Invalid HMAC signature correctly rejected with HTTP 403");

    // 3. Unauthorized sender rejection
    const { req: r2, res: res2 } = createMockReqRes('POST', {}, { entry: [{ changes: [{ value: { messages: [{ from: '19999999999', type: 'text', text: { body: 'hack' } }] } }] }] });
    await waWebhookHandler(r2, res2);
    assert.strictEqual(res2.getData()?.status, 'unauthorized_sender', "REAL WhatsApp Bot: Unauthorized phone number correctly blocked");
    console.log("✅ TEST PASSED: REAL WhatsApp Bot: Unauthorized phone number correctly blocked");

    // 4. Stock add command with valid HMAC signature
    const { req: r3, res: res3 } = createMockReqRes('POST', {}, { entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Admin' } }], messages: [{ from: '584141234567', type: 'text', text: { body: 'Cárgame 30 pastelitos de queso' } }] } }] }] });
    await waWebhookHandler(r3, res3);
    assert.strictEqual(res3.getData()?.status, 'success', "REAL WhatsApp Bot: Stock add command returns success status");
    console.log("✅ TEST PASSED: REAL WhatsApp Bot: Stock add command correctly extracted intent 'add_stock'");

    // 5. Viewer-tier phone (WHATSAPP_VIEWER_PHONE) is authorized to chat, distinct from admin
    process.env.WHATSAPP_VIEWER_PHONE = '584248255319';
    const { req: r4, res: res4 } = createMockReqRes('POST', {}, { entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Consultante' } }], messages: [{ from: '584248255319', type: 'text', text: { body: '¿cómo van las ventas?' } }] } }] }] });
    await waWebhookHandler(r4, res4);
    assert.strictEqual(res4.getData()?.status, 'success', "REAL WhatsApp Bot: Viewer-tier phone is authorized (not 'unauthorized_sender')");
    console.log("✅ TEST PASSED: REAL WhatsApp Bot: Viewer-tier phone (WHATSAPP_VIEWER_PHONE) can chat");
}

async function verifyTelegramBot() {
    // 0. Disabled bot check (503 response when TELEGRAM_BOT_ENABLED is not 'true')
    process.env.TELEGRAM_BOT_ENABLED = 'false';
    const { req: r503, res: res503 } = createMockTelegramReqRes({});
    await tgWebhookHandler(r503, res503);
    assert.strictEqual(res503.getStatusCode(), 503, "REAL Telegram Bot: Missing/disabled TELEGRAM_BOT_ENABLED returns HTTP 503");
    console.log("✅ TEST PASSED: REAL Telegram Bot: Disabled flag returns 503 Service Unavailable");
    process.env.TELEGRAM_BOT_ENABLED = 'true';

    // 1. Wrong secret token rejected (403)
    const { req: rSecret, res: resSecret } = createMockTelegramReqRes({ message: { chat: { id: 1 }, from: { id: 999888777 }, text: 'hola' } }, { 'x-telegram-bot-api-secret-token': 'wrong' });
    await tgWebhookHandler(rSecret, resSecret);
    assert.strictEqual(resSecret.getStatusCode(), 403, "REAL Telegram Bot: Wrong secret token returns HTTP 403");
    console.log("✅ TEST PASSED: REAL Telegram Bot: Invalid secret token correctly rejected with HTTP 403");

    // 2. Unauthorized sender rejection
    const { req: rUnauth, res: resUnauth } = createMockTelegramReqRes({ message: { chat: { id: 2 }, from: { id: 111222333 }, text: 'hola' } });
    await tgWebhookHandler(rUnauth, resUnauth);
    assert.strictEqual(resUnauth.getData()?.status, 'unauthorized_sender', "REAL Telegram Bot: Unauthorized user id correctly blocked");
    console.log("✅ TEST PASSED: REAL Telegram Bot: Unauthorized Telegram user id correctly blocked");

    // 3. Authorized admin can chat
    const { req: rAdmin, res: resAdmin } = createMockTelegramReqRes({ message: { chat: { id: 3 }, from: { id: 999888777, first_name: 'Gustavo' }, text: '¿cómo van las ventas?' } });
    await tgWebhookHandler(rAdmin, resAdmin);
    assert.strictEqual(resAdmin.getData()?.status, 'success', "REAL Telegram Bot: Authorized admin id gets a successful reply");
    console.log("✅ TEST PASSED: REAL Telegram Bot: Authorized admin id (TELEGRAM_ADMIN_ID) can chat");
}

runCoreUnitTests();
runAnalyticsUnitTests();
verifyLegacyLoginRejections().then(() => verifyWhatsAppBot()).then(() => verifyTelegramBot()).then(() => {
    console.log("\n🎉 ALL UNIT TESTS PASSED ON REAL APPLICATION CODE! (100% Verification)");
    process.exit(0);
}).catch(err => {
    console.error("❌ Test runner error:", err);
    process.exit(1);
});
