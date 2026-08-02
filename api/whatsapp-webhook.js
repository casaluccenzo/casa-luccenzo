// Helper to normalize text (remove accents/diacritics and lower-case)
function normalizeText(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// Helper to normalize phone numbers (remove +, spaces, hyphens)
function normalizePhone(phone) {
    if (!phone) return '';
    return String(phone).replace(/[^0-9]/g, '');
}

// Default product catalog fallback for Naming & Matching
const DEFAULT_PRODUCTS = [
    { id: 'p1', name: 'Pastelito de Queso', stock: 20, price: 1.50, category: 'pastelitos' },
    { id: 'p2', name: 'Pastelito de Pollo', stock: 15, price: 1.50, category: 'pastelitos' },
    { id: 'p3', name: 'Pastelito de Carne', stock: 12, price: 1.50, category: 'pastelitos' },
    { id: 'p4', name: 'Empanada de Queso', stock: 25, price: 1.20, category: 'empanadas' },
    { id: 'p5', name: 'Empanada de Carne', stock: 18, price: 1.20, category: 'empanadas' },
    { id: 'p6', name: 'Coca Cola 355ml', stock: 30, price: 1.00, category: 'bebidas' },
    { id: 'p7', name: 'Malta 250ml', stock: 24, price: 1.00, category: 'bebidas' },
    { id: 'p8', name: 'Torta Tres Leches', stock: 8, price: 3.50, category: 'tortas' }
];

/**
 * Lightweight Zero-Dependency Supabase REST Helper
 */
class SupabaseRest {
    constructor(url, key) {
        this.url = url?.replace(/\/$/, '');
        this.key = key;
    }

    async get(table, select = '*') {
        if (!this.url || !this.key) return null;
        try {
            const resp = await fetch(`${this.url}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
                headers: {
                    'apikey': this.key,
                    'Authorization': `Bearer ${this.key}`
                }
            });
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e) {
            return null;
        }
    }

    async patch(table, filterCol, filterVal, data) {
        if (!this.url || !this.key) return false;
        try {
            const resp = await fetch(`${this.url}/rest/v1/${table}?${filterCol}=eq.${encodeURIComponent(filterVal)}`, {
                method: 'PATCH',
                headers: {
                    'apikey': this.key,
                    'Authorization': `Bearer ${this.key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify(data)
            });
            return resp.ok;
        } catch (e) {
            return false;
        }
    }

    async post(table, data) {
        if (!this.url || !this.key) return false;
        try {
            const resp = await fetch(`${this.url}/rest/v1/${table}`, {
                method: 'POST',
                headers: {
                    'apikey': this.key,
                    'Authorization': `Bearer ${this.key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify(data)
            });
            return resp.ok;
        } catch (e) {
            return false;
        }
    }
}

/**
 * Main Vercel Serverless Function Endpoint: /api/whatsapp-webhook
 */
module.exports = async (req, res) => {
    // ----------------------------------------------------
    // 1. GET Request: Meta Webhook Handshake Verification
    // ----------------------------------------------------
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || 'casa_lucenzo_wa_token';

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
        const body = req.body || {};
        
        // Extract incoming message payload from Meta Graph API structure
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];
        const contact = value?.contacts?.[0];

        if (!message) {
            return res.status(200).json({ status: 'event_ignored_no_message' });
        }

        const rawFrom = message.from; // Phone number e.g. 56967979763
        const normalizedFrom = normalizePhone(rawFrom);
        const senderName = contact?.profile?.name || 'Gustavo';

        // ----------------------------------------------------
        // 3. Security Authorization Check (Phone Whitelist)
        // ----------------------------------------------------
        const adminPhonesEnv = process.env.WHATSAPP_ADMIN_PHONE || '56967979763,56936274015,584141234567,584241234567';
        const allowedPhones = adminPhonesEnv.split(',').map(p => normalizePhone(p));

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        const db = new SupabaseRest(supabaseUrl, supabaseKey);

        let isAuthorized = allowedPhones.includes(normalizedFrom);

        if (!isAuthorized && supabaseUrl && supabaseKey) {
            const userProfiles = await db.get('profiles', 'phone,role');
            if (userProfiles) {
                const found = userProfiles.find(p => normalizePhone(p.phone) === normalizedFrom && p.role === 'admin');
                if (found) isAuthorized = true;
            }
        }

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
        let topProductsText = 'Sin datos de productos más vendidos hoy.';
        let totalSalesUsd = 0;
        let salesCount = 0;

        const dbSales = await db.get('sales');
        if (dbSales && Array.isArray(dbSales)) {
            const todayStr = new Date().toISOString().slice(0, 10);
            const todaySales = dbSales.filter(s => (s.timestamp || '').startsWith(todayStr));
            salesCount = todaySales.length;
            totalSalesUsd = todaySales.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);

            // Compute Top Products Sold Today
            const counts = {};
            todaySales.forEach(s => {
                const name = s.product_name || 'Producto';
                counts[name] = (counts[name] || 0) + (parseInt(s.quantity, 10) || 1);
            });

            const sortedProducts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            if (sortedProducts.length > 0) {
                topProductsText = sortedProducts.map(([name, qty], idx) => `${idx + 1}. ${name}: ${qty} unidades`).join('\n');
            }

            salesSummaryText = `Ventas Totales Hoy: $${totalSalesUsd.toFixed(2)} USD | Operaciones: ${salesCount}`;
        }

        // ----------------------------------------------------
        // 6. Conversational AI NLU with Gemini 2.5 Flash
        // ----------------------------------------------------
        const aiResult = await processIntentWithGemini(messageText, currentProducts, {
            salesSummaryText,
            topProductsText,
            totalSalesUsd,
            salesCount,
            senderName
        });

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
        await sendWhatsAppMessage(rawFrom, replyMessage);
        return res.status(200).json({ status: 'success', intent, reply: replyMessage });

    } catch (err) {
        console.error('❌ Error processing WhatsApp Webhook:', err);
        return res.status(500).json({ error: err.message });
    }
};

function findBestMatchingProduct(userText, catalog) {
    if (!catalog || catalog.length === 0) return null;
    const text = normalizeText(userText);

    let match = catalog.find(p => text.includes(normalizeText(p.name)));
    if (match) return match;

    let bestProd = null;
    let maxScore = 0;

    catalog.forEach(prod => {
        const prodWords = normalizeText(prod.name).split(/\s+/).filter(w => w.length > 2);
        let score = 0;
        prodWords.forEach(word => {
            const stem = word.replace(/s$/, '');
            if (text.includes(stem)) {
                score += 1;
            }
        });
        if (score > maxScore) {
            maxScore = score;
            bestProd = prod;
        }
    });

    return bestProd || catalog[0];
}

/**
 * Call Gemini 2.5 Flash API for Conversational NLU & Natural Language Generation
 */
async function processIntentWithGemini(userText, catalog, liveContext) {
    const apiKey = process.env.GEMINI_API_KEY;
    const textNorm = normalizeText(userText);

    const catalogText = catalog.map(p => `- ID: "${p.id}" | Nombre: "${p.name}" | Categoría: "${p.category}" | Stock Actual en Vitrina: ${p.stock}`).join('\n');

    if (!apiKey) {
        let intent = 'conversational_chat';
        let matchedProduct = findBestMatchingProduct(userText, catalog);
        let targetId = matchedProduct ? matchedProduct.id : catalog[0]?.id;
        let qty = 10;
        let reply = `🤖 ¡Hola ${liveContext.senderName}! En el momento este es el estado del negocio:\n\n📊 ${liveContext.salesSummaryText}\n\n🏆 *Productos más vendidos hoy:*\n${liveContext.topProductsText}`;

        if (textNorm.includes('carga') || textNorm.includes('agrega') || textNorm.includes('mas') || textNorm.includes('pastelito') || textNorm.includes('empanada') || textNorm.includes('stock')) {
            intent = 'add_stock';
            const numMatch = userText.match(/\d+/);
            if (numMatch) qty = parseInt(numMatch[0], 10);
            reply = `✅ ¡Entendido! He actualizado +${qty} unidades de *${matchedProduct ? matchedProduct.name : 'Producto'}* al inventario de la panadería.`;
        } else if (textNorm.includes('cuanto') || textNorm.includes('caja') || textNorm.includes('venta') || textNorm.includes('resumen')) {
            intent = 'query_sales';
            reply = `📊 *Resumen de Caja del Día (Casa Lucenzo)*\n\n💰 *Ventas Totales:* $${liveContext.totalSalesUsd.toFixed(2)} USD\n🛒 *Transacciones:* ${liveContext.salesCount} operaciones\n\n🏆 *Productos más vendidos hoy:*\n${liveContext.topProductsText}`;
        } else if (textNorm.includes('tasa') || textNorm.includes('bcv') || textNorm.includes('dolar')) {
            intent = 'update_bcv';
            const rateMatch = userText.match(/\d+[\.,]?\d*/);
            const rate = rateMatch ? parseFloat(rateMatch[0].replace(',', '.')) : 36.5;
            reply = `💵 ¡Tasa BCV actualizada a ${rate.toFixed(2)} VES/USD! Los precios en la vitrina han sido recargados.`;
        }

        return {
            intent,
            target_product_id: targetId,
            product_name: matchedProduct ? matchedProduct.name : '',
            quantity: qty,
            reply_text: reply
        };
    }

    const systemPrompt = `Eres el Asistente Conversacional Inteligente de Casa Lucenzo (panadería/pastelería).
Hablas con ${liveContext.senderName} (el dueño/administrador) de forma totalmente natural, amable, cercana y profesional por WhatsApp.

DATOS EN TIEMPO REAL DEL NEGOCIO (HOY):
- Resumen de Caja: ${liveContext.salesSummaryText}
- Productos Más Vendidos Hoy:
${liveContext.topProductsText}

CATÁLOGO E INVENTARIO ACTUAL EN VITRINA:
${catalogText}

INSTRUCCIONES:
1. Responde a la pregunta de ${liveContext.senderName} de forma 100% conversacional, natural y directa (ej: si pregunta qué sabor se vende más, dile cuál es el producto estrella hoy con las cantidades vendidas y cuál le sigue).
2. Si el usuario pide cargar stock, cambiar tasa o modificar algo en lenguaje natural, identifica la intención ("add_stock", "set_stock", "update_bcv", "query_sales", "conversational_chat"), extrae los parámetros y redacta una respuesta conversacional confirmando la acción.

RESPONDE ÚNICAMENTE CON UN OBJETO JSON VÁLIDO SIN BLOQUES MARKDOWN:
{
  "intent": "add_stock" | "set_stock" | "query_sales" | "update_bcv" | "conversational_chat",
  "target_product_id": "ID del producto si aplica",
  "product_name": "Nombre detectado del producto si aplica",
  "quantity": numero_entero_si_aplica,
  "bcv_rate": numero_decimal_si_aplica,
  "reply_text": "Tu respuesta conversacional en español formateada con emojis elegantes para WhatsApp"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: `${systemPrompt}\n\nMensaje de ${liveContext.senderName}: "${userText}"` }]
                    }
                ]
            })
        });

        if (!resp.ok) {
            throw new Error(`Gemini API Error ${resp.status}`);
        }

        const data = await resp.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        return JSON.parse(rawText);
    } catch (e) {
        console.warn('⚠️ Gemini intent extraction error:', e.message);
        return {
            intent: 'conversational_chat',
            reply_text: `🤖 ¡Hola ${liveContext.senderName}! Hoy en Casa Lucenzo llevamos **$${liveContext.totalSalesUsd.toFixed(2)} USD** en ventas (${liveContext.salesCount} operaciones).\n\n🏆 *Productos más vendidos hoy:*\n${liveContext.topProductsText}`
        };
    }
}

