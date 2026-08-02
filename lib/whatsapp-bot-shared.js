// Shared helpers for the two WhatsApp bot entry points:
//   - api/whatsapp-webhook.js   (official Meta Graph API webhook, used in production)
//   - tools/whatsapp-qr-bridge.js (unofficial Baileys QR bridge, local/manual use only)
// Keeping this logic in one place avoids the two integrations drifting apart.

function normalizeText(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function normalizePhone(phone) {
    if (!phone) return '';
    return String(phone).replace(/[^0-9]/g, '');
}

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

    // For queries needing filters/order/limit beyond plain `get` -- pass the
    // full PostgREST path+query, e.g. "sales?select=price&timestamp=gte.2026-01-01"
    async rawGet(pathAndQuery) {
        if (!this.url || !this.key) return null;
        try {
            const resp = await fetch(`${this.url}/rest/v1/${pathAndQuery}`, {
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
 * Determines what a phone number is allowed to do via the WhatsApp bot:
 *   'admin'  -- full access, including stock/BCV changes (WHATSAPP_ADMIN_PHONE
 *               env whitelist, or a Supabase profile with role='admin')
 *   'viewer' -- can chat/query (sales, history, how the app works) but the
 *               server refuses to execute any mutation for them, regardless of
 *               what the AI extracts as intent (WHATSAPP_VIEWER_PHONE env
 *               whitelist, or a Supabase profile with role='venta'/'cocina')
 *   null     -- not authorized at all
 * @param {SupabaseRest|null} db
 * @param {string} rawFrom
 * @returns {Promise<'admin'|'viewer'|null>}
 */
async function getAuthorizationLevel(db, rawFrom) {
    const normalizedFrom = normalizePhone(rawFrom);

    const adminPhones = (process.env.WHATSAPP_ADMIN_PHONE || '').split(',').map(p => normalizePhone(p)).filter(Boolean);
    if (adminPhones.includes(normalizedFrom)) return 'admin';

    const viewerPhones = (process.env.WHATSAPP_VIEWER_PHONE || '').split(',').map(p => normalizePhone(p)).filter(Boolean);
    if (viewerPhones.includes(normalizedFrom)) return 'viewer';

    if (db) {
        const userProfiles = await db.get('profiles', 'phone,role');
        const found = (userProfiles || []).find(p => normalizePhone(p.phone) === normalizedFrom);
        if (found?.role === 'admin') return 'admin';
        if (found?.role === 'venta' || found?.role === 'cocina') return 'viewer';
    }

    return null;
}

/**
 * Fetches the last `limit` conversation turns for a phone number, oldest first.
 * @param {SupabaseRest|null} db
 * @param {string} phone
 * @param {number} limit
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function getConversationHistory(db, phone, limit = 16) {
    if (!db) return [];
    const normalizedPhone = normalizePhone(phone);
    const rows = await db.rawGet(`whatsapp_conversations?phone=eq.${encodeURIComponent(normalizedPhone)}&select=role,content,created_at&order=created_at.desc&limit=${limit}`);
    if (!rows) return [];
    return rows.reverse();
}

/**
 * Appends one turn (user or assistant) to a phone's conversation history.
 * @param {SupabaseRest|null} db
 * @param {string} phone
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
async function appendConversationTurn(db, phone, role, content) {
    if (!db || !content) return;
    const normalizedPhone = normalizePhone(phone);
    await db.post('whatsapp_conversations', { phone: normalizedPhone, role, content });
}

/**
 * Builds a compact day-by-day sales/expenses summary for the last N days, so the
 * bot can answer questions like "¿cómo estuvo la semana pasada?" and not just "hoy".
 * @param {SupabaseRest|null} db
 * @param {number} days
 * @returns {Promise<string>}
 */
async function fetchHistoricalDailySummary(db, days = 14) {
    if (!db) return 'Sin datos históricos disponibles.';

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const startIso = startDate.toISOString();

    const sales = await db.rawGet(`sales?select=timestamp,price&timestamp=gte.${encodeURIComponent(startIso)}&order=timestamp.asc`);
    const expenses = await db.rawGet(`expenses?select=timestamp,amount&timestamp=gte.${encodeURIComponent(startIso)}&order=timestamp.asc`);

    if (!sales && !expenses) return 'Sin datos históricos disponibles (no se pudo conectar a la base de datos).';

    const byDay = {};
    (sales || []).forEach(s => {
        const day = (s.timestamp || '').slice(0, 10);
        if (!day) return;
        if (!byDay[day]) byDay[day] = { salesUsd: 0, salesCount: 0, expensesUsd: 0 };
        byDay[day].salesUsd += parseFloat(s.price) || 0;
        byDay[day].salesCount += 1;
    });
    (expenses || []).forEach(e => {
        const day = (e.timestamp || '').slice(0, 10);
        if (!day) return;
        if (!byDay[day]) byDay[day] = { salesUsd: 0, salesCount: 0, expensesUsd: 0 };
        byDay[day].expensesUsd += parseFloat(e.amount) || 0;
    });

    const sortedDays = Object.keys(byDay).sort();
    if (sortedDays.length === 0) return `Sin ventas ni gastos registrados en los últimos ${days} días.`;

    return sortedDays.map(day => {
        const d = byDay[day];
        const net = d.salesUsd - d.expensesUsd;
        return `${day}: Ventas $${d.salesUsd.toFixed(2)} (${d.salesCount} ops) | Gastos $${d.expensesUsd.toFixed(2)} | Neto $${net.toFixed(2)}`;
    }).join('\n');
}

const APP_KNOWLEDGE = `Casa Lucenzo es un sistema POS (punto de venta) y control de inventario web/PWA para una panadería/pastelería. Así funciona, por si te preguntan cómo usarlo:
- Roles: "admin" (control total: métricas, inventario, usuarios, tasa BCV, cierre de caja), "venta" (vitrina, registrar ventas, historial, cobro de fiados/deudas), "cocina" (comandas, despachos, recetas e ingredientes).
- Vitrina/Ventas: se registran ventas por producto, cada una queda con su hora y la tasa BCV del momento.
- Inventario: cada producto tiene stock actual, mínimo y máximo; cuando el stock baja del mínimo se marca como "bajo stock".
- Cierre de caja: el admin cierra la caja del día, quedando un corte con ventas totales, gastos y caja neta; desde ahí arranca el conteo del día siguiente.
- Deudas/Fiados: se puede anotar una venta fiada a un cliente y luego registrar su pago (abono).
- Tasa BCV: el precio en bolívares se calcula con una tasa de cambio que se actualiza manual o automáticamente.
- Cocina: ve las comandas pendientes, marca despachos y reposiciones de vitrina, gestiona ingredientes y recetas.
- Modo offline: si se cae la conexión, las operaciones quedan en una cola local y se sincronizan solas al volver internet.`;

/**
 * Call Gemini 2.5 Flash API for Conversational NLU & Natural Language Generation.
 * Holds a real back-and-forth conversation (via conversationHistory) instead of
 * treating every message in isolation, and can chat naturally about anything --
 * the business, how the app works, historical data, or general conversation --
 * not just the handful of stock/BCV actions it can actually execute.
 */
async function processIntentWithGemini(userText, catalog, liveContext, conversationHistory = []) {
    const apiKey = process.env.GEMINI_API_KEY;
    const catalogText = catalog.map(p => `- ID: "${p.id}" | Nombre: "${p.name}" | Categoría: "${p.category}" | Stock Actual en Vitrina: ${p.stock}`).join('\n');

    const fallback = () => ({
        intent: 'conversational_chat',
        reply_text: `🤖 ¡Hola ${liveContext.senderName}! Hoy en Casa Lucenzo llevamos **$${liveContext.totalSalesUsd.toFixed(2)} USD** en ventas (${liveContext.salesCount} operaciones).\n\n🏆 *Productos más vendidos hoy:*\n${liveContext.topProductsText}`
    });

    if (!apiKey) return fallback();

    const isAdmin = liveContext.authLevel === 'admin';
    const permissionNote = isAdmin
        ? 'Esta persona es administradora: puede pedirte cargar stock, fijar stock, o cambiar la tasa BCV, y vos ejecutás esa acción.'
        : 'Esta persona tiene acceso de SOLO CONSULTA: puede preguntar lo que quiera (ventas, histórico, cómo funciona la app, charla), pero NO puede cargar stock, fijar stock, ni cambiar la tasa BCV. Si te pide algo de eso, explicale con buena onda que esa acción solo la puede hacer un administrador, y NO uses los intents de acción -- respondé siempre con "conversational_chat" para esta persona.';

    const systemPrompt = `Eres el asistente de WhatsApp de Casa Lucenzo (panadería/pastelería), hablando con ${liveContext.senderName}.

${permissionNote}

Tu forma de hablar: natural, cercana y directa, como charlar con un asistente de confianza -- no como un bot que solo entiende comandos fijos. Recordás lo que ya hablaron en la conversación (te paso el historial reciente) y podés seguir el hilo, hacer preguntas de vuelta, o simplemente charlar de lo que sea, no solo de números del negocio.

CÓMO FUNCIONA LA APP (por si te preguntan cómo usar algo):
${APP_KNOWLEDGE}

DATOS EN TIEMPO REAL DEL NEGOCIO (HOY):
- Resumen de Caja: ${liveContext.salesSummaryText}
- Productos Más Vendidos Hoy:
${liveContext.topProductsText}

HISTÓRICO DE LOS ÚLTIMOS DÍAS (para preguntas tipo "¿cómo estuvo la semana pasada?" o comparar días):
${liveContext.historicalSummaryText || 'No disponible.'}

CATÁLOGO E INVENTARIO ACTUAL EN VITRINA:
${catalogText}

INSTRUCCIONES:
1. Respondé como en una charla real: si preguntan algo del negocio (ventas, histórico, inventario), respondé con los datos de arriba de forma natural. Si preguntan cómo usar la app, explicá con la info de arriba. Si quieren charlar de otra cosa, charlá nomás -- no hace falta forzar todo a ser sobre el negocio.
2. Solo cuando el usuario pida explícitamente cargar stock, fijar stock, o cambiar la tasa BCV, identificá esa intención ("add_stock", "set_stock", "update_bcv") y extraé los parámetros -- eso es lo único que puede ejecutar acciones reales en el sistema. Para cualquier otra cosa (preguntas, charla, histórico, dudas de uso) usá "conversational_chat".
3. No fuerces el JSON de acción si no corresponde -- en duda, es "conversational_chat" con una respuesta natural.

RESPONDE ÚNICAMENTE CON UN OBJETO JSON VÁLIDO SIN BLOQUES MARKDOWN:
{
  "intent": "add_stock" | "set_stock" | "update_bcv" | "conversational_chat",
  "target_product_id": "ID del producto si aplica",
  "product_name": "Nombre detectado del producto si aplica",
  "quantity": numero_entero_si_aplica,
  "bcv_rate": numero_decimal_si_aplica,
  "reply_text": "Tu respuesta conversacional en español, natural, formateada con emojis elegantes para WhatsApp"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
        const contents = [
            ...conversationHistory.map(turn => ({
                role: turn.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: turn.content }]
            })),
            { role: 'user', parts: [{ text: userText }] }
        ];

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents
            })
        });
        if (!resp.ok) throw new Error(`Gemini API Error ${resp.status}`);
        const data = await resp.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(rawText);
    } catch (e) {
        return fallback();
    }
}

module.exports = {
    normalizeText,
    normalizePhone,
    DEFAULT_PRODUCTS,
    SupabaseRest,
    getAuthorizationLevel,
    getConversationHistory,
    appendConversationTurn,
    fetchHistoricalDailySummary,
    processIntentWithGemini
};
