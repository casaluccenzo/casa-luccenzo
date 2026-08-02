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

        const rawFrom = message.from; // Phone number e.g. 584141234567
        const normalizedFrom = normalizePhone(rawFrom);
        const senderName = contact?.profile?.name || 'Administrador';

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
            const reply = `🤖 Hola ${senderName}, por el momento solo puedo procesar mensajes de texto y notas de voz para gestionar el inventario de Casa Lucenzo.`;
            await sendWhatsAppMessage(rawFrom, reply);
            return res.status(200).json({ status: 'unsupported_message_type' });
        }

        if (!messageText.trim()) {
            return res.status(200).json({ status: 'empty_message' });
        }

        // ----------------------------------------------------
        // 5. Fetch Product Catalog for Gemini Context
        // ----------------------------------------------------
        let currentProducts = DEFAULT_PRODUCTS;
        const dbProducts = await db.get('products');
        if (dbProducts && dbProducts.length > 0) {
            currentProducts = dbProducts;
        }

        // ----------------------------------------------------
        // 6. Natural Language NLU with Gemini 2.5 Flash
        // ----------------------------------------------------
        const aiResult = await processIntentWithGemini(messageText, currentProducts);
        const { intent, target_product_id, quantity, bcv_rate, explanation } = aiResult;

        // ----------------------------------------------------
        // 7. Execute Database Action based on AI Intent
        // ----------------------------------------------------
        let replyMessage = '';

        if (intent === 'add_stock' || intent === 'set_stock') {
            const targetProduct = currentProducts.find(p => p.id === target_product_id) || 
                                  currentProducts.find(p => normalizeText(p.name).includes(normalizeText(aiResult.product_name || '')));

            if (!targetProduct) {
                replyMessage = `⚠️ No logré identificar el producto exacto en el catálogo. Productos disponibles:\n` +
                               currentProducts.map(p => `- ${p.name}`).join('\n');
            } else {
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

                replyMessage = `✅ *¡Stock Actualizado Exitosamente!*\n\n` +
                               `📦 *Producto:* ${targetProduct.name}\n` +
                               `➕ *Cantidad:* ${intent === 'add_stock' ? '+' : ''}${qtyVal}\n` +
                               `📊 *Nuevo Stock en Vitrina:* ${newStock} unidades\n\n` +
                               `*Casa Lucenzo Bot* 🥖`;
            }
        } else if (intent === 'query_sales') {
            let totalSalesUsd = 0;
            let salesCount = 0;

            const salesData = await db.get('sales');
            if (salesData && Array.isArray(salesData)) {
                const todayStr = new Date().toISOString().slice(0, 10);
                const todaySales = salesData.filter(s => (s.timestamp || '').startsWith(todayStr));
                salesCount = todaySales.length;
                totalSalesUsd = todaySales.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
            }

            replyMessage = `📊 *Resumen de Caja del Día (Casa Lucenzo)*\n\n` +
                           `💰 *Ventas Totales:* $${totalSalesUsd.toFixed(2)} USD\n` +
                           `🛒 *Transacciones:* ${salesCount} operaciones\n` +
                           `🕒 *Fecha:* ${new Date().toLocaleDateString('es-VE')}\n\n` +
                           `¡La pantalla de la panadería ya está actualizada en tiempo real! 🥖`;
        } else if (intent === 'update_bcv') {
            const newRate = parseFloat(bcv_rate) || 0;
            if (newRate <= 0) {
                replyMessage = `⚠️ Por favor especifica una tasa de cambio válida (ej: "Actualiza la tasa a 36.50")`;
            } else {
                await db.post('exchange_rates', {
                    rate: newRate,
                    source: 'WhatsApp Admin',
                    timestamp: new Date().toISOString()
                });
                replyMessage = `💵 *Tasa BCV Actualizada Exitosamente*\n\n` +
                               `📈 *Nueva Tasa:* ${newRate.toFixed(2)} VES/USD\n` +
                               `👤 *Actualizado por:* ${senderName}\n\n` +
                               `Todos los precios en Bolívares se han recargado en el POS.`;
            }
        } else {
            replyMessage = `🤖 Hola ${senderName}, soy el Bot de Casa Lucenzo.\n\n` +
                           `Puedo ayudarte con las siguientes instrucciones:\n` +
                           `1️⃣ *Cargar Stock:* _"Cárgame 30 pastelitos de queso"_\n` +
                           `2️⃣ *Consultar Caja:* _"¿Cuánto llevamos vendido hoy?"_\n` +
                           `3️⃣ *Tasa BCV:* _"Actualiza la tasa a 36.50"_\n\n` +
                           `_Detalle procesado: ${explanation || 'Instrucción recibida'}_`;
        }

        // Send WhatsApp Outgoing Response Message
        await sendWhatsAppMessage(rawFrom, replyMessage);
        return res.status(200).json({ status: 'success', intent, reply: replyMessage });

    } catch (err) {
        console.error('❌ Error processing WhatsApp Webhook:', err);
        return res.status(500).json({ error: err.message });
    }
};