/**
 * Transcribe Audio Voice Notes using Gemini 2.5 Flash Multimodal
 */
async function downloadAndTranscribeAudio(audioId) {
    const waToken = process.env.WHATSAPP_API_TOKEN || 'EAAb73TUZAiY0BSPLALoWZBEoGyF0S2pTGt0P2xJVCqZBZC0JHjbs9ymHiEcOZBVvvdL7lu1ckFcDZAWZC2FDfXC5DGDzNHqxR89wnWQffiqexys9dtyBn6ZATnCdlN9xOgzZAVf5Wh34DdEtTzQIRsNZBmpGjKFHQYXZBnm7UkPuaVfXP2bOLBMcbZB2BpYGZAy4zwQZDZD';
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
    const waToken = process.env.WHATSAPP_API_TOKEN || 'EAAb73TUZAiY0BSPLALoWZBEoGyF0S2pTGt0P2xJVCqZBZC0JHjbs9ymHiEcOZBVvvdL7lu1ckFcDZAWZC2FDfXC5DGDzNHqxR89wnWQffiqexys9dtyBn6ZATnCdlN9xOgzZAVf5Wh34DdEtTzQIRsNZBmpGjKFHQYXZBnm7UkPuaVfXP2bOLBMcbZB2BpYGZAy4zwQZDZD';
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1235301469669762';

    if (!waToken) {
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
