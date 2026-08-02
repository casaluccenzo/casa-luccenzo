const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Helper to normalize text
function normalizeText(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// Default products fallback
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

async function startWhatsAppQRBridge() {
    console.log('🚀 Iniciando Servicio de Conexión por Código QR (Casa Lucenzo WhatsApp Bridge)...');

    const authFolder = path.join(__dirname, '..', 'whatsapp-session');
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n=============================================================');
            console.log('📱 ¡ESCANEA ESTE CÓDIGO QR DESDE TU WHATSAPP!');
            console.log('=============================================================\n');
            qrcode.generate(qr, { small: true });

            // Generate HTML & PNG for web view
            try {
                const qrDataUrl = await QRCode.toDataURL(qr);
                const htmlContent = `
                    <!DOCTYPE html>
                    <html lang="es">
                    <head>
                        <meta charset="UTF-8">
                        <title>Vincular WhatsApp Casa Lucenzo</title>
                        <style>
                            body { font-family: system-ui, sans-serif; background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                            .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                            img { border: 10px solid white; border-radius: 0.5rem; margin: 1.5rem 0; width: 280px; height: 280px; }
                            h1 { color: #f59e0b; margin-top: 0; }
                            p { color: #94a3b8; font-size: 1.1rem; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>🥖 Casa Lucenzo WhatsApp AI</h1>
                            <p>Abre WhatsApp en tu teléfono ➔ <b>Dispositivos vinculados</b> ➔ <b>Vincular un dispositivo</b> y escanea este código:</p>
                            <img src="${qrDataUrl}" alt="Código QR WhatsApp" />
                            <p><i>Este código se actualizará en unos segundos si expira.</i></p>
                        </div>
                        <script>setTimeout(() => location.reload(), 15000);</script>
                    </body>
                    </html>
                `;
                fs.writeFileSync(path.join(__dirname, '..', 'www', 'whatsapp-qr.html'), htmlContent);
                console.log('🔗 Vista Web del QR generada en: www/whatsapp-qr.html');
            } catch (e) {
                console.error('Error generando QR HTML:', e.message);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexión de WhatsApp cerrada. Reinstalando sesión...', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startWhatsAppQRBridge, 3000);
            }
        } else if (connection === 'open') {
            console.log('\n=============================================================');
            console.log('✅ ¡WHATSAPP DE CASA LUCENZO CONECTADO CON ÉXITO VÍA CÓDIGO QR!');
            console.log('🤖 La Inteligencia Artificial ya está escuchando y lista para responder.');
            console.log('=============================================================\n');

            // Replace QR HTML with success page
            const successHtml = `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>WhatsApp Conectado - Casa Lucenzo</title>
                    <style>
                        body { font-family: system-ui, sans-serif; background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                        .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                        .icon { font-size: 4rem; margin-bottom: 1rem; }
                        h1 { color: #10b981; margin: 0; }
                        p { color: #cbd5e1; font-size: 1.2rem; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="icon">✅</div>
                        <h1>¡WhatsApp Conectado Exitosamente!</h1>
                        <p>El Bot Inteligente de Casa Lucenzo está activo y sincronizado con tu teléfono.</p>
                    </div>
                </body>
                </html>
            `;
            fs.writeFileSync(path.join(__dirname, '..', 'www', 'whatsapp-qr.html'), successHtml);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || msg.key.fromMe) return; // Ignore self messages

            const remoteJid = msg.key.remoteJid;
            const senderName = msg.pushName || 'Administrador';
            const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

            if (!messageText.trim()) return;

            console.log(`📩 Mensaje recibido de ${senderName} (${remoteJid}): "${messageText}"`);

            // Fetch Products & Sales from Supabase
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            const db = new SupabaseRest(supabaseUrl, supabaseKey);

            let catalog = DEFAULT_PRODUCTS;
            const dbProducts = await db.get('products');
            if (dbProducts && dbProducts.length > 0) catalog = dbProducts;

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

            // Call Conversational AI Engine
            const aiResult = await processIntentWithGemini(messageText, catalog, {
                salesSummaryText,
                topProductsText,
                totalSalesUsd,
                salesCount,
                senderName
            });

            const { intent, target_product_id, quantity, bcv_rate, reply_text } = aiResult;
            let replyMessage = reply_text || `🤖 ¡Hola ${senderName}! he procesado tu instrucción.`;

            // Execute Actions
            if (intent === 'add_stock' || intent === 'set_stock') {
                const targetProduct = catalog.find(p => p.id === target_product_id) || catalog[0];
                if (targetProduct) {
                    const qtyVal = parseInt(quantity, 10) || 0;
                    let newStock = targetProduct.stock || 0;
                    newStock = (intent === 'add_stock') ? (newStock + qtyVal) : qtyVal;

                    await db.patch('products', 'id', targetProduct.id, { stock: newStock });
                    await db.post('activity_logs', {
                        user_name: `WhatsApp QR (${senderName})`,
                        action: 'Ajuste de Stock vía WhatsApp QR',
                        details: `${intent === 'add_stock' ? 'Cargados' : 'Establecido'} ${qtyVal} ud de ${targetProduct.name}. Nuevo stock: ${newStock}`,
                        timestamp: new Date().toISOString()
                    });
                }
            } else if (intent === 'update_bcv') {
                const newRate = parseFloat(bcv_rate) || 0;
                if (newRate > 0) {
                    await db.post('exchange_rates', {
                        rate: newRate,
                        source: 'WhatsApp QR Admin',
                        timestamp: new Date().toISOString()
                    });
                }
            }

            // Send Outgoing WhatsApp Response
            console.log(`📤 Enviando respuesta a ${senderName}...`);
            await sock.sendMessage(remoteJid, { text: replyMessage });

        } catch (err) {
            console.error('❌ Error procesando mensaje de WhatsApp QR:', err.message);
        }
    });
}

async function processIntentWithGemini(userText, catalog, liveContext) {
    const apiKey = process.env.GEMINI_API_KEY;
    const catalogText = catalog.map(p => `- ID: "${p.id}" | Nombre: "${p.name}" | Categoría: "${p.category}" | Stock Actual en Vitrina: ${p.stock}`).join('\n');

    if (!apiKey) {
        return {
            intent: 'conversational_chat',
            reply_text: `🤖 ¡Hola ${liveContext.senderName}! Hoy en Casa Lucenzo llevamos **$${liveContext.totalSalesUsd.toFixed(2)} USD** en ventas (${liveContext.salesCount} operaciones).\n\n🏆 *Productos más vendidos hoy:*\n${liveContext.topProductsText}`
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
                contents: [{
                    role: "user",
                    parts: [{ text: `${systemPrompt}\n\nMensaje de ${liveContext.senderName}: "${userText}"` }]
                }]
            })
        });
        if (!resp.ok) throw new Error(`Gemini API Error ${resp.status}`);
        const data = await resp.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(rawText);
    } catch (e) {
        return {
            intent: 'conversational_chat',
            reply_text: `🤖 ¡Hola ${liveContext.senderName}! Hoy en Casa Lucenzo llevamos **$${liveContext.totalSalesUsd.toFixed(2)} USD** en ventas (${liveContext.salesCount} operaciones).\n\n🏆 *Productos más vendidos hoy:*\n${liveContext.topProductsText}`
        };
    }
}

if (require.main === module) {
    startWhatsAppQRBridge();
}

module.exports = { startWhatsAppQRBridge };