/**
 * Call Gemini 2.5 Flash API for Intent Parsing & Entity Extraction
 */
async function processIntentWithGemini(userText, catalog) {
    const apiKey = process.env.GEMINI_API_KEY;
    const textNorm = normalizeText(userText);

    if (!apiKey) {
        let intent = 'unknown';
        let targetId = catalog[0]?.id;
        let qty = 10;

        if (textNorm.includes('carga') || textNorm.includes('agrega') || textNorm.includes('mas') || textNorm.includes('pastelito') || textNorm.includes('empanada')) {
            intent = 'add_stock';
            const numMatch = userText.match(/\d+/);
            if (numMatch) qty = parseInt(numMatch[0], 10);
            
            const foundProd = catalog.find(p => textNorm.includes(normalizeText(p.name)) || textNorm.includes(normalizeText(p.category)));
            if (foundProd) targetId = foundProd.id;
        } else if (textNorm.includes('cuanto') || textNorm.includes('caja') || textNorm.includes('venta') || textNorm.includes('resumen')) {
            intent = 'query_sales';
        } else if (textNorm.includes('tasa') || textNorm.includes('bcv') || textNorm.includes('dolar')) {
            intent = 'update_bcv';
        }

        return {
            intent,
            target_product_id: targetId,
            quantity: qty,
            explanation: 'Procesado por motor de respaldo regex'
        };
    }

    const catalogText = catalog.map(p => `- ID: "${p.id}" | Nombre: "${p.name}" | Categoría: "${p.category}" | Stock Actual: ${p.stock}`).join('\n');

    const systemPrompt = `Eres el Asistente de IA de inventario de Casa Lucenzo (panadería/pastelería).
Analiza el mensaje recibido del administrador y determina la intención y parámetros en formato estricto JSON sin etiquetas markdown de bloque.

Catálogo actual de productos:
${catalogText}

Comandos admitidos:
1. "add_stock": Aumentar stock de un producto (ej: "cárgame 30 pastelitos de queso", "llegaron 20 empanadas").
2. "set_stock": Establecer el stock fijo de un producto (ej: "pon el stock de pollo en 15").
3. "query_sales": Consultar total de ventas o caja del día (ej: "cuanto vendimos hoy", "resumen de caja").
4. "update_bcv": Cambiar tasa de cambio BCV (ej: "actualiza la tasa a 36.50").
5. "unknown": Instrucción no comprendida.

RESPONDE ÚNICAMENTE CON UN OBJETO JSON VÁLIDO CON ESTA ESTRUCTURA:
{
  "intent": "add_stock" | "set_stock" | "query_sales" | "update_bcv" | "unknown",
  "target_product_id": "ID del producto que mejor coincide del catálogo",
  "product_name": "Nombre detectado",
  "quantity": numero_entero,
  "bcv_rate": numero_decimal,
  "explanation": "Breve explicación en español"
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
                        parts: [{ text: `${systemPrompt}\n\nMensaje del usuario: "${userText}"` }]
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
        console.warn('⚠️ Gemini intent extraction error, using fallback:', e.message);
        return {
            intent: 'unknown',
            explanation: `Error consultando Gemini: ${e.message}`
        };
    }
}

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
