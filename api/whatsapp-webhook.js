const crypto = require('crypto');
const { normalizeText, DEFAULT_PRODUCTS, SupabaseRest, isAuthorizedPhone, getConversationHistory, appendConversationTurn, fetchHistoricalDailySummary, processIntentWithGemini } = require('../lib/whatsapp-bot-shared');

// Read raw body buffer from request
function getRawBody(req) {
    return new Promise((resolve, reject) => {
        if (req.rawBody) return resolve(req.rawBody);
        if (Buffer.isBuffer(req.body)) return resolve(req.body);
        if (typeof req.body === 'string') return resolve(Buffer.from(req.body, 'utf8'));
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', (err) => reject(err));
    });
}

// Verify Meta HMAC-SHA256 signature
function verifyMetaSignature(rawBodyBuffer, signatureHeader, appSecret) {
    if (!signatureHeader || !appSecret) return false;
    try {
        const hmac = crypto.createHmac('sha256', appSecret).update(rawBodyBuffer).digest('hex');
        const expected = `sha256=${hmac}`;
        const expectedBuffer = Buffer.from(expected);
        const signatureBuffer = Buffer.from(signatureHeader);
        if (expectedBuffer.length !== signatureBuffer.length) {
            return false;
        }
        return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch (e) {
        return false;
    }
}

/**
 * Main Vercel Serverless Function Endpoint: /api/whatsapp-webhook
 */
const handler = async (req, res) => {
    // ----------------------------------------------------
    // 0. Safety Check: Bot Disabled by Default (HTTP 503)
    // ----------------------------------------------------
    if (process.env.WHATSAPP_BOT_ENABLED !== 'true') {
        return res.status(503).json({ error: 'WhatsApp Bot is currently disabled (WHATSAPP_BOT_ENABLED !== true)' });
    }

    // ----------------------------------------------------
    // 1. GET Request: Meta Webhook Handshake Verification
    // ----------------------------------------------------
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (!expectedToken) {
            console.error('❌ Missing required environment variable: WHATSAPP_VERIFY_TOKEN');
            return res.status(500).json({ error: 'Server misconfiguration: WHATSAPP_VERIFY_TOKEN missing' });
        }

        if (mode === 'subscribe' && token === expectedToken) {
            console.log('✅ WhatsApp Webhook Verified Successfully!');
            return res.status(200).send(challenge);
        } else {
            console.warn('❌ WhatsApp Webhook Verification Failed: Invalid Token');
            return res.status(403).json({ error: 'Verification failed' });
        }
    }

    // ----------------------------------------------------
    // 2. POST Request: Incoming WhatsApp Message Event
    // ----------------------------------------------------
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const rawBodyBuffer = await getRawBody(req);
        const signatureHeader = req.headers['x-hub-signature-256'];
        const appSecret = process.env.WHATSAPP_APP_SECRET;

        if (!appSecret) {
            console.error('❌ Missing required environment variable: WHATSAPP_APP_SECRET');
            return res.status(500).json({ error: 'Server misconfiguration: WHATSAPP_APP_SECRET missing' });
        }

        // Verify Meta HMAC-SHA256 signature
        if (!verifyMetaSignature(rawBodyBuffer, signatureHeader, appSecret)) {
            console.warn('❌ WhatsApp Webhook Signature Verification Failed: Invalid X-Hub-Signature-256');
            return res.status(403).json({ error: 'Invalid request signature' });
        }

        const rawBodyStr = rawBodyBuffer.toString('utf8');
        const body = rawBodyStr ? JSON.parse(rawBodyStr) : {};

        // Extract incoming message payload from Meta Graph API structure
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];
        const contact = value?.contacts?.[0];

        if (!message) {
            return res.status(200).json({ status: 'event_ignored_no_message' });
        }

        const rawFrom = message.from;
        const senderName = contact?.profile?.name || 'Administrador';

        // ----------------------------------------------------
        // 3. Security Authorization Check (Phone Whitelist)
        // ----------------------------------------------------
        const adminPhonesEnv = process.env.WHATSAPP_ADMIN_PHONE;
        if (!adminPhonesEnv) {
            console.error('❌ Missing required environment variable: WHATSAPP_ADMIN_PHONE');
            return res.status(500).json({ error: 'Server misconfiguration: WHATSAPP_ADMIN_PHONE missing' });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        const db = new SupabaseRest(supabaseUrl, supabaseKey);

        const isAuthorized = await isAuthorizedPhone(db, rawFrom);

        if (!isAuthorized) {
            const unauthorizedMsg = `⛔ Acceso denegado: El número (+${rawFrom}) no está autorizado para administrar Casa Lucenzo. Contacta al soporte para registrar tu número.`;
            await sendWhatsAppMessage(rawFrom, unauthorizedMsg);
            return res.status(200).json({ status: 'unauthorized_sender', phone: rawFrom });
        }

        // ----------------------------------------------------
        // 4. Extract Message Content (Text or Audio Media)
        // ----------------------------------------------------
        let messageText = '';

        if (message.type === 'text') {
            messageText = message.text?.body || '';
        } else if (message.type === 'audio' || message.type === 'voice') {
            const audioId = message.audio?.id;
            messageText = await downloadAndTranscribeAudio(audioId);
        } else {
            const reply = `🤖 Hola ${senderName}, por el momento solo puedo procesar mensajes de texto y notas de voz para gestionar Casa Lucenzo.`;
            await sendWhatsAppMessage(rawFrom, reply);
            return res.status(200).json({ status: 'unsupported_message_type' });
        }

        if (!messageText.trim()) {
            return res.status(200).json({ status: 'empty_message' });
        }

        // ----------------------------------------------------
        // 5. Fetch Full Live Business Context (Products & Sales)
        // ----------------------------------------------------
        let currentProducts = DEFAULT_PRODUCTS;
        const dbProducts = await db.get('products');
        if (dbProducts && dbProducts.length > 0) {
            currentProducts = dbProducts;
        }

        let salesSummaryText = 'No hay ventas registradas hoy todavía.';
        let topProductsText = 'Sin datos de ventas aún.';
        let totalSalesUsd = 0;
        let salesCount = 0;

        const dbSales = await db.get('sales');
        if (dbSales && Array.isArray(dbSales)) {
            const todayStr = new Date().toISOString().slice(0, 10);
            const todaySales = dbSales.filter(s => (s.timestamp || '').startsWith(todayStr));
            salesCount = todaySales.length;
            totalSalesUsd = todaySales.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);

            const counts = {};
            todaySales.forEach(s => {
                const name = s.product_name || 'Producto';
                counts[name] = (counts[name] || 0) + (parseInt(s.quantity, 10) || 1);
            });

            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            if (sorted.length > 0) {
                topProductsText = sorted.map(([name, qty], idx) => `${idx + 1}. ${name}: ${qty} unidades`).join('\n');
            }
            salesSummaryText = `Ventas Totales Hoy: $${totalSalesUsd.toFixed(2)} USD | Operaciones: ${salesCount}`;
        }

        // ----------------------------------------------------
        // 6. Conversational AI NLU with Gemini 2.5 Flash (with memory)
        // ----------------------------------------------------
        const historicalSummaryText = await fetchHistoricalDailySummary(db, 14);
        const conversationHistory = await getConversationHistory(db, rawFrom);

        const aiResult = await processIntentWithGemini(messageText, currentProducts, {
            salesSummaryText,
            topProductsText,
            totalSalesUsd,
            salesCount,
            senderName,
            historicalSummaryText
        }, conversationHistory);

        await appendConversationTurn(db, rawFrom, 'user', messageText);

        const { intent, target_product_id, quantity, bcv_rate, reply_text } = aiResult;

        // ----------------------------------------------------
        // 7. Execute Database Actions (If mutation requested)
        // ----------------------------------------------------
        let replyMessage = reply_text || '';

        if (intent === 'add_stock' || intent === 'set_stock') {
            const targetProduct = currentProducts.find(p => p.id === target_product_id) || 
                                  currentProducts.find(p => normalizeText(p.name).includes(normalizeText(aiResult.product_name || '')));

            if (targetProduct) {
                const qtyVal = parseInt(quantity, 10) || 0;
                let newStock = targetProduct.stock || 0;

                if (intent === 'add_stock') {
                    newStock += qtyVal;
                } else {
                    newStock = qtyVal;
                }

                // Update Supabase
                await db.patch('products', 'id', targetProduct.id, { stock: newStock });
                targetProduct.stock = newStock;

                // Log Activity
                await db.post('activity_logs', {
                    user_name: `WhatsApp (${senderName})`,
                    action: 'Ajuste de Stock vía WhatsApp',
                    details: `${intent === 'add_stock' ? 'Cargados' : 'Establecido'} ${qtyVal} ud de ${targetProduct.name}. Nuevo stock: ${newStock}`,
                    timestamp: new Date().toISOString()
                });

                if (!replyMessage || replyMessage.includes('⚠️')) {
                    replyMessage = `✅ *¡Stock Actualizado Exitosamente!*\n\n` +
                                   `📦 *Producto:* ${targetProduct.name}\n` +
                                   `➕ *Cantidad:* ${intent === 'add_stock' ? '+' : ''}${qtyVal}\n` +
                                   `📊 *Nuevo Stock en Vitrina:* ${newStock} unidades\n\n` +
                                   `*Casa Lucenzo Bot* 🥖`;
                }
            }
        } else if (intent === 'update_bcv') {
            const newRate = parseFloat(bcv_rate) || 0;
            if (newRate > 0) {
                await db.post('exchange_rates', {
                    rate: newRate,
                    source: 'WhatsApp Admin',
                    timestamp: new Date().toISOString()
                });
                if (!replyMessage) {
                    replyMessage = `💵 *Tasa BCV Actualizada Exitosamente*\n\n` +
                                   `📈 *Nueva Tasa:* ${newRate.toFixed(2)} VES/USD\n` +
                                   `👤 *Actualizado por:* ${senderName}\n\n` +
                                   `Todos los precios en Bolívares se han recargado en el POS.`;
                }
            }
        }

        // Send WhatsApp Outgoing Response Message
        await appendConversationTurn(db, rawFrom, 'assistant', replyMessage);
        await sendWhatsAppMessage(rawFrom, replyMessage);
        return res.status(200).json({ status: 'success', intent, reply: replyMessage });

    } catch (err) {
        console.error('❌ Error processing WhatsApp Webhook:', err);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = handler;
module.exports.config = {
    api: {
        bodyParser: false
    }
};

/**
 * Transcribe Audio Voice Notes using Gemini 2.5 Flash Multimodal
 */
async function downloadAndTranscribeAudio(audioId) {
    const waToken = process.env.WHATSAPP_API_TOKEN;
    if (!waToken || !audioId) {
        return 'Mensaje de voz recibido';
    }

    try {
        const mediaUrlResp = await fetch(`https://graph.facebook.com/v19.0/${audioId}`, {
            headers: { 'Authorization': `Bearer ${waToken}` }
        });
        const mediaData = await mediaUrlResp.json();
        if (mediaData.url) {
            const audioFileResp = await fetch(mediaData.url, {
                headers: { 'Authorization': `Bearer ${waToken}` }
            });
            const arrayBuffer = await audioFileResp.arrayBuffer();
            const base64Audio = Buffer.from(arrayBuffer).toString('base64');

            const apiKey = process.env.GEMINI_API_KEY;
            if (apiKey) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: "Transcribe exactamente este audio de voz en español sobre inventario de panadería:" },
                                { inline_data: { mime_type: "audio/ogg", data: base64Audio } }
                            ]
                        }]
                    })
                });
                const data = await resp.json();
                return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Mensaje de voz procesado';
            }
        }
    } catch (e) {
        console.warn('⚠️ Audio transcription error:', e.message);
    }
    return 'Mensaje de voz recibido';
}

/**
 * Send Outgoing WhatsApp Message via Meta Graph API
 */
async function sendWhatsAppMessage(recipientPhone, textBody) {
    const waToken = process.env.WHATSAPP_API_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!waToken || !phoneId) {
        console.log(`📱 [SIMULATED WHATSAPP OUTGOING TO +${recipientPhone}]:\n${textBody}`);
        return;
    }

    try {
        const resp = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${waToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: recipientPhone,
                type: 'text',
                text: { body: textBody }
            })
        });

        if (!resp.ok) {
            const errTxt = await resp.text();
            console.error('❌ Meta Graph API Send Error:', errTxt);
        }
    } catch (e) {
        console.error('❌ Error sending WhatsApp message:', e.message);
    }
}
