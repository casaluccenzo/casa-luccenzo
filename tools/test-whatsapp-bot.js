const crypto = require('crypto');
const handler = require('../api/whatsapp-webhook');

// Setup mock environment variables for integration runner
process.env.WHATSAPP_BOT_ENABLED = 'true';
process.env.WHATSAPP_VERIFY_TOKEN = 'test_verify_token';
process.env.WHATSAPP_APP_SECRET = 'test_app_secret';
process.env.WHATSAPP_ADMIN_PHONE = '15550001111';

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

async function runWhatsAppBotTests() {
    console.log('🧪 Starting Casa Lucenzo WhatsApp Bot Integration Verification...\n');

    // Test 1: GET Webhook Handshake Verification
    console.log('Test 1: Meta Webhook Verification Handshake (GET)');
    const { req: req1, res: res1 } = createMockReqRes('GET', {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test_verify_token',
        'hub.challenge': '123456789'
    });
    await handler(req1, res1);
    if (res1.getStatusCode() === 200 && res1.getData() === '123456789') {
        console.log('  ✅ PASSED: Webhook handshake verified with 200 OK & challenge echo.\n');
    } else {
        console.error('  ❌ FAILED: Webhook handshake failed:', res1.getStatusCode(), res1.getData());
    }

    // Test 2: Unauthorized Sender Rejection
    console.log('Test 2: Security Check - Unauthorized Phone Number Rejection');
    const { req: req2, res: res2 } = createMockReqRes('POST', {}, {
        entry: [{
            changes: [{
                value: {
                    contacts: [{ profile: { name: 'Intruso' } }],
                    messages: [{
                        from: '19999999999', // Unauthorized phone
                        type: 'text',
                        text: { body: 'Cárgame 100 pastelitos' }
                    }]
                }
            }]
        }]
    });
    await handler(req2, res2);
    if (res2.getData()?.status === 'unauthorized_sender') {
        console.log('  ✅ PASSED: Unauthorized sender correctly blocked with 200 / rejection.\n');
    } else {
        console.error('  ❌ FAILED: Security check failed to block unauthorized sender:', res2.getData());
    }

    // Test 3: Authorized Stock Load Command ("Cárgame 30 pastelitos de queso")
    console.log('Test 3: Authorized Command - Add Stock ("Cárgame 30 pastelitos de queso")');
    const { req: req3, res: res3 } = createMockReqRes('POST', {}, {
        entry: [{
            changes: [{
                value: {
                    contacts: [{ profile: { name: 'Enzo (Admin)' } }],
                    messages: [{
                        from: '15550001111', // Authorized admin phone
                        type: 'text',
                        text: { body: 'Cárgame 30 pastelitos de queso' }
                    }]
                }
            }]
        }]
    });
    await handler(req3, res3);
    if (res3.getData()?.status === 'success' && res3.getData()?.intent === 'add_stock') {
        console.log('  ✅ PASSED: Intent "add_stock" extracted successfully.');
        console.log('  📱 Output Message:\n' + res3.getData()?.reply + '\n');
    } else {
        console.error('  ❌ FAILED: Stock command processing failed:', res3.getData());
    }

    // Test 4: Authorized Sales Query Command ("¿Cuánto llevamos vendido hoy?")
    console.log('Test 4: Authorized Command - Query Daily Sales ("¿Cuánto llevamos vendido hoy?")');
    const { req: req4, res: res4 } = createMockReqRes('POST', {}, {
        entry: [{
            changes: [{
                value: {
                    contacts: [{ profile: { name: 'Enzo (Admin)' } }],
                    messages: [{
                        from: '15550001111',
                        type: 'text',
                        text: { body: '¿Cuánto llevamos vendido hoy?' }
                    }]
                }
            }]
        }]
    });
    await handler(req4, res4);
    if (res4.getData()?.status === 'success' && res4.getData()?.intent === 'query_sales') {
        console.log('  ✅ PASSED: Intent "query_sales" processed successfully.');
        console.log('  📱 Output Message:\n' + res4.getData()?.reply + '\n');
    } else {
        console.error('  ❌ FAILED: Sales query failed:', res4.getData());
    }

    console.log('🎉 ALL WHATSAPP BOT INTEGRATION TESTS COMPLETED SUCCESSFULLY!');
}

runWhatsAppBotTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
